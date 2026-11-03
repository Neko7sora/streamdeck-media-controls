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
| iCUE ウィジェット／内蔵・独立ブリッジ | `tests/icue-widget.test.mjs`、`tests/icue-server.test.mjs`、`tests/icue-runtime.test.mjs`、`tests/icue-integration.test.mjs`、`tests/plugin-routing.test.mjs`、`tests/settings.test.mjs`、`npm run icue:check`、`npm run test:icue:e2e`、`npm run icue:pack`、`npm run icue:bridge:pack`。ネイティブ変更時はRustテストとビルドも実施。実機確認は別途 iCUE / XENEON EDGE で実施 |
| 文書・コマンド・バージョン | `npm run consistency:check` |

Rust のビルド・テストは Windows x64 の Developer PowerShell for Visual Studio と C++ ビルドツールが必要です。実ブラウザテストの初回準備は `npm run test:chrome:install` です。これらを実行できない場合は未検証として記録します。

iCUEのブラウザテストも既存のPlaywright / Chromiumを共用します。`check:fast` はウィジェットのJS構文、公式CLIのソース検証、単体テストを含みます。ブラウザテスト、ネイティブビルド、配布物生成は含みません。初期値のブリッジモードはStream Deckプラグイン内で自動起動し、既存Rustヘルパー・メディア状態・Chrome接続を共有します。Stream Deckアプリなしで動作する独立ブリッジも維持します。明示的に切り替えるiCUE標準モードはMedia Data Providerだけを使用します。構成・権限・独立版とのポート競合は [ウィジェット README](../icue-widget/README.md) を参照してください。

## 配布前

iCUE 5.52.93のインポーターと公式CLI 0.5.1では自己署名証明書の権限タイプ名と項目名が異なります。`npm run icue:check` は `scripts/check-icue.mjs` 経由で一時コピーだけをCLI表記へ変換し、ソースと配布manifestの `self-signed-certificate` / `domain` を維持します。詳細は [互換性の説明](../icue-widget/README.md#icue-55293と公式cliの権限表記の差) を参照してください。

従来の `npm run check` は Rust release ビルドとパッケージ資産の検査を含む完全な検査です。`check:fast` で代替しません。正式配布は [README のビルド手順](../README.md#windows-x64-ビルド) と [総合監査](guideline-audit.md) に従います。実機確認・公開者確認の記録は自動テストとは別に必要です。

編集先の一覧は [AGENTS.md](../AGENTS.md)、実装の責務は [ソース構成](source-structure.md)、生成物の編集元は [ドキュメント一覧](README.md) を参照してください。
