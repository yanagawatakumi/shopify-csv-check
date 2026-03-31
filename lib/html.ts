import { decode } from "he";
import { parse } from "node-html-parser";

export function normalizeWhitespace(text: string): string {
  return text.replace(/\r\n?/g, "\n").replace(/[\t\f\v ]+/g, " ").replace(/\n+/g, "\n").trim();
}

export function normalizePlainText(text: string): string {
  const decoded = decode((text ?? "").replace(/&nbsp;/gi, " "));
  return normalizeWhitespace(decoded);
}

export function extractVisibleTextFromHtml(html: string): string {
  if (!html || html.trim().length === 0) return "";

  const htmlWithBreaks = html
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\s*\/p\s*>/gi, "\n")
    .replace(/&nbsp;/gi, " ");

  const root = parse(htmlWithBreaks, {
    blockTextElements: {
      script: false,
      style: false,
      noscript: false,
      pre: true,
    },
  });

  const text = decode(root.structuredText ?? "");
  return normalizeWhitespace(text);
}

export function hasMeaningfulText(text: string): boolean {
  return normalizePlainText(text).length > 0;
}

export function isBodyHtmlMeaningful(html: string): boolean {
  return extractVisibleTextFromHtml(html).length > 0;
}
