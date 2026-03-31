export type Severity = "高" | "中" | "低";

export type AiTargetType = "title" | "body";
export type AiResultLabel = "OK" | "要注意" | "NG";

export interface CsvRow {
  rowNumber: number;
  values: Record<string, string>;
}

export interface ParsedCsv {
  headers: string[];
  rows: CsvRow[];
}

export interface ShopifyColumns {
  handle: string;
  title: string;
  body: string | null;
  variantPrice: string;
}

export interface ShopifyRow {
  rowNumber: number;
  handle: string;
  title: string;
  bodyHtml: string;
  variantPrice: string;
}

export interface HandleGroup {
  handle: string;
  rows: ShopifyRow[];
  representativeRowNumber: number;
  combinedBodyHtml: string;
  combinedBodyText: string;
}

export interface ValidationIssue {
  rowNumber: number | null;
  columnName: string;
  severity: Severity;
  issue: string;
  suggestion: string;
  handle?: string;
}

export interface AiEvaluationInput {
  targetType: AiTargetType;
  handle: string;
  rowNumber: number | null;
  text: string;
}

export interface AiEvaluationResult {
  targetType: AiTargetType;
  handle: string;
  rowNumber: number | null;
  result: AiResultLabel;
  issue: string;
  suggestion: string;
}

export interface ValidationPipelineResult {
  ruleIssues: ValidationIssue[];
  aiInputs: AiEvaluationInput[];
}

export interface ValidationSummary {
  total: number;
  high: number;
  medium: number;
  low: number;
}

export interface AiEvaluationMetrics {
  logicalTitleCount: number;
  logicalBodyCount: number;
  uniqueTitleCount: number;
  uniqueBodyCount: number;
  returnedTitleCount: number;
  returnedBodyCount: number;
}
