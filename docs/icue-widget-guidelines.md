# iCUE Widget 仕様への対応

確認日: 2026-11-04（Asia/Tokyo）。指定された [Widgets](https://docs.elgato.com/guidelines/icue/widgets) は現在 [Getting Started](https://docs.elgato.com/icue/widgets/) へ転送されます。この文書はリンク先から参照される Widget API 1.9.0 の技術仕様と、既存の Edge Media Deck の対応を整理します。Marketplace の審査・公開可否や実機受け入れを認証するものではありません。

## 仕様と実装の対応

| 公式資料・確認項目 | 対応と確認方法 |
|---|---|
| [Specification](https://docs.elgato.com/icue/widgets/specification/): 必須ファイル・manifest | `icue-widget/` にHTML、manifest、アイコンを配置。Windows、iCUE 5.52、Widget API 1.9.0を宣言。`npm run icue:check` で公式CLI 0.5.1を実行 |
| HTMLと設定 | 大文字DOCTYPE、XMLとして整形式のhead、`tr('Edge Media Deck')` のtitle、公式のmetaと設定グループを使用。CLIに加え、設定IDの重複、ラベル欠落、グループの未宣言ID・重複参照を検査 |
| 選択画面のプレビュー | `x-icue-widget-preview` の画像を128×56pxに修正。実際のUIと公開テストデータから生成し、縦横比を保持して余白を追加。`icue:check` とパッケージ生成で寸法・参照先を検査 |
| [Controls](https://docs.elgato.com/icue/widgets/references/controls/): 設定値 | `switch`、`textfield`、`slider`、`color` を使用。既存ID・初期値・保存済み設定の互換性を維持。プロパティ変更は `onDataUpdated` で反映 |
| 対応デバイス | 対話型のXENEON EDGE（`dashboard_lcd`）のみ宣言。ブラウザテストでS/M/L/XLの横・縦8枠、縮小プレビュー、文字サイズ75～150%、個別表示設定を検査 |
| 初期化・破棄 | `icueEvents` と `pluginMediadataproviderEvents` を登録し、遅延初期化・プロバイダー交換・非表示・復帰を処理。ホストのローカルスコープへイベントと設定を結び付ける配布HTMLもブラウザテストで確認 |
| [Media Data Provider](https://docs.elgato.com/icue/widgets/references/plugins/media-data-provider/): 標準モード | `widgetbuilder.mediadataprovider:Media:1.1` と公開プロパティ・メソッド・シグナルを使用。非同期応答の対応付け・タイムアウト・古い応答の破棄をテスト |
| [Translations](https://docs.elgato.com/icue/widgets/references/translations/): 設定の翻訳 | ルートの `translation.json` に英語と日本語を配置。head内のリテラル `tr('key')` の英語フォールバックを検査。画面本文・操作ラベルは現在の日本語仕様を維持 |
| [Permissions](https://docs.elgato.com/icue/widgets/references/permissions/): 通信と障害 | 通信先は認証付きの `https://127.0.0.1:39762` に限定。取得失敗・拒否・失効時は操作を無効にし、確認案内と再接続を表示。外部ホストへの通信なしをブラウザテストで確認 |
| 配布 | `npm run icue:pack` でデモを除去し、body内へ実行スクリプトを埋め込み、公式CLI検証と追加検査を経てロック済みCLIのZIP生成処理で `.icuewidget` を作成 |

## 権限監査と互換性の例外

今回、権限の追加・削除・範囲変更はありません。ウィジェット独自のネットワーク呼び出しは `scripts/bridge.js` のイベント取得とコマンド送信で、どちらも同じ固定HTTPSエンドポイントを使います。ファイル読取り、クリップボード、マイク・カメラ、Stream Deck Provider は使用しません。Stream Deck内蔵ブリッジへのHTTPS通信は、公式Stream Deck Providerによる接続とは異なるため、`application` 権限は追加しません。

| 配布manifestの権限 | 範囲 | 目的 |
|---|---|---|
| `url` | `127.0.0.1:39762` | ローカルブリッジからの情報取得と操作 |
| `self-signed-certificate` | `domain: 127.0.0.1` | 同ブリッジの自己署名TLS証明書 |

**自己署名証明書の権限表記は、公式文書と完全には一致しません。** 公式文書・CLIは `self_signed_certificate` / `host`、既存のiCUE 5.52.93向け配布物は `self-signed-certificate` / `domain` を使用します。既存実装のインポート互換性を維持し、検証時の一時コピーだけを公式表記へ変換します。元manifestが変わらないこと、変換後も不正なホスト・未宣言通信を拒否することを回帰テストで確認します。背景と導入時の注意は [ウィジェットREADME](../icue-widget/README.md#icue-55293と公式cliの権限表記の差) を参照してください。

Media Providerが返すPNG data URLは、同Providerの公式資料が画像への直接設定を明示しています。汎用の権限資料の `data:` / `blob:` 通信制限から、外部URL取得の許可を推測していません。画像はサイズと形式を制限し、読込み失敗時にプレースホルダーへ戻します。iCUEによる権限強制は通常のブラウザでは再現できません。

## 更新時の検証

```powershell
npm run icue:preview
npm run icue:check
npm run check:fast
npm run test:icue:e2e
npm run icue:pack
```

`icue:preview` はテスト用ローカルブリッジとPlaywrightを使い、プレビューPNGを再生成してブリッジE2Eも実行します。通常のE2Eは配布画像を上書きしません。必要なブラウザの準備と追加検査は [開発手順](development.md) を参照してください。

実iCUEでのインポート、権限の拒否・再許可、自己署名TLS、タッチ、スリープ復帰は実機での確認が必要です。今回の自動検証を実機確認済みの記録として扱わず、将来のiCUEで権限形式が変わった場合は互換処理を再評価してください。

## 今回の実行結果

上記確認日に以下が成功しました。実行環境ではnpmコマンドを起動できなかったため、対応するNodeスクリプトを直接実行しました。ブラウザ・ローカル通信・一時ディレクトリ削除の制限を受けた初回実行は成功扱いにせず、許可された実行環境で再検証しています。

| 実行した検査 | 結果 |
|---|---|
| `node scripts/check-fast.mjs` | 公式CLIと追加検査、整合性、翻訳、JS構文、型、全302単体テストが成功 |
| `node tests/icue-e2e.mjs` | 標準モード、全8枠、縮小プレビュー、設定、空・読込み・エラー状態、復帰、外部通信なしが成功 |
| `node tests/icue-bridge-e2e.mjs --update-preview` | プレビュー生成、ブリッジ操作、対象選択、古い操作の拒否、切断・復帰、トークン復旧、配布HTMLのホストスコープが成功 |
| `node scripts/pack-icue.mjs` | ウィジェットを再生成。ZIP内の128×56プレビュー、元の権限2項目、デモ非同梱も確認 |
| `node scripts/pack-icue-bridge.mjs` | 既存Rustヘルパーのreleaseビルドと独立ブリッジZIPの再生成が成功 |
| `node scripts/build-marketplace.mjs` / `node scripts/check-marketplace.mjs` | 既存Marketplace画像の再生成とローカル検査が成功 |
