# プラグインのソース構成

Stream Deck プラグインの入口は [plugin.ts](../src/plugin.ts) です。言語の設定、アクションの生成・登録、状態購読、描画タイマー、外部接続の起動・終了を担当します。

## 責務ごとの配置

| ディレクトリ | 編集する内容 |
|---|---|
| `src/streamdeck/` | SDKアクション、設定画面、グローバル設定、連携の有効化 |
| `src/media/` | メディア型、選択、検証、状態購読、シーク計算 |
| `src/rendering/` | 画像、フォント、スクロール表示 |
| `src/chrome/` | Chrome通信、識別、ホスト登録、ディープリンク |
| `src/native/` | OSヘルパーとの通信、差分復元、メディアキー |
| `src/icue/` | SDKに依存しないiCUEサーバーと共通ブリッジ |

ルートには2つの起動入口と、共通の翻訳・保存先解決を置きます。Stream Deck固有の設定保存や通知は `streamdeck/` に置き、独立iCUEブリッジがSDKを必要としない境界を維持します。`media-state.ts` はネイティブ受信も開始する状態管理層です。純粋な計算を変更するときは `media-model.ts`、`media-validation.ts`、`media-seek.ts` から確認してください。

内部パスは変更済みで、旧パスの互換モジュールは設けていません。テストの `load()` は `load("media/media-model")` のように `src/` からの相対パスを指定します。

## 主な編集先

| モジュール | 責務 |
|---|---|
| [action-settings.ts](../src/streamdeck/action-settings.ts) | 共通設定型、アクション型、UUID |
| [configured-action.ts](../src/streamdeck/configured-action.ts) | 表示・非表示のライフサイクル、設定保持、描画間隔、差分送信、表示中セッションの保持 |
| [control-actions.ts](../src/streamdeck/control-actions.ts) | 再生操作ボタンと音量ダイヤル |
| [now-playing-actions.ts](../src/streamdeck/now-playing-actions.ts) | Now Playing のキー・ダイヤル表示、シーク、セッション切替 |
| [media-commands.ts](../src/streamdeck/media-commands.ts) | 操作失敗の通知、音量制御、Windows / Chrome へのセッション指定操作 |
| [property-inspector.ts](../src/streamdeck/property-inspector.ts) | 設定画面とのハンドシェイク、差分通知、Chrome ホスト登録要求 |
| [icue-runtime.ts](../src/icue/icue-runtime.ts)、[icue-server.ts](../src/icue/icue-server.ts) | 内蔵／独立iCUEブリッジ共通のトークン、認証付きHTTPS、表示対象の照合。ホストのメディア状態とWindows／Chrome通信を共有し、ポーリングやヘルパーは追加起動しない |
| [icue-bridge.ts](../src/icue-bridge.ts) | Stream Deckアプリを使わない独立ブリッジの起動・終了。内蔵版の起動・終了はplugin.tsが担当 |
| [chrome-integration.ts](../src/streamdeck/chrome-integration.ts) | Chrome 連携のオン・オフと拡張 ID の保存、明示的な再登録、受信サーバーの起動・停止、設定画面への状態通知 |
| [plugin-settings.ts](../src/streamdeck/plugin-settings.ts) | Chrome／iCUE のグローバル設定の読み込みと保存の直列化 |
| [icue-integration.ts](../src/streamdeck/icue-integration.ts) | 内蔵iCUEブリッジのオン・オフをグローバル設定に保存し、起動・停止を順番に処理。設定画面へ稼働状態を通知 |

アクションは入口で明示的に生成します。基底クラスのコンストラクターによるグローバルな登録は行いません。設定画面のイベント購読も入口から開始します。

非同期描画では送信前に表示インスタンスと設定が有効か確認し、操作は最後に表示したセッションへ送ります。送信中に設定が変わっても、同じ表示インスタンスへの送信が成功した場合は、その画面の操作対象を保持します。非表示や同じIDでの再表示を挟んだ古い送信は操作対象を復活させません。分割後もこの境界を維持してください。操作・描画・設定画面間の回帰は [plugin-routing.test.mjs](../tests/plugin-routing.test.mjs) で確認できます。

翻訳検査は src 配下の TypeScript を再帰的に探索します。表示実装を変更した場合は npm run marketplace:build で掲載画像とソース指紋を再生成してください。

## バンドルと資産パス

配布時は `src/plugin.ts` と `src/icue-bridge.ts` をそれぞれ単一ファイルへバンドルします。`import.meta.url` を使う画像・ヘルパーの参照は出力先の `bin/` が基準です。ソースの階層に合わせて変更しないでください。ビルド入口、テストのモック、掲載画像のソース一覧も、ファイル移動時の確認対象です。
