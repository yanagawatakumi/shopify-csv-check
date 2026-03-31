import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { evaluateLanguageQuality } from "@/lib/ai";
import { parseShopifyCsv } from "@/lib/csv";
import { buildValidationReportBuffer } from "@/lib/report";
import { groupRowsByHandle, mapShopifyRows, resolveShopifyColumns } from "@/lib/shopify";
import type { AiEvaluationResult, Severity, ValidationIssue } from "@/lib/types";
import { runRuleValidation, summarizeIssues } from "@/lib/validation";

const MAX_CSV_ROWS = 2_000;

const severityOrder: Record<Severity, number> = {
  高: 0,
  中: 1,
  低: 2,
};

function toAiIssues(results: AiEvaluationResult[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  for (const item of results) {
    if (item.result === "OK") continue;

    issues.push({
      rowNumber: item.rowNumber,
      columnName: item.targetType === "title" ? "Title" : "Body HTML / Body (HTML)",
      severity: item.result === "NG" ? "高" : "中",
      issue: item.issue,
      suggestion: item.suggestion,
      handle: item.handle,
    });
  }

  return issues;
}

function sortIssues(issues: ValidationIssue[]): ValidationIssue[] {
  return [...issues].sort((a, b) => {
    const rowA = a.rowNumber ?? Number.MAX_SAFE_INTEGER;
    const rowB = b.rowNumber ?? Number.MAX_SAFE_INTEGER;

    if (rowA !== rowB) return rowA - rowB;
    if (a.columnName !== b.columnName) return a.columnName.localeCompare(b.columnName);
    return severityOrder[a.severity] - severityOrder[b.severity];
  });
}

function safeReportFileName(inputName: string): string {
  const base = inputName.replace(/\.csv$/i, "").replace(/[^a-zA-Z0-9._-]/g, "_");
  return `${base || "report"}-validation-report.xlsx`;
}

export async function POST(request: Request): Promise<Response> {
  try {
    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "CSVファイルを選択してください。" }, { status: 400 });
    }

    if (!file.name.toLowerCase().endsWith(".csv")) {
      return NextResponse.json({ error: "CSV形式のファイルのみアップロードできます。" }, { status: 400 });
    }

    const csvText = await file.text();
    if (csvText.trim().length === 0) {
      return NextResponse.json({ error: "CSVファイルが空です。" }, { status: 400 });
    }

    const parsed = parseShopifyCsv(csvText);

    if (parsed.rows.length > MAX_CSV_ROWS) {
      return NextResponse.json(
        { error: `CSVの行数が上限を超えています。上限: ${MAX_CSV_ROWS} 行` },
        { status: 400 },
      );
    }

    const columns = resolveShopifyColumns(parsed);
    const rows = mapShopifyRows(parsed.rows, columns);
    const groups = groupRowsByHandle(rows);

    const { ruleIssues, aiInputs } = runRuleValidation(rows, groups, columns);
    const { results: aiResults, metrics } = await evaluateLanguageQuality(aiInputs);

    const aiIssues = toAiIssues(aiResults);
    const allIssues = sortIssues([...ruleIssues, ...aiIssues]);
    const summary = summarizeIssues(allIssues);

    const reportBytes = buildValidationReportBuffer(allIssues);
    const reportFileName = safeReportFileName(file.name);

    return new Response(reportBytes, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${reportFileName}"`,
        "Cache-Control": "no-store",
        "X-Issue-Total": String(summary.total),
        "X-Issue-High": String(summary.high),
        "X-Issue-Medium": String(summary.medium),
        "X-Issue-Low": String(summary.low),
        "X-AI-Logical-Title": String(metrics.logicalTitleCount),
        "X-AI-Logical-Body": String(metrics.logicalBodyCount),
        "X-AI-Unique-Title": String(metrics.uniqueTitleCount),
        "X-AI-Unique-Body": String(metrics.uniqueBodyCount),
      },
    });
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        { error: "AI評価結果の形式が不正です。再実行してください。" },
        { status: 502 },
      );
    }

    const message = error instanceof Error ? error.message : "不明なエラーが発生しました。";
    const status = message.includes("見つかりません") || message.includes("CSV") ? 400 : 500;

    return NextResponse.json({ error: message }, { status });
  }
}
