import { describe, expect, it } from "vitest";
import { extractVisibleTextFromHtml, isBodyHtmlMeaningful, normalizePlainText } from "@/lib/html";

describe("html utilities", () => {
  it("treats empty html patterns as empty", () => {
    expect(isBodyHtmlMeaningful("")).toBe(false);
    expect(isBodyHtmlMeaningful("   \n\n")).toBe(false);
    expect(isBodyHtmlMeaningful("<p></p><br>&nbsp;")).toBe(false);
    expect(isBodyHtmlMeaningful("<div><p>&nbsp;</p><br/></div>")).toBe(false);
  });

  it("extracts visible text from html", () => {
    const text = extractVisibleTextFromHtml("<p>商品&nbsp;説明</p><p>改行あり</p>");
    expect(text).toBe("商品 説明\n改行あり");
  });

  it("normalizes plain text", () => {
    expect(normalizePlainText("A&nbsp;  B\n\nC")).toBe("A B\nC");
  });
});
