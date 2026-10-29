# Chrome Web Store Privacy practices 管理資料

原稿確認日: 2026-10-25。拡張は [Chrome Web Store](https://chromewebstore.google.com/detail/stream-deck-media-metadat/iagfcpchjohmpnnlcgppdcadehinhdpa) で公開中。この文書はデータ用途・権限理由の管理資料。更新時は実装とダッシュボードの現行項目を照合し、申告内容を揃える。

## Single purpose description

Connect media metadata, artwork and supported playback commands between browser media pages and the user's local Stream Deck Media Controls plugin on Windows.

## Permission justification

| 権限 | 英語入力原稿 |
|---|---|
| storage | Store the user's explicit sending preference and one random local bridge identifier in chrome.storage.local. Content scripts cannot read this storage. No Chrome sync storage or saved media history is used. |
| nativeMessaging | Connect to the user-installed dev.n7s.media_controls native host to pass media state and supported playback commands to the local Stream Deck plugin. The host accepts only the extension ID explicitly registered by the user. The extension cannot work without the Windows companion plugin and native setup. |
| HTTP / HTTPS host access and content-script matches | Observe Media Session and accessible HTML media elements on the sites the user visits, including embedded media frames. Media websites are not limited to a fixed provider list. HTTPS host access also allows fetching artwork and favicon images from site-selected public image hosts and CDNs. The user can restrict site access in Chrome. No cookies, history API, audio capture or webRequest permissions are requested. Sending and image fetching are off until the user enables sending and saves. |

`activeTab` は一時的なアクセスで、複数タブ・フレームの継続した状態更新と操作には足りない。ホストアクセスを任意化する設計は今後の改善候補。現在はサイト全般で動く機能のための宣言であり、権限警告を隠さない。既定の HTTP メディアページ対応は既存仕様。画像の外部取得は HTTPS のみに制限する。拡張から loopback へ直接 fetch せず Native Messaging を使う。

明示的な `host_permissions` は `https://*/*` のみに縮小している。HTTP は content script の `matches` によるページ観測用で、拡張から外部 HTTP 画像を取得するための権限は要求しない。

## Remote code

No, I am not using remote code. All executable JavaScript is packaged with the extension. Remote artwork is treated as bounded image data, never as executable code.

## User data / Limited use

更新時は以下を実装と照合し、現行の分類・ヘルプに従って申告内容を確認する。PC内だけで処理する情報も照合対象に含める。

| データ | 実装の用途と開示内容 |
|---|---|
| Web history / Website content に関係する情報 | メディア対象のページ名、認証情報・クエリ・フラグメントを除いたページ URL、曲名・アーティスト・アルバム・画像・再生状態。ユーザーが有効にした場合に限りローカルへ渡す。メディアなしの通知からはページ名・URL・任意フィールドを除く。永続的な閲覧・再生履歴は作らない。 |
| 識別子・設定 | ランダムなローカル連携 ID と送信設定を storage.local に保存。タブ・フレーム・ドキュメント ID は操作対象の識別用。追跡・広告・販売に使用しない。 |
| 外部画像要求 | 画像配信元に IP アドレスと画像 URL が伝わる。ページ URL と異なり、画像 URL のサイト指定クエリは削除しない。認証情報・Cookie・リファラーを送らず、転送先を追わない。 |
| サポート | 公開 Issue はユーザー自身が投稿した内容を GitHub が扱う。非公開情報を投稿しないよう案内する。問い合わせ先は GitHub Issues。再生情報と設定はPC内で処理・保存され、利用者自身がローカルの削除手順を実施する。 |

データを販売せず、単一目的以外や信用判断・融資に使用しない。認証情報・位置情報・支払い情報・健康情報を要求しない。サイトが曲名等に私的な情報を含める可能性があるため、データを一般に「非機密」と断定しない。最終的なチェックボックスの分類と適合の認証は公開者が確認する。

同梱ポリシーと公開ポリシーには「Chrome Web Store User Data Policy の Limited Use 要件に準拠する」と明記している。README から直接リンクする。更新時もホームページから1クリック以内にこの表明へ到達できることと、ダッシュボードの認証内容を確認する。

## Privacy policy URL

同梱の [privacy.html](../../chrome-extension/privacy.html) はオフラインで閲覧できる説明。[プラグインを含むプライバシーポリシー](../marketplace/privacy.md) の公開内容とダッシュボードの URL を照合し、ログイン不要で読める HTTPS URL を listing.*.json の privacyPolicyUrl に反映する。ローカル原稿ではこの欄が未設定のため、更新時に補完する。supportUrl は GitHub Issues へ統一済み。公開ポリシーと同梱説明の内容も揃える。

参考: [Privacy fields](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy)、[User data FAQ](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq)、[Permissions](https://developer.chrome.com/docs/extensions/develop/concepts/permission-warnings)。

2026-10-26 の追加監査・修正記録と更新時の確認手順は [総合監査](../guideline-audit.md) を参照。
