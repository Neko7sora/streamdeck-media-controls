# ガイドライン総合監査

確認日: 2026-10-26（Asia/Tokyo）。対象は Elgato の [Plugin Guidelines](https://docs.elgato.com/guidelines/stream-deck/plugins/)、[Product Guidelines](https://docs.elgato.com/guidelines/products/)、[Branding Guidelines](https://docs.elgato.com/guidelines/branding/)、[提出手順](https://docs.elgato.com/maker-console/submitting-products/)、Chrome の [Program Policies](https://developer.chrome.com/docs/webstore/program-policies/policies)、[Best practices](https://developer.chrome.com/docs/webstore/best-practices)、[掲載指針](https://developer.chrome.com/docs/webstore/best-listing)、[拡張セキュリティ](https://developer.chrome.com/docs/extensions/develop/migrate/improve-security)。必須条件と推奨事項を区別し、既存の項目別記録も照合した。

**ローカルの修正と検査を実施。公開適合の最終確認は未完了。** 物理デバイス、公開者アカウント、権利や人による制作への関与を、自動テストの結果で代用しない。

この文書の実行結果・依存バージョンは上記確認日の記録。以後の依存更新については `package.json` / `package-lock.json` を参照し、過去の監査結果を現在の全変更の検証済み記録として扱わない。各文書の役割と更新時の照合先は [ドキュメント一覧](README.md) にまとめた。

## 確定した公開情報

利用者の指定により、Marketplace は無料、組織名は `Neko7sora`、一般的な問い合わせ先は [GitHub Issues](https://github.com/Neko7sora/streamdeck-media-controls/issues)。日英の掲載原稿、同梱ポリシー、公開用原稿、検査を統一した。再生情報・設定・キャッシュはPC内で利用者自身が削除する手順を案内する。開発者はそのコピーをサーバーに保存しない。Issue に個人情報やトークンを投稿させない。問い合わせ先の確定と公開到達性の検証は別の項目として扱う。

利用者がコードと履歴を含む公開を明示的に指定したため、リポジトリを **public** に変更し、GitHub API で `isPrivate: false`、Issues 有効を確認した。その後の設定は利用者の指定で保留中。更新した原稿の公開内容との一致やリンクの到達性の検証は未完了で、`publicLinks` は未完了、`privacyPolicyUrl` は未設定として維持する。

## 修正した問題

| 問題 | 修正と確認 |
|---|---|
| Elgato CLI がスキーマ取得失敗後も成功表示・終了コード0を返す | `validate-plugin.mjs` が標準出力・標準エラー、終了状態、明示的成功表示を検査。manifest / layout の取得失敗を拒否する回帰テストを追加 |
| 依存監査で Zod と fast-uri の既知問題を検出 | Zod 4.6.6、fast-uri 3.1.9 へ固定。SDK 3 を維持し、実 SDK の RPC・入れ子の選択肢スキーマで互換性を確認。再監査は検出0件 |
| バンドルされた SDK と Rust 依存の著作権・ライセンス文が配布物にない | インストール済み npm runtime graph と Cargo.lock の依存から `THIRD_PARTY_NOTICES.txt` を生成して同梱。ビルド時の生成とパッケージ検査時の一致確認を追加 |
| AI開示が掲載素材の制作に限定され、既知の開発支援を含まない | plugin development / review を英語開示に追加。過去の全制作履歴と人の関与は公開者確認として残す |
| 無料配布・組織名・連絡先が未確定扱い | 指定された内容を原稿・確認記録へ反映。Issues は一般的な問い合わせ先とし、ローカルデータは利用者自身が削除する説明へ統一 |
| ローカル検査成功だけで提出可能と誤認し得る | バージョン・ソース指紋と項目別の確認者・日付・根拠を必要とする `release:status` を追加。正式 `pack` と Chrome `-Release` の経路に適用 |

## 残る確認と証拠の記録

`release-review.json` の各項目に `reviewedOn`（YYYY-MM-DD）、`reviewer`、`evidence`（環境・手順・結果、または記録への参照）を記入する。未検証の項目を成功として記録しない。

| キー | 記録する根拠 |
|---|---|
| identity | Marketplace の名称の独自性、Maker Console の組織名と manifest の一致 |
| rightsAndHumanContribution | 元のコード・アイコン・ブランドの権利、配布条件、製品全体のAI開示、人による制作・設計・検証への関与 |
| nativeRedistribution | sharp Windows runtime に含まれる libvips とその依存のライセンス本文、対応ソースの提供方法、差し替え・再リンク等の配布条件の確認。npm の Apache LICENSE だけで完了としない。生成通知に含まれる上流 README と versions.json を起点にする |
| deviceAcceptance | README の物理 Stream Deck / Stream Deck + のキー・ダイヤル・表示・アラート・日本語／英語・復旧の受け入れ結果 |
| chromeAcceptance | 最小対応版と現行 Chrome、2種類以上の実サイト、複数タブ／frame、Native Messaging、送信停止、サイト権限、bfcache、キーボード・スクリーンリーダー・200%ズームの確認。ホストをスタブ化したブラウザテストと区別 |
| publicLinks | 公開ポリシー・setup・Issues・プラグイン直接配布先がログインなしで到達すること。日英 `privacyPolicyUrl` は確認後に同じ URL を設定。現在は未設定 |
| listingPreview | 英語の説明、名称・機能・制限・画像の実物との一致と可読性を両ストアのプレビューで確認 |
| publisherSettings | 両ストアの規約・連絡先・無料設定・配布地域・既存版の更新番号、Chrome の2段階認証・Privacy practices・Limited Use・権限理由・テスト指示 |

確認対象の全変更を保存した後、`node scripts/check-release.mjs --fingerprint` の結果を `sourceFingerprint` に記録する。指紋は Git 管理対象と未追跡の非除外ファイル（確認記録自身を除く）を検査し、テキストの改行だけを正規化する。変更後は該当する確認をやり直し、指紋を更新する。記録の存在を検査する仕組みであり、根拠の真実性やストア審査を自動認証するものではない。

```powershell
npm run check
npm run test:native
npm run test:chrome:e2e
npm run test:smoke
npm run validate
npm run release:status
```

`npm run pack` は総合検査と公開前記録の検査後に正式パッケージを作る。ローカルで確認する候補は `npm run pack:review`、Chrome は `npm run chrome:pack`。Chrome の提出用は `npm run chrome:pack -- -Release`。候補パッケージの作成は公開可の判定ではない。

正式なプラグイン作成では Marketplace の確認記録を要求し、`release:check` は両ストアの確認記録を要求する。依存の最新監査には `dependencies:check`（`npm audit`、ネットワーク接続が必要）を使用する。ローカルの `check` は監査APIへの接続を要求しない。

Zod の override は `@elgato/utils` が既に使っている `zod/v4-mini` を修正版へ置き換えるもの。元の宣言は `^3.25.24` だが、このパッケージには初期版の v4 も同梱されるため、宣言だけでは修正版へ更新されない。[Zod の告知](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5) と [fast-uri の告知](https://github.com/advisories/GHSA-w74x-v6f9-j3xg) を確認した。SDK または utils の将来更新時は override の必要性と実 SDK 互換性テストを再評価する。npm が提案する SDK 1.x への強制ダウングレードは適用していない。

## 今回の実行結果

| 検査 | 結果 |
|---|---|
| `npm run check` | 成功。JS 225件（既存テストと追加した検証判定・公開記録・実SDK互換性テスト）、型、翻訳185項目、構文、Windows releaseビルド、パッケージ、同梱画像runtime、両ストア資産 |
| `npm run test:native` | 成功。media-info 6件、media-keys 2件 |
| `npm run test:chrome:e2e -- --screenshots`（当時の実行コマンド） | 成功。日英、初期無効、保存と再読み込み、ホスト不在、ポリシーとIssues案内、キーボード、アクセシビリティツリーのスイッチ状態、320/420/1280px、明暗。Native Messaging はスタブ。この記録は画像の再生成を保証しない。現行の撮影コマンドは [再生成手順](chrome-web-store.md#再生成と検査) を参照 |
| `npm run test:smoke` | 成功。GSMTC 0セッション・Core Audio 2セッションの読み取り、存在しない対象の拒否、正常終了。実際の再生や音量を変更していない |
| `npm run validate` | 公式スキーマを取得した状態で新しい判定処理が成功。取得できない状態を成功として扱わない回帰テストも成功 |
| npm依存監査 | 更新前はZodの高深刻度問題とその依存先、fast-uriの中深刻度問題の計4パッケージ。修正版2パッケージへ更新後は検出0件。SDK 3.0.2 を維持 |
| ローカル候補 | `.streamDeckPlugin` 171ファイル・展開時約22.1 MiB。ZIP内の通知文とmanifestを確認。Chromeの候補ZIPはmanifest直下・同梱ポリシー更新を確認 |
| 未完了時の公開検査 | `release:status` は確認記録不足と公開ポリシーURL未設定で失敗。Chrome `-Release` も停止し、既存の候補ZIPが変わらないことをSHA-256で確認 |

最初のlocalhost検査はサンドボックスの `EACCES`、ブラウザ起動も実行環境の制限を受けた。許可された実行環境で再検査して成功した。Webガイダンス用の外部最新版npm実行は自動承認レビューが拒否したため、実行せず公式資料を直接参照した。

ストアへの公開・提出・インストール・物理デバイス操作は実施していない。総合確認記録は未完了のまま維持している。
