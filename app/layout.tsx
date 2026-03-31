import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Shopify CSV検証ツール",
  description: "Shopify商品CSVの検証レポートを生成する業務ツール",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
