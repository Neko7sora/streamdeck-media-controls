# Chrome 拡張のセキュリティ要件への対応

確認日: 2026-10-25（Asia/Tokyo）。対象は Chrome 公式の [Improve extension security](https://developer.chrome.com/docs/extensions/develop/migrate/improve-security)。

現行の `chrome-extension/` は記事の主要要件を満たす構成になっている。実行時の権限や CSP を緩和せず、提出対象ファイルへの静的検査と、その検査が禁止例を拒否する回帰テストを追加した。

| 記事の要件 | この拡張の対応 | 自動確認 |
|---|---|---|
| 任意文字列をコードとして実行しない | `eval`、`Function`、文字列タイマーを使わない。JS はすべて同梱 | JS の構文木から禁止 API の参照、文字列リテラルのタイマーを検出 |
| リモートホストのコードを除去 | HTML、service worker、MAIN / ISOLATED world の content script、翻訳 JS、CSS を同梱。CDN、外部 JS/Wasm、動的 script 要素を使わない | manifest の参照、全同梱 JS の import / importScripts / Worker、HTML の script / link、CSS の import / url を検査。参照先の同梱・存在も確認 |
| Manifest V3 形式の CSP | `content_security_policy.extension_pages` にポリシーを定義 | MV3、辞書形式、必要なディレクティブと値を確認 |
| 未対応・危険な CSP を除去 | `default-src 'self'`、`script-src 'self'`、`object-src 'none'`。`worker-src` 未指定時も制限付きの `script-src` にフォールバック。インライン JS、eval、外部スクリプトを許可しない | CSP の重複、`script-src-elem` / `script-src-attr` / `worker-src` / `child-src` による緩和、sandbox 追加を拒否 |

挿入は manifest の静的 content script 宣言で行うため、`tabs.executeScript()` からの移行は不要。`scripting` 権限も追加しない。実行時に拡張内 URL を組み立てる必要がある既存箇所は `chrome.runtime.getURL("options.html")` を使っている。HTML と `importScripts("localization.js")` の相対参照は同梱ファイルへ解決される。

`connect-src https:` は artwork / favicon の画像バイト取得用であり、`script-src` の外部許可ではない。取得データは MIME・容量・送信設定などを検証して画像として処理し、コードとして評価しない。画像データの HTTPS 取得や任意のサポートページへのリンクは、外部コード読み込みとは区別する。画像取得の挙動は既存の worker テストで検証している。

MAIN world のスクリプトには挿入先ページの CSP が適用されるため、拡張ページの CSP だけに依存しない。静的検査は MAIN / ISOLATED の両方と生成済み `localization.js` を含む、提出用 JS 全体を確認する。Chrome 公式の [Content scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts) と [Manifest CSP](https://developer.chrome.com/docs/extensions/reference/manifest/content-security-policy) も参照。

## 検査

```powershell
npm run chrome:security:check
node --test tests/chrome-security.test.mjs
npm run chrome:store:check
npm run test:unit
npm run test:chrome:e2e
```

`chrome:store:check` はセキュリティ検査を直接呼び出すため、既存の `npm run check` と `npm run chrome:pack` にも適用される。禁止するコードや CSP を混入させたテスト例に加え、同梱 import、関数タイマー、HTTPS 画像取得、コメントや通常の文字列を誤検出しない例を確認する。

この検査は現在の小規模なパッケージ構成に対する退行防止であり、任意の難読化や間接的なコード生成を証明・検出するものではない。HTML / CSS は現在の単純な記述を対象にしたパターン検査で、汎用のパーサーではない。新しい依存ライブラリ、読み込み方式、Wasm、sandbox、プログラムによる挿入を追加するときは、出力ファイルと実行経路を別途レビューする。ストア審査や実機の受け入れ確認については [公開前チェック](chrome-web-store.md) を参照。
