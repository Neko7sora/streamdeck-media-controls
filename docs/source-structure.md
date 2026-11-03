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
| [icue-bridge.ts](../src/icue-bridge.ts)、[icue-server.ts](../src/icue-server.ts) | Stream Deckから独立したiCUEブリッジの起動、認証付きHTTPS、表示対象の照合。既存のメディア状態とWindows／Chrome通信を再利用 |

アクションは入口で明示的に生成します。基底クラスのコンストラクターによるグローバルな登録は行いません。設定画面のイベント購読も入口から開始します。

非同期描画では表示インスタンスと設定が有効か確認し、操作は最後に表示したセッションへ送ります。分割後もこの境界を維持してください。操作・描画・設定画面間の回帰は [plugin-routing.test.mjs](../tests/plugin-routing.test.mjs) で確認できます。

翻訳検査は src 配下の TypeScript を再帰的に探索します。表示実装を変更した場合は npm run marketplace:build で掲載画像とソース指紋を再生成してください。
