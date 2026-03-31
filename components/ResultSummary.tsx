export interface IssueSummary {
  total: number;
  high: number;
  medium: number;
  low: number;
}

interface ResultSummaryProps {
  summary: IssueSummary;
}

export function ResultSummary({ summary }: ResultSummaryProps) {
  return (
    <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
      <p className="font-medium text-slate-900">結果サマリー</p>
      <p className="mt-1">検出件数: {summary.total}件</p>
      <p>高: {summary.high} / 中: {summary.medium} / 低: {summary.low}</p>
    </div>
  );
}
