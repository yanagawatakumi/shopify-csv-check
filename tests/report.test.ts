import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { buildValidationReportBuffer } from "@/lib/report";

describe("report generation", () => {
  it("writes validation report sheet and columns", () => {
    const buffer = buildValidationReportBuffer([
      {
        rowNumber: 2,
        columnName: "Title",
        severity: "高",
        issue: "Title が未入力です。",
        suggestion: "入力してください。",
      },
    ]);

    const workbook = XLSX.read(buffer, { type: "array" });
    expect(workbook.SheetNames).toContain("Validation Report");

    const sheet = workbook.Sheets["Validation Report"];
    const rows = XLSX.utils.sheet_to_json<(string | number)[]>(sheet, { header: 1 });

    expect(rows[0]).toEqual(["行番号", "カラム名", "重要度", "問題内容", "修正案"]);
    expect(rows[1]?.[0]).toBe(2);
    expect(rows[1]?.[1]).toBe("Title");
  });

  it("writes no issue message when issues are empty", () => {
    const buffer = buildValidationReportBuffer([]);
    const workbook = XLSX.read(buffer, { type: "array" });
    const sheet = workbook.Sheets["Validation Report"];
    const rows = XLSX.utils.sheet_to_json<(string | number)[]>(sheet, { header: 1 });

    expect(rows[1]?.[3]).toBe("問題は検出されませんでした");
  });
});
