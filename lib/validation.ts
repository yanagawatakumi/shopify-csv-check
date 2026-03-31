import { hasMeaningfulText, normalizePlainText } from "@/lib/html";
import type {
  AiEvaluationInput,
  HandleGroup,
  Severity,
  ShopifyColumns,
  ShopifyRow,
  ValidationIssue,
  ValidationPipelineResult,
  ValidationSummary,
} from "@/lib/types";

const CONSECUTIVE_SPACE_PATTERN = /(?: {2,}|　{2,}|[ 　]{2,})/;
const ABNORMAL_PUNCTUATION_PATTERN = /(?:。。+|、、+|！！+|？？+|[。．\.]{2,}|[!?！？]{2,}|[、,]{2,})/;

function pushIssue(
  issues: ValidationIssue[],
  payload: {
    rowNumber: number | null;
    columnName: string;
    severity: Severity;
    issue: string;
    suggestion: string;
    handle?: string;
  },
): void {
  issues.push(payload);
}

function parseVariantPrice(raw: string): { isEmpty: boolean; isNumeric: boolean; value: number | null } {
  const cleaned = raw.replace(/[\s,]/g, "").trim();
  if (cleaned.length === 0) {
    return { isEmpty: true, isNumeric: false, value: null };
  }

  const num = Number(cleaned);
  if (!Number.isFinite(num)) {
    return { isEmpty: false, isNumeric: false, value: null };
  }

  return { isEmpty: false, isNumeric: true, value: num };
}

function runFormatChecksForText(
  issues: ValidationIssue[],
  options: {
    text: string;
    rowNumber: number;
    handle: string;
    columnName: string;
  },
): void {
  if (CONSECUTIVE_SPACE_PATTERN.test(options.text)) {
    pushIssue(issues, {
      rowNumber: options.rowNumber,
      columnName: options.columnName,
      severity: "低",
      issue: "連続スペースが含まれています。",
      suggestion: "不要な連続スペースを1つに整理してください。",
      handle: options.handle,
    });
  }

  if (ABNORMAL_PUNCTUATION_PATTERN.test(options.text)) {
    pushIssue(issues, {
      rowNumber: options.rowNumber,
      columnName: options.columnName,
      severity: "低",
      issue: "異常な句読点の連続が含まれています。",
      suggestion: "句読点の連続や重複を見直してください。",
      handle: options.handle,
    });
  }
}

function buildAiInputs(rows: ShopifyRow[], groups: HandleGroup[]): AiEvaluationInput[] {
  const inputs: AiEvaluationInput[] = [];
  const titleUnitMap = new Map<string, AiEvaluationInput>();

  for (const row of rows) {
    const normalizedTitle = normalizePlainText(row.title);
    if (!hasMeaningfulText(normalizedTitle)) continue;

    // TitleのAI評価単位は「Handle + 正規化Title」の最初の行とする。
    // Shopifyのバリアント行で同一Titleが繰り返されるため、同一Handle内の重複評価を避ける。
    const key = `${row.handle}::${normalizedTitle}`;
    if (!titleUnitMap.has(key)) {
      titleUnitMap.set(key, {
        targetType: "title",
        handle: row.handle,
        rowNumber: row.rowNumber,
        text: normalizedTitle,
      });
    }
  }

  inputs.push(...titleUnitMap.values());

  for (const group of groups) {
    if (!hasMeaningfulText(group.combinedBodyText)) continue;

    // BodyはHandle単位で1つの文章として評価する。代表行はそのHandleの最初のデータ行。
    inputs.push({
      targetType: "body",
      handle: group.handle,
      rowNumber: group.representativeRowNumber,
      text: group.combinedBodyText,
    });
  }

  return inputs;
}

export function runRuleValidation(
  rows: ShopifyRow[],
  groups: HandleGroup[],
  columns: ShopifyColumns,
): ValidationPipelineResult {
  const issues: ValidationIssue[] = [];
  const bodyColumnName = columns.body ?? "Body HTML / Body (HTML)";

  for (const row of rows) {
    const normalizedTitle = normalizePlainText(row.title);
    if (!hasMeaningfulText(normalizedTitle)) {
      pushIssue(issues, {
        rowNumber: row.rowNumber,
        columnName: "Title",
        severity: "高",
        issue: "Title が未入力です。",
        suggestion: "商品タイトルを入力してください。",
        handle: row.handle,
      });
    } else {
      runFormatChecksForText(issues, {
        text: normalizedTitle,
        rowNumber: row.rowNumber,
        handle: row.handle,
        columnName: "Title",
      });
    }

    const price = parseVariantPrice(row.variantPrice);
    if (price.isEmpty || price.value === 0) {
      pushIssue(issues, {
        rowNumber: row.rowNumber,
        columnName: "Variant Price",
        severity: "高",
        issue: "Variant Price が空または0です。",
        suggestion: "販売価格を0より大きい数値で入力してください。",
        handle: row.handle,
      });
      continue;
    }

    if (!price.isNumeric || price.value === null) {
      pushIssue(issues, {
        rowNumber: row.rowNumber,
        columnName: "Variant Price",
        severity: "中",
        issue: "Variant Price が数値として解釈できません。",
        suggestion: "数値のみで価格を入力してください。",
        handle: row.handle,
      });
      continue;
    }

    if (price.value < 100 || price.value > 1_000_000) {
      pushIssue(issues, {
        rowNumber: row.rowNumber,
        columnName: "Variant Price",
        severity: "中",
        issue: "価格が想定範囲外です（100未満 または 1,000,000超）。",
        suggestion: "価格設定を見直してください。",
        handle: row.handle,
      });
    }
  }

  for (const group of groups) {
    if (!hasMeaningfulText(group.combinedBodyText)) {
      pushIssue(issues, {
        rowNumber: group.representativeRowNumber,
        columnName: bodyColumnName,
        severity: "高",
        issue: "Body が未入力です（同一Handle内で本文なし）。",
        suggestion: "同一Handle内のいずれかの行に本文を入力してください。",
        handle: group.handle,
      });
      continue;
    }

    runFormatChecksForText(issues, {
      text: group.combinedBodyText,
      rowNumber: group.representativeRowNumber,
      handle: group.handle,
      columnName: bodyColumnName,
    });
  }

  return {
    ruleIssues: issues,
    aiInputs: buildAiInputs(rows, groups),
  };
}

export function summarizeIssues(issues: ValidationIssue[]): ValidationSummary {
  return issues.reduce<ValidationSummary>(
    (acc, issue) => {
      acc.total += 1;
      if (issue.severity === "高") acc.high += 1;
      if (issue.severity === "中") acc.medium += 1;
      if (issue.severity === "低") acc.low += 1;
      return acc;
    },
    { total: 0, high: 0, medium: 0, low: 0 },
  );
}
