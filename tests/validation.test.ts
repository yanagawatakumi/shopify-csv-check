import { describe, expect, it } from "vitest";
import { groupRowsByHandle } from "@/lib/shopify";
import type { ShopifyColumns, ShopifyRow } from "@/lib/types";
import { runRuleValidation } from "@/lib/validation";

const columns: ShopifyColumns = {
  handle: "Handle",
  title: "Title",
  body: "Body HTML",
  variantPrice: "Variant Price",
};

function makeRow(rowNumber: number, handle: string, title: string, bodyHtml: string, price: string): ShopifyRow {
  return {
    rowNumber,
    handle,
    title,
    bodyHtml,
    variantPrice: price,
  };
}

describe("validation rules", () => {
  it("checks body required at handle unit", () => {
    const rows = [
      makeRow(2, "a", "title", "", "120"),
      makeRow(3, "a", "title", "<p>本文あり</p>", "130"),
      makeRow(4, "b", "title", "<p></p><br>&nbsp;", "200"),
    ];

    const groups = groupRowsByHandle(rows);
    const result = runRuleValidation(rows, groups, columns);

    const bodyIssues = result.ruleIssues.filter((issue) => issue.columnName.includes("Body"));
    expect(bodyIssues).toHaveLength(1);
    expect(bodyIssues[0]?.rowNumber).toBe(4);
    expect(bodyIssues[0]?.severity).toBe("高");
  });

  it("checks numeric boundaries", () => {
    const rows = [
      makeRow(2, "a", "title", "body", "99"),
      makeRow(3, "b", "title", "body", "100"),
      makeRow(4, "c", "title", "body", "1000000"),
      makeRow(5, "d", "title", "body", "1000001"),
      makeRow(6, "e", "title", "body", "0"),
    ];

    const groups = groupRowsByHandle(rows);
    const result = runRuleValidation(rows, groups, columns);

    const priceIssues = result.ruleIssues.filter((issue) => issue.columnName === "Variant Price");
    expect(priceIssues).toHaveLength(3);

    expect(priceIssues.find((i) => i.rowNumber === 2)?.severity).toBe("中");
    expect(priceIssues.find((i) => i.rowNumber === 5)?.severity).toBe("中");
    expect(priceIssues.find((i) => i.rowNumber === 6)?.severity).toBe("高");
  });

  it("builds ai inputs for title and body", () => {
    const rows = [
      makeRow(2, "a", "  同じタイトル  ", "<p>本文1</p>", "120"),
      makeRow(3, "a", "同じタイトル", "<p>本文2</p>", "120"),
      makeRow(4, "b", "別タイトル", "<p>別本文</p>", "130"),
    ];

    const groups = groupRowsByHandle(rows);
    const result = runRuleValidation(rows, groups, columns);

    const titleInputs = result.aiInputs.filter((input) => input.targetType === "title");
    const bodyInputs = result.aiInputs.filter((input) => input.targetType === "body");

    expect(titleInputs).toHaveLength(2);
    expect(bodyInputs).toHaveLength(2);
  });
});
