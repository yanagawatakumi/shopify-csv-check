"use client";

import { useEffect, useMemo, useState, type DragEventHandler } from "react";
import { ResultSummary, type IssueSummary } from "@/components/ResultSummary";

function parseDownloadName(contentDisposition: string | null): string {
  if (!contentDisposition) return "validation-report.xlsx";
  const match = contentDisposition.match(/filename="?([^";]+)"?/i);
  return match?.[1] ?? "validation-report.xlsx";
}

function parseSummaryFromHeaders(headers: Headers): IssueSummary {
  const toNumber = (key: string): number => {
    const value = headers.get(key);
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  };

  return {
    total: toNumber("X-Issue-Total"),
    high: toNumber("X-Issue-High"),
    medium: toNumber("X-Issue-Medium"),
    low: toNumber("X-Issue-Low"),
  };
}

function isCsvFile(file: File): boolean {
  return file.name.toLowerCase().endsWith(".csv");
}

export function FileUploadCard() {
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [summary, setSummary] = useState<IssueSummary | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [downloadName, setDownloadName] = useState("validation-report.xlsx");
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const canSubmit = useMemo(() => !!file && !isLoading, [file, isLoading]);

  useEffect(() => {
    return () => {
      if (downloadUrl) {
        URL.revokeObjectURL(downloadUrl);
      }
    };
  }, [downloadUrl]);

  const clearPreviousResult = () => {
    if (downloadUrl) {
      URL.revokeObjectURL(downloadUrl);
    }
    setDownloadUrl(null);
    setSummary(null);
    setSuccessMessage(null);
  };

  const onSelectFile = (nextFile: File | null) => {
    setError(null);
    clearPreviousResult();

    if (!nextFile) {
      setFile(null);
      return;
    }

    if (!isCsvFile(nextFile)) {
      setFile(null);
      setError(".csv ファイルのみアップロードできます。");
      return;
    }

    setFile(nextFile);
  };

  const onDrop: DragEventHandler<HTMLDivElement> = (event) => {
    event.preventDefault();
    setIsDragOver(false);
    const nextFile = event.dataTransfer.files?.[0] ?? null;
    onSelectFile(nextFile);
  };

  const onValidate = async () => {
    if (!file) return;

    setIsLoading(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const body = new FormData();
      body.append("file", file);

      const response = await fetch("/api/validate", {
        method: "POST",
        body,
      });

      if (!response.ok) {
        const errorJson = (await response.json()) as { error?: string };
        throw new Error(errorJson.error ?? "検証中にエラーが発生しました。");
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const parsedName = parseDownloadName(response.headers.get("Content-Disposition"));

      clearPreviousResult();
      setDownloadUrl(url);
      setDownloadName(parsedName);
      setSummary(parseSummaryFromHeaders(response.headers));
      setSuccessMessage("検証が完了しました。レポートをダウンロードできます。");
    } catch (e) {
      const message = e instanceof Error ? e.message : "検証に失敗しました。";
      setError(message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <section className="w-full rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="text-lg font-semibold text-slate-900">CSV検証ツール</h2>
      <p className="mt-1 text-sm text-slate-600">Shopify商品CSVをアップロードしてExcelレポートを生成します。</p>

      <div
        onDragOver={(event) => {
          event.preventDefault();
          setIsDragOver(true);
        }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={onDrop}
        className={`mt-4 rounded-lg border-2 border-dashed p-5 text-sm transition ${
          isDragOver ? "border-sky-500 bg-sky-50" : "border-slate-300 bg-slate-50"
        }`}
      >
        <label className="block cursor-pointer text-slate-700">
          <span className="font-medium">CSVファイルを選択</span>
          <input
            className="mt-2 block w-full text-sm"
            type="file"
            accept=".csv,text/csv"
            onChange={(event) => onSelectFile(event.target.files?.[0] ?? null)}
          />
        </label>
        <p className="mt-2 text-xs text-slate-500">ドラッグ＆ドロップにも対応（.csvのみ）</p>
      </div>

      <div className="mt-4 text-sm text-slate-700">
        <span className="font-medium">選択中ファイル:</span> {file ? file.name : "未選択"}
      </div>

      <button
        type="button"
        disabled={!canSubmit}
        onClick={onValidate}
        className="mt-4 inline-flex items-center rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-400"
      >
        {isLoading ? "処理中..." : "バリデーション実行"}
      </button>

      {error && <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {successMessage && <p className="mt-3 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{successMessage}</p>}

      {summary && <ResultSummary summary={summary} />}

      {downloadUrl && (
        <a
          href={downloadUrl}
          download={downloadName}
          className="mt-4 inline-flex items-center rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 transition hover:bg-slate-100"
        >
          Excelレポートをダウンロード
        </a>
      )}
    </section>
  );
}
