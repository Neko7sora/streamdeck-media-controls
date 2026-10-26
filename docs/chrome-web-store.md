# Chrome Web Store ベストプラクティス対応

確認日: 2026-10-25（Asia/Tokyo）。対象: [Best practices](https://developer.chrome.com/docs/webstore/best-practices)。

コード、掲載原稿、提出用画像、ローカル検査を整備した段階。**公開準備中**。ストアの申告・公開 URL・実機での受け入れ確認・Google の審査は別途必要。

必須の [Program Policies 対応記録](chrome-program-policies.md) に、Limited Use・権限・同意・安全な取り扱い・最小機能・掲載内容・公開者設定との照合をまとめた。外部プラグインが必要な構成の [審査用手順](chrome-web-store/reviewer-instructions.md) も用意している。

[優れたリスティング ページへの対応](chrome-web-store/best-listing.md) に、概要・説明・アイコン・スクリーンショット・プロモーション画像・リンクの照合と、ダッシュボードへ渡すファイルをまとめた。小型プロモーション画像（必須）とマーキー画像（任意）は、既存の製品マークを使った文字なしの図で用意している。

Chrome 公式の Improve extension security の項目別対応と、任意文字列実行・外部コード読み込み・CSP 緩和の自動検査は [拡張のセキュリティ要件への対応](chrome-extension-security.md) にまとめた。`chrome:store:check` と ZIP 作成時にもこの検査を実行する。

## 対応範囲

| 観点 | 実装・用意したもの | 公開前の残作業 |
|---|---|---|
| Manifest V3 | MV3 service worker、Chrome 111 以降、日英の manifest メタデータ、16/32/48/128px PNG アイコン | Chrome Stable と最小対応版で読み込み確認 |
| 単一目的・権限 | ブラウザの再生情報と Stream Deck のローカル連携。storage / nativeMessaging と HTTP/HTTPS のサイトアクセスを理由付きで説明 | 広いサイトアクセスの必要性を申告し、実際のインストール警告とサイト制限時の挙動を確認 |
| セキュリティ | 同梱 JS のみ、明示的 CSP、公開 HTTPS 画像の取得制限、文書と操作対象の照合、認証付きローカル接続、TRUSTED_CONTEXTS の設定保存 | Native Messaging の登録・切断・再接続を実機確認。アカウントの2段階認証等の公開者設定 |
| プライバシー | 送信は初期無効。トグルに隣接する転送項目と外部画像通信の説明、同梱の日英ポリシー、停止・削除手順。メディアなしの通知はページ名・URL・任意データを除去 | ポリシーの公開 HTTPS URL を確定し、GitHub Issues の到達性を確認して、Privacy practices でデータ分類・Limited use を最終申告 |
| 性能・機能 | 状態差分、画像共有・容量制限、送信レート制限。content script に unload / WebSocket / WebRTC 接続なし | 実サイトの戻る／進むキャッシュ、低速回線、バックグラウンドタブ、複数フレーム、Stream Deck 実機の操作・復旧 |
| UX / onboarding | 接続バッジ、設定読込・保存・エラー表示、必要な Windows / プラグイン / Node.js と拡張 ID 登録の案内、再生タブの再読込手順 | 初回ユーザーが掲載説明から最後まで設定できることを確認 |
| 掲載情報 | [英語原稿](chrome-web-store/listing.en.json)、[日本語原稿](chrome-web-store/listing.ja.json)、貼り付け用説明、実拡張設定画面の1280×800スクリーンショット、440×280プロモーション・1400×560マーキー画像、Tools カテゴリ案、サポートリンク | プラグイン配布先と必要環境の到達性、名称・商標・画像の権利、価格と配布地域を確認。実機操作の画像や動画の追加も推奨 |

HTTP のページ情報は既存のメディアページ対応のために観測する。画像取得は HTTPS のみ。Native Messaging ホストからプラグインへの HTTP は認証付きの `127.0.0.1` 固定で、外部ネットワークへ送らない。拡張は loopback に直接接続せず、トークンを保持しない。

`activeTab` の一時的なアクセスでは複数タブの継続観測を満たさない。広いホストアクセスは現行機能に対応する宣言として維持した。任意権限への移行は別の設計変更になる。サイトアクセスを制限した場合は対象ページ・埋込フレーム・画像配信元の一部を利用できなくなる。

明示的な `host_permissions` は画像取得に必要な HTTPS だけに縮小した。HTTP ページでの観測は静的 content script の `matches` が担う。CSP は Chrome の MV3 指針に合わせて `script-src 'self'` を使用する。既存の静的 `importScripts` と競合する Trusted Types 強制や、外部への違反レポート送信は追加しない。プラグイン要素、base の変更、フォーム送信、HTTP fetch を CSP で禁止する。

送信を無効にしても既に挿入された MAIN world スクリプトはメディア API を観測できる。送信停止とスクリプト停止を区別して、設定画面・ポリシー・掲載原稿で説明する。

## 再生成と検査

```powershell
npm run chrome:icons
npm run locales:build
npm run chrome:listing:build
npx playwright install chromium
npm run test:chrome:e2e -- --screenshots
npm run chrome:store:check
npm run check
npm run chrome:pack
```

`test:chrome:e2e` は専用の一時プロファイルを使う。通常の Chrome プロファイルや Native Messaging のレジストリを変更しない。ホストの登録は Windows ユーザー単位で共有されるため、テスト中の Native Messaging API は接続失敗を返すスタブに置き換え、実ホストへの接続を防ぐ。日英、初期無効、接続失敗時の表示、保存・再読み込み、ポリシー表示、320/420/1280px と明暗の表示を検査する。物理 Stream Deck と実サイトでの end-to-end 操作の確認には代わらない。

画像は [assets/chrome-web-store](../assets/chrome-web-store/) に保存する。スクリーンショットは無効状態の実拡張設定ページのキャプチャであり、接続成功や物理デバイスの動作を装わない。画像生成 AI や架空の接続状態は使用しない。再生成した画像は目視確認してから提出する。

`chrome:store:check` は manifest、許可する同梱ファイル、権限、CSP、言語原稿と貼り付け用説明の一致、スクリーンショット・プロモーション画像の寸法とハッシュ、Limited Use 開示と README のポリシーリンクを検査する。`npm run chrome:release:check` は公開 URL・問い合わせ先 URL が未設定、または公開前の確認記録が不足すると失敗する。外部 URL の到達性、申告の正しさ、審査適合を保証する検査ではない。

`chrome:pack` は検査後に `media-bridge-<version>.zip` を作成する。ZIP の直下に manifest があり、Windows の実行ファイル、node_modules、秘密トークン、ストア用原稿は含めない。まだ公開されていない提出候補なので、既存の公開済みバージョンがある場合は更新番号も先に確認する。

公開情報の設定後は `npm run chrome:pack -- -Release` でリリース検査を通してから ZIP を作成する。実機確認・ダッシュボード・公開者設定は別途必要。

## 公開前の受け入れチェック

- [ ] ポリシーを HTTPS で公開して、ログインなしで読めることを確認。指定された GitHub Issues の到達性を確認し、listing.*.json の privacyPolicyUrl を埋める。
- [ ] [Privacy practices 原稿](chrome-web-store/privacy-fields.md) と現行ダッシュボードを照合。データ分類、権限理由、remote code、Limited use の認証を確認する。
- [ ] クリーンな Windows 環境でプラグインを導入し、正しい拡張 ID でホストを登録。別拡張への許可がないことを確認する。
- [ ] 送信が初期無効、無効時の画像通信なし、オン／オフ保存、Chrome のサイトアクセス制限、削除と再導入を確認する。
- [ ] 2種類以上の実サイト、複数タブ／iframe、再生・停止・シーク・曲変更で、対象の一致と未対応操作の表示を確認する。
- [ ] DevTools の Application → Back/forward cache でメディアページを検査し、戻る／進む後にも状態更新と操作が復旧することを確認する。キャッシュ不可の原因が拡張以外のサイト実装である場合も記録する。
- [ ] サービスワーカー停止、ブラウザ再起動、ホスト未登録・切断、プラグイン再起動、低速／切断回線、画像エラー、長時間バックグラウンドを確認する。
- [ ] 最小対応版と Chrome Stable、ライト／ダーク、キーボード、スクリーンリーダー、ズーム200%で操作と説明の可読性を確認する。
- [ ] 128pxアイコン、日英スクリーンショット、小型プロモーション画像、任意のマーキー画像を原寸・半分のサイズと掲載プレビューで確認。必要環境と外部配布先、サポートリンク、名称と権利を確認し、公開者アカウントの保護・配布設定・テスト指示を整える。

参照: [Stay secure](https://developer.chrome.com/docs/extensions/develop/security-privacy/stay-secure)、[Privacy fields](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy)、[Permission warnings](https://developer.chrome.com/docs/extensions/develop/concepts/permission-warnings)、[Listing requirements](https://developer.chrome.com/docs/webstore/program-policies/listing-requirements)、[Images](https://developer.chrome.com/docs/webstore/images)、[Great listing](https://developer.chrome.com/docs/webstore/best-listing)、[Playwright extension tests](https://playwright.dev/docs/chrome-extensions)。

2026-10-26 の追加監査・修正・公開条件は [総合監査](guideline-audit.md) を参照。
