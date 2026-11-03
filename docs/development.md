# 開発・Codex の作業手順

## 最初の確認

Node.js 24 以降と Git を使用します。リポジトリのルートで実行してください。

```sh
npm ci
node scripts/doctor.mjs
node scripts/check-fast.mjs
```

`doctor` は環境を変更せず、Node・主要依存・Git の不足を終了コード1で報告します。Rust の有無は補足情報です。npm 自体の動作、Windows SDK、C++ リンカー、ブラウザのインストールまでは検証しません。

`check:fast` は整合性・翻訳生成物・Chrome/設定画面/iCUE のJS構文・公式CLIでのiCUEソース検証・TypeScript・全単体テストを順番に確認します。Rust ビルド、パッケージ生成、外部スキーマ取得は行いません。単体テストは一時ファイルやローカル通信を使います。依存が導入済みなら npm の起動に問題がある環境でも `node scripts/check-fast.mjs` で実行できます。

`npm test` と `npm run test:unit` は同じ全単体テストです。単一ファイルやテスト名で絞る場合は Node を直接使用します。

`check:fast` の単体テストには120秒のテストタイムアウトがあります。ローカル通信が制限された実行環境では通信テストが失敗する場合があります。失敗をスキップして成功扱いにはせず、エラー内容と実行環境を確認してください。

```sh
node --test tests/media-model.test.mjs
node --test --test-name-pattern="seek" tests/media-seek.test.mjs
```

## 変更に応じた追加検査

| 変更範囲 | 関連テスト・追加手順 |
|---|---|
| アクション・対象選択 | `tests/plugin-routing.test.mjs`、`tests/media-model.test.mjs`、`tests/media-state.test.mjs` |
| シーク | `tests/media-seek.test.mjs`、`tests/plugin-routing.test.mjs` |
| 設定画面 | `tests/settings.test.mjs`、`tests/localization.test.mjs` |
| 描画・画像 | `tests/artwork.test.mjs`、`tests/control-display.test.mjs`、`tests/scrolling-text.test.mjs`。`npm run marketplace:build` 後に `npm run marketplace:check` |
| Chrome 通信・権限 | `tests/chrome-*.test.mjs`、`npm run chrome:security:check`。実ブラウザ確認は `npm run test:chrome:e2e` |
| Rust・ネイティブ通信 | `tests/native-client.test.mjs`、`npm run test:native`、`npm run build`、`npm run test:smoke` |
| 翻訳 | `npm run locales:build` 後に `npm run locales:check`、`tests/localization.test.mjs` |
| iCUE ウィジェット | `tests/icue-widget.test.mjs`、`npm run icue:check`、`npm run test:icue:e2e`、`npm run icue:pack`。実機確認は別途 iCUE / XENEON EDGE で実施 |
| 文書・コマンド・バージョン | `npm run consistency:check` |

Rust のビルド・テストは Windows x64 の Developer PowerShell for Visual Studio と C++ ビルドツールが必要です。実ブラウザテストの初回準備は `npm run test:chrome:install` です。これらを実行できない場合は未検証として記録します。

iCUE のブラウザテストも既存の Playwright / Chromium を共用します。`check:fast` はウィジェットの JS 構文、公式 CLI のソース検証、単体テストを含みます。ブラウザテストと `.icuewidget` 生成は含みません。ウィジェットは iCUE の Media Data Provider を直接使用し、Stream Deck プラグイン・Rust ヘルパー・Chrome ブリッジを必要としません。構成と制限は [ウィジェット README](../icue-widget/README.md) を参照してください。

## 配布前

従来の `npm run check` は Rust release ビルドとパッケージ資産の検査を含む完全な検査です。`check:fast` で代替しません。正式配布は [README のビルド手順](../README.md#windows-x64-ビルド) と [総合監査](guideline-audit.md) に従います。実機確認・公開者確認の記録は自動テストとは別に必要です。

編集先の一覧は [AGENTS.md](../AGENTS.md)、実装の責務は [ソース構成](source-structure.md)、生成物の編集元は [ドキュメント一覧](README.md) を参照してください。
