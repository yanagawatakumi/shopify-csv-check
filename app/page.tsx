import { FileUploadCard } from "@/components/FileUploadCard";

export default function HomePage() {
  return (
    <main className="min-h-screen bg-gradient-to-b from-slate-100 to-slate-200 px-4 py-10">
      <div className="mx-auto w-full max-w-3xl">
        <h1 className="text-2xl font-bold text-slate-900">Shopify商品CSV 検証</h1>
        <p className="mt-2 text-sm text-slate-700">
          必須項目・軽微ルール・数値ルール・AI文章品質チェックを実行し、問題一覧のExcelを生成します。
        </p>
        <div className="mt-6">
          <FileUploadCard />
        </div>
      </div>
    </main>
  );
}
