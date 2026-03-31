import Papa from "papaparse";
import type { CsvRow, ParsedCsv } from "@/lib/types";

function normalizeHeader(header: string): string {
  return header.replace(/^\uFEFF/, "").trim();
}

function toStringRecord(record: Record<string, unknown>): Record<string, string> {
  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(record)) {
    if (key === "__parsed_extra") continue;
    normalized[key] = typeof value === "string" ? value : value == null ? "" : String(value);
  }
  return normalized;
}

export function parseShopifyCsv(csvText: string): ParsedCsv {
  const parsed = Papa.parse<Record<string, unknown>>(csvText, {
    header: true,
    skipEmptyLines: false,
    transformHeader: normalizeHeader,
  });

  if (parsed.errors.length > 0) {
    const firstError = parsed.errors[0];
    throw new Error(`CSVの解析に失敗しました: ${firstError.message}`);
  }

  const headers = (parsed.meta.fields ?? []).map(normalizeHeader);
  const rows: CsvRow[] = parsed.data.map((record, index) => ({
    rowNumber: index + 2,
    values: toStringRecord(record),
  }));

  return { headers, rows };
}
