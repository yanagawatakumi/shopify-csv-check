# Shopify CSV検証ツール（MVP）

Shopifyの商品CSVをアップロードし、以下を自動実行するWebアプリです。

- CSV読み込み（クォート・改行入りセル対応）
- 必須項目チェック / 軽微ルールチェック / 数値チェック
- Title / Body の全文AI品質評価（OpenAI Responses API）
- 問題一覧を `.xlsx` で生成
- ブラウザからレポートをダウンロード

このアプリは**チャットUIではなくCSV検証ツール**として設計しています。

## 技術スタック

- Next.js (App Router)
- TypeScript
- Tailwind CSS
- OpenAI Responses API (Structured Output)
- Cloudflare Workers + OpenNext

## ローカル開発手順

1. 依存関係をインストール

```bash
npm install
```

2. 環境変数を設定

```bash
cp .env.example .env.local
```

3. 開発サーバー起動

```bash
npm run dev
```

4. ブラウザで確認

- `http://localhost:3000`

## 必要な環境変数

- `OPENAI_API_KEY`（必須）
- `OPENAI_MODEL`（任意、未指定時は `gpt-4.1-mini`）

`.env.example`:

```env
OPENAI_API_KEY=sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxx
OPENAI_MODEL=gpt-4.1-mini
```

## OpenAI API設定方法

1. OpenAIでAPIキーを発行
2. `OPENAI_API_KEY` に設定
3. 必要なら `OPENAI_MODEL` を変更

本アプリは `POST /v1/responses` を利用し、JSON SchemaによるStructured OutputでAI判定を受け取ります。

## Cloudflareへのデプロイ（OpenNext + Wrangler）

### 事前準備

- Cloudflareアカウント
- Wranglerログイン

```bash
npx wrangler login
```

### デプロイ手順

1. `wrangler.toml` の `name` を必要に応じて変更
2. Cloudflare側で環境変数を設定

```bash
npx wrangler secret put OPENAI_API_KEY
npx wrangler secret put OPENAI_MODEL
```

3. ビルドとデプロイ

```bash
npm run deploy
```

4. ローカルでWorkersプレビュー

```bash
npm run preview:worker
```

## GitHub運用前提の注意点

- `.env*` は `.gitignore` 対象（`.env.example` のみコミット）
- APIキーをコードへ直書きしない
- PR時は `npm run test` / `npm run lint` / `npm run build` 実行を推奨

## AIバリデーションの仕組み

- 対象:
  - Title（空を除外）
  - Body（Handle単位で結合後、空を除外）
- 前処理:
  - HTML除去
  - `&nbsp;` 正規化
  - 空白・改行正規化
  - 可視テキスト抽出
- コスト最適化:
  - `targetType + 正規化テキスト` で重複除去
  - バッチ送信
- 信頼性:
  - 評価対象件数（論理件数/ユニーク件数）を計測
  - AI返却件数・キー一致を検証
  - 不一致時はエラーとして処理中断
- レポート出力:
  - `OK` は出力しない
  - `要注意` / `NG` のみ出力

## 検証ルール（実装済み）

- Required
  - Title空チェック（行単位）
  - Body空チェック（Handle単位、同一Handleで1件でも本文があればOK）
  - Variant Price 空/0 チェック
- Format（軽微）
  - 連続スペース
  - 異常句読点
- Numeric
  - 価格異常（100未満 または 1,000,000超）

## API仕様

- `POST /api/validate`
  - Input: `multipart/form-data` (`file`)
  - Output:
    - 成功: `.xlsx` バイナリ（`Validation Report`）
    - 失敗: `{"error": "..."}`

## 現時点の制約

- MVPは同期処理のため、1ファイルあたり最大2,000行を目安
- AI評価コストはテキスト量と件数に依存
- 認証・履歴保存・ジョブ管理は未実装

## 今後の改善案

- Queue + R2による非同期大容量処理
- 認証/権限管理
- 実行履歴保存・再ダウンロード
- レポートの可視化ダッシュボード
- バリデーションルールのプロジェクト別設定

## テスト

```bash
npm run test
```

## ライセンス

社内利用を想定したMVPのため、必要に応じて適切なライセンスを設定してください。
