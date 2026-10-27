# ドキュメント一覧と更新方針

導入・操作・対応環境は [プロジェクト README](../README.md)、公開前の残作業は [ガイドライン総合監査](guideline-audit.md)、項目別の確認状況は [release-review.json](release-review.json) を参照してください。リポジトリの公開と、ストアへの提出・製品の公開は別の状態です。

## 用途別の参照先

| 用途 | 文書 |
|---|---|
| 現行の機能・導入・ビルド・復旧・実機確認 | [README](../README.md) |
| 初回公開用の機能・制限 | [リリース履歴](version-history.md) |
| 通信方式・復旧・開発中の測定結果 | [通信設計と最適化の記録](../COMMUNICATION.md) |
| 翻訳の編集・生成 | [翻訳ガイド](../locales/README.md) |
| 両ストアの確認状況・公開条件 | [ガイドライン総合監査](guideline-audit.md) |
| Elgato プラグインの実装・画像・レイアウト | [Plugin Guidelines 対応](plugin-guidelines.md) |
| Marketplace の掲載原稿・素材・提出準備 | [Product Guidelines 対応](product-guidelines.md) |
| 利用者向けの英語セットアップ | [Media Controls setup](marketplace/setup.md) |
| プラグインと Chrome 拡張のデータ・停止・削除 | [データとプライバシー](marketplace/privacy.md) |
| Chrome の検査・画像再生成・ZIP 作成・受け入れ確認 | [Chrome Web Store 対応](chrome-web-store.md) |
| Chrome の必須ポリシーとの照合 | [Program Policies 対応](chrome-program-policies.md) |
| Chrome の同梱コード・CSP の検査 | [拡張のセキュリティ要件](chrome-extension-security.md) |
| Chrome の掲載フィールドと素材 | [掲載ページの準備](chrome-web-store/best-listing.md) |
| Chrome のデータ分類・権限理由の入力原稿 | [Privacy practices](chrome-web-store/privacy-fields.md) |
| Chrome の審査担当者向け手順の原稿 | [Reviewer instructions](chrome-web-store/reviewer-instructions.md) |
| 初期実装に対する過去の監査結果 | [2026-10-16 の開発記録](../AUDIT.md) |

## 現行仕様と履歴の読み方

各監査文書の確認日、検証件数、測定値、当時の依存バージョンは、その時点の記録です。後日のテスト成功や依存更新があっても、過去の結果を書き換えません。特に `AUDIT.md` のトークン手入力・再生位置・未実装の説明は当時の仕様です。現行手順は README を参照してください。

未確認の実機操作、公開リンク、権利、公開者設定は未完了として保持します。確認済みの根拠とソース指紋の記録方法は [総合監査](guideline-audit.md#残る確認と証拠の記録) にまとめています。

## 変更時に照合する編集元

| 変更内容 | 編集元・確認先 |
|---|---|
| バージョン・必要環境・コマンド | [package.json](../package.json)、[プラグイン manifest](../dev.n7s.media-controls.sdPlugin/manifest.json)、[Chrome manifest](../chrome-extension/manifest.json)。実装・ビルド要件も確認し、README・setup・リリース履歴・両ストアの掲載原稿を揃える |
| 依存バージョン | [package-lock.json](../package-lock.json) と各 `Cargo.lock`。過去の監査時点の番号と区別する |
| 翻訳 | [locales/*.json の編集手順](../locales/README.md)。生成済み JS と `_locales` は直接編集しない |
| Marketplace の説明・素材 | [listing.en.json](marketplace/listing.en.json) と [生成スクリプト](../scripts/build-marketplace.mjs)。`npm run marketplace:build` 後に `npm run marketplace:check` |
| Chrome の説明・素材 | [listing.en.json](chrome-web-store/listing.en.json)・[listing.ja.json](chrome-web-store/listing.ja.json)。`npm run chrome:listing:build`。スクリーンショットの更新は [再生成手順](chrome-web-store.md#再生成と検査) に従う |
| 通信・権限・データ用途 | 実装と両 manifest を確認し、README・COMMUNICATION・ポリシー原稿・同梱説明の翻訳元・掲載原稿・Privacy practices を照合する |
| 公開前の確認状況 | [release-review.json](release-review.json) と [検査スクリプト](../scripts/check-release.mjs)。変更後のソース指紋と確認根拠を揃える |

`description.*.txt`、翻訳 JS、画像の生成記録は編集元から再生成します。Markdown の相対リンク・見出しアンカー・記載した npm コマンドも変更後に確認してください。
