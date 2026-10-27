# Elgato Product Guidelines 対応

確認日: 2026-10-23（Asia/Tokyo）。対象は [Product Guidelines](https://docs.elgato.com/guidelines/products/)、関連する [Branding Guidelines](https://docs.elgato.com/guidelines/branding/) と [提出手順](https://docs.elgato.com/maker-console/submitting-products/)。プラグイン本体の確認は [既存の記録](plugin-guidelines.md) を参照してください。

本変更で掲載用の原稿・画像・機械検査を用意しました。**公開準備中**です。下の手動項目は未確認で、審査適合や採用を確約するものではありません。

## 掲載用ファイル

| 用途 | ファイル | 内容 |
|---|---|---|
| 商品情報の原稿 | [listing.en.json](marketplace/listing.en.json) | `Media Controls`、英語説明、画像パス、追加リンク案、AI使用の開示。無料（`pricing.type: free`） |
| 貼り付け用説明 | [description.en.txt](marketplace/description.en.txt) | JSON から生成した、250～1,500文字の英語プレーンテキスト。最初の250文字に機能と対象を記載 |
| Marketplace app icon | [app-icon.png](../assets/marketplace/app-icon.png) | 288 × 288 の静止 PNG。既存の製品マークから生成 |
| サムネイル | [thumbnail.png](../assets/marketplace/thumbnail.png) | 1920 × 960 PNG |
| ギャラリー1 | [gallery-01-now-playing.png](../assets/marketplace/gallery-01-now-playing.png) | 1920 × 960 PNG。再生中／一時停止のキー表示 |
| ギャラリー2 | [gallery-02-controls.png](../assets/marketplace/gallery-02-controls.png) | 1920 × 960 PNG。同梱の再生・音量操作アイコン |
| ギャラリー3 | [gallery-03-customization.png](../assets/marketplace/gallery-03-customization.png) | 1920 × 960 PNG。全情報／アートワークのみ／文字のみ |
| セットアップ | [setup.md](marketplace/setup.md) | Windows・Stream Deck・Chrome の要件、手動の拡張導入、操作と制限を英語で説明 |
| リリースノート原稿 | [release-notes.en.txt](marketplace/release-notes.en.txt) | 初回リリース v1.0.0（STABLE）の機能と制限を英語で記載 |
| データの取り扱い | [privacy.md](marketplace/privacy.md) | ローカル処理、画像取得の外部通信、Chrome の opt-in、設定・トークン・ログ・削除手順を英語で説明 |
| 生成記録 | [provenance.json](../assets/marketplace/provenance.json) | 原稿・描画ソース・画像の SHA-256、架空データの由来、AI使用の開示 |

Marketplace 用の288pxアイコンは、プラグイン設定用の256 / 512pxアイコンとは別のファイルです。ギャラリーのキーは `nowPlayingImage` と `ScrollingText` の実装で生成しています。操作アイコンはプラグインの同梱画像です。拡大した表示例であり、実機撮影や物理デバイスの再現ではありません。文字は英語、曲名 `Daylight` とアーティスト `Sample` は架空、アルバム画像は生成スクリプト内の幾何図形です。画像生成モデルや第三者のジャケット画像は使用していません。

## 要件と対応範囲

| ガイドライン | ローカルで用意・確認すること | 公開前に必要な判断 |
|---|---|---|
| Name | 英語・先頭大文字・30文字以下。manifest と名称を一致させ、作者名や宣伝文句を加えない | `Media Controls` の独自性・他商品や商標との混同。汎用的な名称なので現行の掲載と Maker Console で確認する。既存商品の改名は Elgato への連絡が必要 |
| Description | 250～1,500文字、先頭250文字は装飾なし。機能・必要環境・Chrome の手動設定・操作制限を明記 | 実機確認を踏まえて正確さを確認。掲載時も全文を使用する |
| App Icon | 製品マークが中心の288 × 288静止 PNG。外部リンクや Official 表記を入れない | 製品マークの権利を確認 |
| Thumbnails | 1920 × 960静止 PNG、英語、実装の表示とアイコンを使用 | 可読性と実際の製品との一致を掲載プレビューで確認 |
| Gallery | サムネイルとは別に3点、各1920 × 960静止 PNG。機能とカスタマイズを掲載 | 実機との一致、権利、文字量と可読性を確認 |
| Pricing | 外部の購入処理や課金ゲートは実装されていない | 利用者指定で無料に確定。他所での配布価格との一致を確認する |
| AI Usage | プラグインの開発・レビュー、説明文、掲載素材のコードへのAI支援を英語説明に開示。素材の生成記録にも制作方法を記載 | 製品全体の開発履歴に合わせて開示を補完。完全にAIだけで作成された製品は公開対象外のため、人の創作・設計・検証への関与を確認。画像の文字・表示・機能を人が確認 |
| Content Appropriateness | 無関係な画像や実ユーザーのメディア情報を使用しない。UIは英語／日本語に対応 | 既存商品との差別化、幅広い利用者への適切さ、実機と設定画面のアクセシビリティを確認 |
| Data & Security | 分析・広告収集なし。Chrome送信は初期無効。ローカル認証、データ・外部画像取得・削除方法を説明。公開Issueに個人情報を投稿しない案内も記載済み | 更新した説明の公開内容との一致と、指定された GitHub Issues の到達性を確認 |
| Legal | 第三者の曲・ジャケット・ロゴ・デバイス画像を新規素材に使用しない | 既存アイコン、コードと依存ライブラリも含めた権利・ライセンス、Maker Agreement と関連ポリシーを確認 |

名称の独自性、法的な権利、人の創作への関与、アクセシビリティの実機適合は機械検査で判定していません。設定や動作の変更が必要になった場合は、素材も再生成・再確認してください。

## 再生成と検査

```powershell
npm run marketplace:build
npm run marketplace:check
npm run guidelines:check
npm run check
npm run validate
```

`marketplace:build` はプラグインを起動せず、既存マークとキー描画の実装から素材を再生成します。Chrome 登録・再生操作・音量操作は実行しません。

`marketplace:check` は原稿の文字数、先頭250文字、manifestとの名前一致、AI開示の存在、画像の個数・形式・寸法、原稿と描画ソースの更新漏れ、画像の生成記録を検査します。`npm run check` にも組み込んでいます。リンクはHTTPS形式を確認するだけで、公開到達性や文書内容の正しさは判定しません。

2026-10-23 の検証では、商品検査（説明1,341文字、PNG 5点）、プラグイン画像・レイアウト検査、翻訳生成物・JS構文・TypeScript型チェック、Windowsネイティブとプラグインのビルド、パッケージ資産・画像ランタイム検査、Elgato CLI の `Validation successful` を確認しました。既存JSテスト181件のうち178件はサンドボックス内で成功、localhostへの接続が `EACCES` になった3件は該当ファイルを制限外で再実行して成功しました。追加の実機操作は行っていません。画像5点も目視確認済みです。

## Maker Console に提出する前に

- [x] 利用者指定により無料配布、組織名 Neko7sora（manifest の Author と一致）、問い合わせ先 GitHub Issues を確定（2026-10-26）。
- [ ] 商品名の独自性、Maker Console の実際の組織表示、他所での配布価格との一致を確認する。
- [ ] 製品全体のAI使用と人による制作・検証の事実を確認し、説明と開示文へ反映する。今回のAI支援の記載だけで全履歴を確認済みとは扱わない。
- [ ] 既存アイコン・コード・ネイティブ依存も含めた権利と配布ライセンスを確認する。
- [ ] 実機でキー・ダイヤル・設定画面・失敗時の動作を検証し、掲載内容と照合する。受け入れ項目は README を参照。
- [ ] setup / privacy 文書の公開内容が最新の原稿と一致することを確認し、JSON の `links` がログインなしで到達することを確認する。現在の参照先はリポジトリの `main` ブランチ。リポジトリの公開化だけでは文書の反映・到達性を確認済みとしない。support の到達性も確認する。
- [ ] 更新済みのプライバシー説明と GitHub Issues の問い合わせ手順が公開されていることを確認する。公開Issueに個人情報やトークンを投稿させない。
- [ ] CLI 検証後にパッケージを作成し、Maker Console に商品ファイル、英語説明、288pxアイコン、サムネイル、ギャラリー3点、追加リンク、リリースノートを入力する。
- [ ] 掲載プレビューで文字の読みやすさと機能の正確さを確認して提出する。

この作業はローカルでの公開準備です。Maker Console への登録、提出、公開、価格変更は行っていません。

2026-10-26 の追加監査・修正・公開条件は [総合監査](guideline-audit.md) を参照。
