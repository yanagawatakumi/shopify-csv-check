import { extractVisibleTextFromHtml, normalizePlainText } from "@/lib/html";
import type { CsvRow, HandleGroup, ParsedCsv, ShopifyColumns, ShopifyRow } from "@/lib/types";

const BODY_COLUMN_PRIORITY = ["Body HTML", "Body (HTML)"] as const;
const IGNORED_COLUMN = "Metafield: judgeme.widget [string]";

function normalizeColumnName(name: string): string {
  return name.replace(/^\uFEFF/, "").trim().toLowerCase();
}

function resolveRequiredColumn(
  columnMap: Map<string, string>,
  candidates: string[],
  label: string,
): string {
  for (const candidate of candidates) {
    const found = columnMap.get(normalizeColumnName(candidate));
    if (found) return found;
  }
  throw new Error(`${label} 列が見つかりません。`);
}

export function resolveShopifyColumns(parsed: ParsedCsv): ShopifyColumns {
  const columnMap = new Map<string, string>();
  for (const header of parsed.headers) {
    if (header === IGNORED_COLUMN) continue;
    columnMap.set(normalizeColumnName(header), header);
  }

  const handle = resolveRequiredColumn(columnMap, ["Handle"], "Handle");
  const title = resolveRequiredColumn(columnMap, ["Title"], "Title");
  const variantPrice = resolveRequiredColumn(columnMap, ["Variant Price"], "Variant Price");

  let body: string | null = null;
  for (const candidate of BODY_COLUMN_PRIORITY) {
    const found = columnMap.get(normalizeColumnName(candidate));
    if (found) {
      body = found;
      break;
    }
  }

  return { handle, title, body, variantPrice };
}

function normalizeHandle(value: string, rowNumber: number): string {
  const normalized = normalizePlainText(value);
  if (normalized.length > 0) return normalized;
  return `__EMPTY_HANDLE__ROW_${rowNumber}`;
}

export function mapShopifyRows(rows: CsvRow[], columns: ShopifyColumns): ShopifyRow[] {
  return rows.map((row) => ({
    rowNumber: row.rowNumber,
    handle: normalizeHandle(row.values[columns.handle] ?? "", row.rowNumber),
    title: row.values[columns.title] ?? "",
    bodyHtml: columns.body ? row.values[columns.body] ?? "" : "",
    variantPrice: row.values[columns.variantPrice] ?? "",
  }));
}

export function groupRowsByHandle(rows: ShopifyRow[]): HandleGroup[] {
  const byHandle = new Map<string, ShopifyRow[]>();

  for (const row of rows) {
    const bucket = byHandle.get(row.handle) ?? [];
    bucket.push(row);
    byHandle.set(row.handle, bucket);
  }

  const groups: HandleGroup[] = [];
  for (const [handle, handleRows] of byHandle.entries()) {
    const sortedRows = [...handleRows].sort((a, b) => a.rowNumber - b.rowNumber);
    const representativeRowNumber = sortedRows[0]?.rowNumber ?? null;
    const combinedBodyHtml = sortedRows.map((row) => row.bodyHtml).join("\n");
    const combinedBodyText = extractVisibleTextFromHtml(combinedBodyHtml);

    groups.push({
      handle,
      rows: sortedRows,
      representativeRowNumber: representativeRowNumber ?? 0,
      combinedBodyHtml,
      combinedBodyText,
    });
  }

  return groups.sort((a, b) => a.representativeRowNumber - b.representativeRowNumber);
}
