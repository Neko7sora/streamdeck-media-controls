# プラグインのソース構成

Stream Deck プラグインの入口は [plugin.ts](../src/plugin.ts) です。言語の設定、アクションの生成・登録、状態購読、描画タイマー、外部接続の起動・終了を担当します。

| モジュール | 責務 |
|---|---|
| [action-settings.ts](../src/action-settings.ts) | 共通設定型、アクション型、UUID |
| [configured-action.ts](../src/configured-action.ts) | 表示・非表示のライフサイクル、設定保持、描画間隔、差分送信、表示中セッションの保持 |
| [control-actions.ts](../src/control-actions.ts) | 再生操作ボタンと音量ダイヤル |
| [now-playing-actions.ts](../src/now-playing-actions.ts) | Now Playing のキー・ダイヤル表示、シーク、セッション切替 |
| [media-commands.ts](../src/media-commands.ts) | 操作失敗の通知、音量制御、Windows / Chrome へのセッション指定操作 |
| [property-inspector.ts](../src/property-inspector.ts) | 設定画面とのハンドシェイク、差分通知、Chrome ホスト登録要求 |
| [icue-runtime.ts](../src/icue-runtime.ts)、[icue-server.ts](../src/icue-server.ts) | 内蔵／独立iCUEブリッジ共通のトークン、認証付きHTTPS、表示対象の照合。ホストのメディア状態とWindows／Chrome通信を共有し、ポーリングやヘルパーは追加起動しない |
| [icue-bridge.ts](../src/icue-bridge.ts) | Stream Deckアプリを使わない独立ブリッジの起動・終了。内蔵版の起動・終了はplugin.tsが担当 |
| [chrome-integration.ts](../src/chrome-integration.ts) | Chrome 連携のオン・オフと拡張 ID の保存、明示的な再登録、受信サーバーの起動・停止、設定画面への状態通知 |
| [plugin-settings.ts](../src/plugin-settings.ts) | Chrome／iCUE のグローバル設定の読み込みと保存の直列化 |
| [icue-integration.ts](../src/icue-integration.ts) | 内蔵iCUEブリッジのオン・オフをグローバル設定に保存し、起動・停止を順番に処理。設定画面へ稼働状態を通知 |

アクションは入口で明示的に生成します。基底クラスのコンストラクターによるグローバルな登録は行いません。設定画面のイベント購読も入口から開始します。

非同期描画では送信前に表示インスタンスと設定が有効か確認し、操作は最後に表示したセッションへ送ります。送信中に設定が変わっても、同じ表示インスタンスへの送信が成功した場合は、その画面の操作対象を保持します。非表示や同じIDでの再表示を挟んだ古い送信は操作対象を復活させません。分割後もこの境界を維持してください。操作・描画・設定画面間の回帰は [plugin-routing.test.mjs](../tests/plugin-routing.test.mjs) で確認できます。

翻訳検査は src 配下の TypeScript を再帰的に探索します。表示実装を変更した場合は npm run marketplace:build で掲載画像とソース指紋を再生成してください。
