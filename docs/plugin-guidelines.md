# Elgato Plugin Guidelines 対応

確認日: 2026-10-23（Asia/Tokyo）

対象: [Elgato Plugin Guidelines](https://docs.elgato.com/guidelines/stream-deck/plugins/)。このページの Requirements と Recommendations を区別して確認しています。実装と自動検査の適合は、Marketplace の審査通過を保証するものではありません。

| 項目 | 実装・確認内容 |
|---|---|
| UUID | `dev.n7s.media-controls` とその接頭辞を持つ既存のアクション UUID を維持。フォルダー名との一致・重複も検査 |
| Name / Category | `Media Controls` で統一。作者名をカテゴリに付けず、各アクションには説明的な名前と Tooltip を設定 |
| Author | 現在は `Neko7sora`。Marketplace の組織名との一致は公開前に確認が必要 |
| Plugin icon | 256 × 256 / 512 × 512 PNG。元の再生マークを SVG 原稿から再生成 |
| Action list icons | カテゴリ 28 / 56、アクション 20 / 40 px。白 `#FFFFFF`、背景透過の PNG を画素検査 |
| Key icons | 72 / 144 px の PNG を検査。動的なキー画像は 144 px。Now Playing は状態表示を更新し、基本の Play / Pause も再生中は一時停止アイコンへ更新 |
| Actions grouping（推奨） | 10 アクション。対象選択・表示・ダイヤル動作を設定可能。既存プロファイルを継続利用できるようアクション統合・削除は行っていない |
| Layouts | すべての要素が 200 × 100 px 内に収まることとキーの重複を検査。Now Playing + のタップシーク領域は `[0,65,200,35]`。時刻と進捗バーを含む下部全幅で、上部は再生／一時停止。長押しは全域でセッション切替。Volume Dial は全域でミュート |
| Update rate（推奨） | スクロール周期は 100ms。状態通知・設定変更・アニメーションを同じ制限に通し、各キー／ダイヤルの描画完了から次の描画開始まで最低 100ms 確保。変更のない画像／フィードバックは送信しない。操作コマンド自体は待機しない |
| Temporary feedback | 操作失敗は共通の `guarded` でログと `showAlert` を使用。音量・ミュート・再生状態は取得した状態を表示 |
| Property Inspector | 真偽値は checkbox、単一選択は select。変更時に自動保存し、切断した対象を警告。アクション固有の設定は初期化後に表示。Chrome セットアップのヘルプを Stream Deck の `openUrl` 経由で開く |

## 再検査

```powershell
npm run icons:build
npm run guidelines:check
npm run check
npm run validate
```

`guidelines:check` は画像と manifest / layout のローカル検査です。`check` のパッケージ検査にも含まれます。文字スクロールの速度、タップ領域の境界、再生状態の画像変更、通知の集中時の描画間隔と最新設定の反映は JS テストで確認します。

`assets/plugin-icon.svg` はプラグイン設定用 PNG の原稿です。現時点の画像検査は同梱 PNG を対象にしており、アクション画像を SVG / GIF に変更する場合は検査も対応形式に合わせて更新してください。

2026-10-23 の検証では、JS 181 件、翻訳の生成物整合性、Chrome / 設定画面の構文、TypeScript 型チェック、Windows ネイティブヘルパーの release ビルド、プラグインのビルド、同梱画像ランタイムと資産の検査、Elgato CLI `validate` が成功しました。JS のうちローカル HTTP 通信を使う3件はサンドボックスの接続拒否により制限外で再実行して成功しています。フォント描画の検証には作業フォルダー内の一時キャッシュを使用しました。

## 公開前に残る確認

- Marketplace 上で `Media Controls` の名称が重複しないこと。公開検索だけでは名称の利用可否を確定できないため、Maker Console と現行の掲載内容で確認する。
- `Author` が Marketplace の組織名と一致し、名称・画像の使用権があること。
- 実機でキーとダイヤルの表示、失敗アラート、スクロール、下部35pxのシーク、上部タップと長押しを確認する。
- 実際の Stream Deck 設定画面で日本語／英語の初期表示、自動保存、対象切断の警告、ヘルプの起動を確認する。
- CLI の manifest 検証を完了し、Marketplace の商品情報・サポート先なども準備する。本記録は指定ページのプラグインガイドラインに限定しており、他の商品・ブランド・提出ガイドラインの審査完了を意味しない。
