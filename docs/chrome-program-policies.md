# Chrome Web Store Program Policies 対応記録

確認日: 2026-10-25（Asia/Tokyo）。対象: [Program Policies](https://developer.chrome.com/docs/webstore/program-policies/policies)。拡張だけでなく、連携プラグイン、公開ページ、掲載説明、画像、公開者の運用も対象として確認する。Developer Agreement の確認も別途必要。

**公開準備中。ローカルで確認できる実装・説明・検査を整備した段階であり、全要件への適合や審査通過を認証するものではない。** 公開ポリシー URL は未設定。問い合わせ先は利用者指定により GitHub Issues に確定（2026-10-26）。実サイト・物理 Stream Deck・公開者アカウント・ダッシュボードの確認も残っている。

## 要件との照合

| ポリシー | 現行の対応・根拠 | 提出前の確認 |
|---|---|---|
| Privacy Policy | [ポリシー原稿](marketplace/privacy.md) と拡張の `privacy.html` に情報、目的、転送先、画像通信、保存、削除を説明。README から原稿へ直接リンク | 原稿をログイン不要の HTTPS ページとして公開し、Privacy practices の URL と一致させる |
| Limited Use | 日英の同梱説明と公開原稿に準拠を明記。用途はローカルのメディア表示と対応操作。販売・広告・追跡・信用判断・融資に使わない | 公開ホームページから1クリック以内で表明へ到達できること、申告・将来の運用との一致 |
| Use of Permissions | `storage` は送信設定とローカル連携 ID、`nativeMessaging` は同一 PC のホスト。HTTP/HTTPS の静的 content script は任意サイトのメディア、HTTPS ホスト権限は画像取得に使用。履歴・Cookie・音声収録権限なし | 任意のサイトと埋込フレームを継続観測する現行機能に広いアクセスが必要な理由を申告。サイト制限時も確認。権限は機能追加のたびに再評価 |
| Disclosure Requirements | 設定の送信トグルの前に送信項目・ローカル転送先・画像配信元への要求を表示。初期無効、保存で有効化。掲載原稿にも説明 | 初回導入から有効化までの説明、インストール警告と実動作の一致。用途変更時は新たな開示と同意 |
| Handling Requirements | 画像は HTTPS、認証情報・リファラーなし、リダイレクト拒否、サイズ制限。ローカルは Native Messaging とトークン認証付き `127.0.0.1`。ホストは登録した拡張 ID のみ許可 | 登録・切断・停止・トークンの非露出を実機確認。ローカル通信の扱いは下記 FAQ を参照 |
| Single purpose / Quality Guidelines | ブラウザのメディア情報と対応操作を同一 PC の Media Controls へ接続する単一目的。広告や別機能なし | 単一目的欄、説明、UI、権限理由を照合 |
| Minimum Functionality | 拡張自身が Media Session / HTML メディアの観測、画像の取得・検証、ローカル転送、対象ドキュメントへの操作を実装 | 外部アプリへのリンク・起動だけの製品ではないことを [審査用手順](chrome-web-store/reviewer-instructions.md) で再現。必要な配布物と実機を用意 |
| Listing Requirements / Misleading Behavior | 日英原稿に必要環境、連携登録、送信、画像通信、対応操作と制限を記載。画像は実拡張の初期無効画面。通常登録は同梱 runtime を使う説明に統一 | 原稿の正確性、実際の警告、画像、配布先、価格、サポートを確認。未対応の次/前・タブ音量・macOS を宣伝しない |
| Impersonation & Intellectual Property | プロジェクト独自のコードとアイコンを同梱 | Stream Deck / Chrome の名称、アイコン、掲載素材、権利、公式製品との混同がないことを公開者が確認 |
| Code Readability / Manifest V3 | 同梱 JS のみ。生成翻訳は通常の minify。難読化、外部 JS / Wasm、`eval`、文字列タイマーなし。CSP と AST による [検査](chrome-extension-security.md) | 提出 ZIP 全体を審査可能な状態に保ち、外部の画像データをコードとして解釈しない |
| API Use | 静的 content script、storage、Native Messaging と Media Session / HTMLMediaElement を用途どおり利用 | 追加機能でも既存 Chrome API とその目的を確認 |
| Mature / Malicious / Hate / Regulated Content | このパッケージは該当コンテンツ、採掘、ダウンロード、DRM 解除、アクセス制限回避を提供しない | 掲載素材・リンクを含めて公開時に確認。ユーザー自身のメディア内容をストア画像へ流用しない |
| Ads / Affiliate / Payments | 現行パッケージに広告、アフィリエイト挿入、決済機能なし | 追加する場合は説明、同意、価格、返金等の要件を再確認。外部ソフトやハードウェアの必要性も明記 |
| Deceptive Installation / Spam and Abuse | ユーザーが設定画面で拡張 ID を指定してホストを登録。広告、レビュー誘導、第三者への送信なし | 配布・導入フロー、評価・インストール数の操作や重複出品がないことを公開者が確認 |
| 2-Step Verification / Enforcement | アカウント設定と審査履歴はリポジトリから確認できない | 2段階認証、連絡先、Google からのメール受信、Developer Agreement、配布地域を確認。審査指摘には改修で対応し、回避・重複出品しない |

Chrome Apps 専用の「ローカル実行ファイルを必要としない」等の追加要件は、この Manifest V3 **拡張機能**の分類には適用しない。一方、外部プラグインが必須であることの正確な説明と、実際に審査できる機能・導入手順は必要。

同一 PC の拡張とネイティブプログラム間通信について、[User Data FAQ の質問16](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq) は暗号化要件の対象外と説明している。これは外部 HTTP 送信を許可する根拠にはしない。現行の画像通信は HTTPS のみ、ホストの待受は loopback 固定とする。

送信無効時も MAIN world のページスクリプトはメディア API を観測し得る。この点は設定・掲載原稿・ポリシーで説明している。「無効ならページを一切読み取らない」「ユーザーデータを扱わない」とは申告しない。ローカルだけの処理も開示対象であることは [User Data FAQ](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq) に明記されている。

## 公開までに残ること

1. [ポリシー原稿](marketplace/privacy.md) を公開し、日英 `listing.*.json` の `privacyPolicyUrl` を同じ HTTPS URL で埋める。README の直接リンクが公開先でも到達可能であることを確認する。
2. 問い合わせ先は、利用者指定で GitHub Issues に統一し、日英原稿の `supportUrl` とポリシーへ反映した。公開Issueであることと、個人情報・トークン・未確認のログを投稿しないこと、PC内のデータは利用者自身が削除する手順を案内する。従来の非公開窓口を必須とする独自条件は撤回した。
3. [Privacy practices 原稿](chrome-web-store/privacy-fields.md) を実際のダッシュボードへ反映する。ローカル転送だから「データ利用なし」とせず、扱うページ URL・コンテンツ・識別子・画像要求を分類し、Limited Use を認証する。
4. [審査用手順](chrome-web-store/reviewer-instructions.md) の公開者向け準備を完了し、動作するプラグインの直接配布先と必要環境をテスト指示欄で案内する。実機の [受け入れチェック](chrome-web-store.md#公開前の受け入れチェック) を実施し、未確認を確認済みにしない。
5. 公開者の2段階認証、連絡先、権利、掲載画像、価格、配布設定を確認する。ストア側に既存版がある場合は manifest の更新番号も確認する。
6. 以下のリリース検査と ZIP 作成を実行し、ZIP の内容を最終確認してから提出する。

```powershell
npm run chrome:release:check
npm run chrome:pack -- -Release
```

`chrome:store:check` はローカル成果物と Limited Use 開示・README からのリンク・日英の公開情報一致を確認する。`chrome:release:check` はさらに未設定の公開 URL・問い合わせ先 URL と、公開前の確認記録不足を拒否する。**入力された URL の到達性、窓口の有効性、実機動作、権利、アカウント、Google の判断は検証しない。** `chrome:pack` の既定は引き続きローカルの提出候補 ZIP 作成である。

ポリシーは更新され得るため、提出時と機能・通信先・データ用途の変更時に公式原文とこの記録を再照合する。現行の導入・画像・テストの手順は [Chrome Web Store 対応記録](chrome-web-store.md) を参照。

## 今回のローカル確認

2026-10-25: 既存の199テストのうち196件がサンドボックス内で成功。loopback 接続が `EACCES` となった3件は、対象の2ファイルを権限調整後に再実行し、同時に再実行された1件を含め4件すべて成功。型検査、翻訳生成物の一致、Chrome JS 構文、同梱コードと CSP、ストア資産の検査も成功した。

日英のブラウザテストで初期無効・保存・再読込・ホスト不在・ポリシーと Limited Use 表示・狭幅・明暗を確認し、1280×800 の掲載画像を再生成して目視確認した。Native Messaging は実ホストに接続しないスタブで検査したため、実機の連携成功は未確認。提出候補 ZIP を再生成し、直下の manifest と更新済みポリシーを確認した。

2026-10-25 時点のリリース検査は、当時未設定だった公開 URL・非公開窓口により期待どおり失敗し、`-Release` の ZIP 作成も同じ理由で停止して既存 ZIP を変更しないことを確認した。非公開窓口の独自条件は翌26日に撤回済み。現行の未完了項目は公開ポリシー URL と [公開前の確認記録](guideline-audit.md#残る確認と証拠の記録) である。

2026-10-26 の追加監査・修正・公開条件は [総合監査](guideline-audit.md) を参照。
