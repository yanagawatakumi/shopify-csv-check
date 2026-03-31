import { z } from "zod";
import { normalizeWhitespace } from "@/lib/html";
import type {
  AiEvaluationInput,
  AiEvaluationMetrics,
  AiEvaluationResult,
  AiResultLabel,
} from "@/lib/types";

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta";
const DEFAULT_MODEL = "gemini-2.5-flash-lite";
const DEFAULT_BATCH_SIZE = 20;
const ISSUE_MAX_CHARS = 80;
const SUGGESTION_MAX_CHARS = 100;
const DEFAULT_DOMAIN_CONTEXT =
  "このECサイトは家具・ラグ（RUG）を主に扱います。カテゴリ名、素材名、型番、ブランド名、英語商品名、ハイフン区切り表記は通常許容です。";

const AiEvaluationResultSchema = z.object({
  targetType: z.enum(["title", "body"]),
  handle: z.string(),
  rowNumber: z.number().int().nullable(),
  result: z.enum(["OK", "要注意", "NG"]),
  issue: z.string().max(ISSUE_MAX_CHARS),
  suggestion: z.string().max(SUGGESTION_MAX_CHARS),
});

const AiBatchResponseSchema = z.object({
  evaluations: z.array(AiEvaluationResultSchema),
});

function chunkArray<T>(values: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < values.length; i += size) {
    chunks.push(values.slice(i, i + size));
  }
  return chunks;
}

function evaluationKey(value: Pick<AiEvaluationResult, "targetType" | "handle" | "rowNumber">): string {
  return `${value.targetType}::${value.handle}::${value.rowNumber ?? "null"}`;
}

function dedupKey(value: Pick<AiEvaluationInput, "targetType" | "text">): string {
  const normalized = normalizeWhitespace(value.text);
  return `${value.targetType}::${normalized}`;
}

function modelPath(model: string): string {
  return model.startsWith("models/") ? model : `models/${model}`;
}

function parseGeminiResponseText(responseJson: unknown): string {
  if (!responseJson || typeof responseJson !== "object") {
    throw new Error("Geminiレスポンスの形式が不正です。");
  }

  const body = responseJson as {
    candidates?: Array<{
      content?: {
        parts?: Array<{
          text?: string;
        }>;
      };
      finishReason?: string;
    }>;
    promptFeedback?: {
      blockReason?: string;
      blockReasonMessage?: string;
    };
  };

  const candidate = body.candidates?.[0];
  if (!candidate) {
    const reason = body.promptFeedback?.blockReason ?? "UNKNOWN";
    const message = body.promptFeedback?.blockReasonMessage ?? "出力候補が返されませんでした。";
    throw new Error(`Geminiが応答を返しませんでした: ${reason} (${message})`);
  }

  for (const part of candidate.content?.parts ?? []) {
    if (typeof part.text === "string" && part.text.trim().length > 0) {
      return part.text;
    }
  }

  throw new Error(`GeminiレスポンスからJSON本文を取得できませんでした。finishReason=${candidate.finishReason ?? "UNKNOWN"}`);
}

function truncateText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars - 1).trimEnd()}…`;
}

function normalizeOutputText(text: string): string {
  return normalizeWhitespace(text)
    .replace("読やすく", "読みやすく")
    .replace(/^[「"'`]+|[」"'`]+$/g, "")
    .trim();
}

function extractFirstSentence(text: string): string {
  const normalized = normalizeOutputText(text);
  if (!normalized) return "";
  const sentence = normalized.split(/[。！？\n]/)[0]?.trim() ?? "";
  return sentence || normalized;
}

function isNonLanguageQualityIssue(issue: string): boolean {
  return /(情報が不足|具体的な商品情報が不足|ブランド名.*のみ|不要な英単語|SEO|訴求力|魅力が伝わらない)/.test(issue);
}

function normalizeIssueText(issue: string): string {
  const first = extractFirstSentence(issue);
  if (!first) return "文章品質に問題が検出されました。";

  if (/(のの|ためため|ですます|重複|繰り返し|同語反復)/.test(first)) {
    return "語句の重複や誤字により不自然な表現があります。";
  }
  if (/(文法|語順|主語|述語|文構造)/.test(first)) {
    return "文法または語順が不自然です。";
  }
  if (/(意味|不明瞭|通ら|破綻)/.test(first)) {
    return "意味が通りにくい表現があります。";
  }
  return first;
}

function shouldIgnoreIssueBySourceText(issue: string, sourceText: string): boolean {
  if (/ハイフン.*アンダースコア.*混在/.test(issue)) {
    return !(sourceText.includes("-") && sourceText.includes("_"));
  }
  return false;
}

function suggestionByIssue(issue: string): string {
  if (/(重複|繰り返し|同語反復|のの|ためため|ですます)/.test(issue)) {
    return "重複語を削除し、語尾と文のつながりを自然に整えてください。";
  }
  if (/(語順|文構造|主語|述語)/.test(issue)) {
    return "語順を整理し、主語と述語の対応を明確にしてください。";
  }
  if (/(意味|不明瞭|不自然|通ら)/.test(issue)) {
    return "意味が通るように表現を簡潔に整理してください。";
  }
  return "商品説明として自然で読みやすい文に整えてください。";
}

function toStrictIssueAndSuggestion(
  result: AiResultLabel,
  issue: string,
  suggestion: string,
): Pick<AiEvaluationResult, "issue" | "suggestion"> {
  if (result === "OK") {
    return { issue: "", suggestion: "" };
  }

  const normalizedIssue = truncateText(normalizeIssueText(issue), ISSUE_MAX_CHARS);

  let normalizedSuggestion = truncateText(
    extractFirstSentence(suggestion) || suggestionByIssue(normalizedIssue),
    SUGGESTION_MAX_CHARS,
  );

  // 長文の全文書き換え提案を避け、方向性ベースの提案に統一する。
  if (
    /「[^」]{15,}」/.test(normalizedSuggestion) ||
    normalizedSuggestion.includes("「") ||
    /「.+」.*(のように|へ修正|に変更)/.test(normalizedSuggestion) ||
    normalizedSuggestion.length > SUGGESTION_MAX_CHARS
  ) {
    normalizedSuggestion = suggestionByIssue(normalizedIssue);
  }

  return {
    issue: normalizedIssue,
    suggestion: normalizedSuggestion,
  };
}

async function callAiBatch(
  items: AiEvaluationInput[],
  apiKey: string,
  model: string,
  domainContext: string,
): Promise<AiEvaluationResult[]> {
  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      evaluations: {
        type: "array",
        minItems: items.length,
        maxItems: items.length,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            targetType: { type: "string", enum: ["title", "body"] },
            handle: { type: "string" },
            rowNumber: { type: ["number", "null"] },
            result: { type: "string", enum: ["OK", "要注意", "NG"] },
            issue: { type: "string", maxLength: ISSUE_MAX_CHARS },
            suggestion: { type: "string", maxLength: SUGGESTION_MAX_CHARS },
          },
          required: ["targetType", "handle", "rowNumber", "result", "issue", "suggestion"],
        },
      },
    },
    required: ["evaluations"],
  } as const;

  const systemInstruction = [
    "あなたはEC商品の文章品質チェッカーです。",
    domainContext,
    "入力配列の各項目を必ず1件ずつ評価してください。",
    "result は OK / 要注意 / NG のみ。",
    "日本語・英語・混在文を対象に、自然さ・意味の通りやすさ・文構造・商品説明としての成立性を評価してください。",
    "評価対象は文章品質のみです。情報量・SEO・訴求力・商品スペック不足は減点対象にしないでください。",
    "家具・ラグ領域のTitleは短い名詞句（ブランド名 + 商品カテゴリ等）でも自然なら OK にしてください。",
    "ブランド由来の英字・大文字・カテゴリ名（CHAIR, CABINET, RUG等）は不自然判定しないでください。",
    "OK の場合 issue/suggestion は空文字にしてください。",
    "要注意・NG の場合は issue を1文で簡潔に、suggestion は方向性ベースで1文にしてください。",
    "修正例の全文引用は禁止です。『〜のように修正』の形式や長い引用文を出力しないでください。",
    "出力は必ずJSONスキーマに厳密準拠し、入力の targetType/handle/rowNumber をそのまま返してください。",
  ].join("\n");

  const userInput = {
    items,
    outputRequirement: {
      mustEvaluateAllItems: true,
      doNotSkip: true,
    },
  };

  const response = await fetch(`${GEMINI_API_BASE}/${modelPath(model)}:generateContent`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify({
      systemInstruction: {
        parts: [{ text: systemInstruction }],
      },
      contents: [
        {
          role: "user",
          parts: [{ text: JSON.stringify(userInput) }],
        },
      ],
      generationConfig: {
        candidateCount: 1,
        temperature: 0,
        responseMimeType: "application/json",
        responseJsonSchema: schema,
      },
    }),
  });

  const raw = await response.json();

  if (!response.ok) {
    const detail = JSON.stringify(raw);
    throw new Error(`Gemini APIエラー: ${response.status} ${detail}`);
  }

  const parsedText = parseGeminiResponseText(raw);

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(parsedText);
  } catch {
    throw new Error("GeminiのStructured OutputがJSONとして解釈できませんでした。");
  }

  const batch = AiBatchResponseSchema.parse(parsedJson);
  if (batch.evaluations.length !== items.length) {
    throw new Error(
      `AI評価件数が一致しません。期待: ${items.length} 件 / 受信: ${batch.evaluations.length} 件`,
    );
  }

  const expectedKeySet = new Set(items.map((item) => evaluationKey(item)));
  const resultKeySet = new Set(batch.evaluations.map((item) => evaluationKey(item)));

  if (expectedKeySet.size !== resultKeySet.size) {
    throw new Error("AI評価結果のキー件数が一致しません。");
  }

  for (const key of expectedKeySet) {
    if (!resultKeySet.has(key)) {
      throw new Error(`AI評価結果に欠損があります: ${key}`);
    }
  }

  const sourceTextByKey = new Map(
    items.map((input) => [evaluationKey(input), normalizeWhitespace(input.text)]),
  );

  return batch.evaluations.map((item) => {
    const sourceText = sourceTextByKey.get(evaluationKey(item)) ?? "";
    if (item.result !== "OK" && shouldIgnoreIssueBySourceText(item.issue, sourceText)) {
      return {
        ...item,
        result: "OK",
        issue: "",
        suggestion: "",
      };
    }

    if (item.result !== "OK" && isNonLanguageQualityIssue(item.issue)) {
      return {
        ...item,
        result: "OK",
        issue: "",
        suggestion: "",
      };
    }

    const normalized = toStrictIssueAndSuggestion(item.result, item.issue, item.suggestion);
    return {
      ...item,
      issue: normalized.issue,
      suggestion: normalized.suggestion,
    };
  });
}

export async function evaluateLanguageQuality(
  logicalInputs: AiEvaluationInput[],
): Promise<{ results: AiEvaluationResult[]; metrics: AiEvaluationMetrics }> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY が設定されていません。");
  }

  const model = process.env.GEMINI_MODEL || DEFAULT_MODEL;
  const domainContext = process.env.AI_DOMAIN_CONTEXT || DEFAULT_DOMAIN_CONTEXT;

  const metrics: AiEvaluationMetrics = {
    logicalTitleCount: logicalInputs.filter((item) => item.targetType === "title").length,
    logicalBodyCount: logicalInputs.filter((item) => item.targetType === "body").length,
    uniqueTitleCount: 0,
    uniqueBodyCount: 0,
    returnedTitleCount: 0,
    returnedBodyCount: 0,
  };

  if (logicalInputs.length === 0) {
    return { results: [], metrics };
  }

  const groups = new Map<string, AiEvaluationInput[]>();
  for (const item of logicalInputs) {
    const key = dedupKey(item);
    const bucket = groups.get(key) ?? [];
    bucket.push(item);
    groups.set(key, bucket);
  }

  const uniqueInputs = Array.from(groups.values()).map((bucket) => bucket[0]);

  metrics.uniqueTitleCount = uniqueInputs.filter((item) => item.targetType === "title").length;
  metrics.uniqueBodyCount = uniqueInputs.filter((item) => item.targetType === "body").length;

  const uniqueResults: AiEvaluationResult[] = [];
  const chunks = chunkArray(uniqueInputs, DEFAULT_BATCH_SIZE);

  for (const chunk of chunks) {
    const chunkResult = await callAiBatch(chunk, apiKey, model, domainContext);
    uniqueResults.push(...chunkResult);
  }

  metrics.returnedTitleCount = uniqueResults.filter((item) => item.targetType === "title").length;
  metrics.returnedBodyCount = uniqueResults.filter((item) => item.targetType === "body").length;

  if (metrics.uniqueTitleCount !== metrics.returnedTitleCount) {
    throw new Error(
      `TitleのAI評価件数が一致しません。期待: ${metrics.uniqueTitleCount} 件 / 受信: ${metrics.returnedTitleCount} 件`,
    );
  }

  if (metrics.uniqueBodyCount !== metrics.returnedBodyCount) {
    throw new Error(
      `BodyのAI評価件数が一致しません。期待: ${metrics.uniqueBodyCount} 件 / 受信: ${metrics.returnedBodyCount} 件`,
    );
  }

  const uniqueResultMap = new Map<string, AiEvaluationResult>();
  for (const result of uniqueResults) {
    uniqueResultMap.set(evaluationKey(result), result);
  }

  const expanded: AiEvaluationResult[] = [];
  for (const [groupKey, logicalGroup] of groups.entries()) {
    const representative = logicalGroup[0];
    const result = uniqueResultMap.get(evaluationKey(representative));
    if (!result) {
      throw new Error(`AI評価結果が見つかりません: ${groupKey}`);
    }

    for (const logicalItem of logicalGroup) {
      expanded.push({
        targetType: logicalItem.targetType,
        handle: logicalItem.handle,
        rowNumber: logicalItem.rowNumber,
        result: result.result,
        issue: result.issue,
        suggestion: result.suggestion,
      });
    }
  }

  const expandedTitleCount = expanded.filter((item) => item.targetType === "title").length;
  const expandedBodyCount = expanded.filter((item) => item.targetType === "body").length;

  if (expandedTitleCount !== metrics.logicalTitleCount) {
    throw new Error(
      `Titleの論理評価件数が一致しません。期待: ${metrics.logicalTitleCount} 件 / 受信: ${expandedTitleCount} 件`,
    );
  }

  if (expandedBodyCount !== metrics.logicalBodyCount) {
    throw new Error(
      `Bodyの論理評価件数が一致しません。期待: ${metrics.logicalBodyCount} 件 / 受信: ${expandedBodyCount} 件`,
    );
  }

  return { results: expanded, metrics };
}

export { AiBatchResponseSchema };
