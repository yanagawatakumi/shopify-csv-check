import * as XLSX from "xlsx";
import type { ValidationIssue } from "@/lib/types";

const SHEET_NAME = "Validation Report";

export function buildValidationReportBuffer(issues: ValidationIssue[]): ArrayBuffer {
  const rows: (string | number)[][] = [
    ["行番号", "カラム名", "重要度", "問題内容", "修正案"],
  ];

  if (issues.length === 0) {
    rows.push(["", "", "", "問題は検出されませんでした", ""]);
  } else {
    for (const issue of issues) {
      rows.push([
        issue.rowNumber ?? "",
        issue.columnName,
        issue.severity,
        issue.issue,
        issue.suggestion,
      ]);
    }
  }

  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, SHEET_NAME);

  return XLSX.write(workbook, {
    bookType: "xlsx",
    type: "array",
    compression: true,
  }) as ArrayBuffer;
}
