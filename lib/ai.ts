import { z } from "zod";
import { normalizeWhitespace } from "@/lib/html";
import type {
  AiEvaluationInput,
  AiEvaluationMetrics,
  AiEvaluationResult,
  AiResultLabel,
} from "@/lib/types";

const OPENAI_ENDPOINT = "https://api.openai.com/v1/responses";
const DEFAULT_MODEL = "gpt-4.1-mini";
const DEFAULT_BATCH_SIZE = 20;

const AiEvaluationResultSchema = z.object({
  targetType: z.enum(["title", "body"]),
  handle: z.string(),
  rowNumber: z.number().int().nullable(),
  result: z.enum(["OK", "要注意", "NG"]),
  issue: z.string(),
  suggestion: z.string(),
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

function parseResponseText(responseJson: unknown): string {
  if (!responseJson || typeof responseJson !== "object") {
    throw new Error("OpenAIレスポンスの形式が不正です。");
  }

  const withOutputText = responseJson as { output_text?: unknown };
  if (typeof withOutputText.output_text === "string" && withOutputText.output_text.trim().length > 0) {
    return withOutputText.output_text;
  }

  const withOutput = responseJson as {
    output?: Array<{
      content?: Array<{
        type?: string;
        text?: string;
      }>;
    }>;
  };

  if (Array.isArray(withOutput.output)) {
    for (const item of withOutput.output) {
      for (const content of item.content ?? []) {
        if (
          (content.type === "output_text" || content.type === "text") &&
          typeof content.text === "string" &&
          content.text.trim().length > 0
        ) {
          return content.text;
        }
      }
    }
  }

  throw new Error("OpenAIレスポンスからJSON本文を取得できませんでした。");
}

function toStrictIssueAndSuggestion(result: AiResultLabel, issue: string, suggestion: string): Pick<AiEvaluationResult, "issue" | "suggestion"> {
  if (result === "OK") {
    return { issue: "", suggestion: "" };
  }

  return {
    issue: issue.trim().length > 0 ? issue.trim() : "文章品質に問題が検出されました。",
    suggestion: suggestion.trim().length > 0 ? suggestion.trim() : "文章を自然で明確な表現に修正してください。",
  };
}

async function callAiBatch(
  items: AiEvaluationInput[],
  apiKey: string,
  model: string,
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
            issue: { type: "string" },
            suggestion: { type: "string" },
          },
          required: ["targetType", "handle", "rowNumber", "result", "issue", "suggestion"],
        },
      },
    },
    required: ["evaluations"],
  } as const;

  const systemInstruction = [
    "あなたはEC商品の文章品質チェッカーです。",
    "入力配列の各項目を必ず1件ずつ評価してください。",
    "result は OK / 要注意 / NG のみ。",
    "日本語・英語・混在文を対象に、自然さ・意味の通りやすさ・文構造・商品説明としての成立性を評価してください。",
    "OK の場合 issue/suggestion は空文字にしてください。",
    "要注意・NG の場合は issue/suggestion を日本語で簡潔に出力してください。",
    "出力は必ずJSONスキーマに厳密準拠し、入力の targetType/handle/rowNumber をそのまま返してください。",
  ].join("\n");

  const userInput = {
    items,
    outputRequirement: {
      mustEvaluateAllItems: true,
      doNotSkip: true,
    },
  };

  const response = await fetch(OPENAI_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      input: [
        {
          role: "system",
          content: [{ type: "input_text", text: systemInstruction }],
        },
        {
          role: "user",
          content: [{ type: "input_text", text: JSON.stringify(userInput) }],
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "language_quality_results",
          strict: true,
          schema,
        },
      },
    }),
  });

  const raw = await response.json();

  if (!response.ok) {
    const detail = JSON.stringify(raw);
    throw new Error(`OpenAI APIエラー: ${response.status} ${detail}`);
  }

  const parsedText = parseResponseText(raw);

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(parsedText);
  } catch {
    throw new Error("OpenAIのStructured OutputがJSONとして解釈できませんでした。");
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

  return batch.evaluations.map((item) => {
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
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY が設定されていません。");
  }

  const model = process.env.OPENAI_MODEL || DEFAULT_MODEL;

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
    const chunkResult = await callAiBatch(chunk, apiKey, model);
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
