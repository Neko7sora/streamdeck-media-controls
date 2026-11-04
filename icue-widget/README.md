# Edge Media Deck — XENEON EDGE iCUE ウィジェット

Stream Deck Media Controls の曲情報・アート・アプリアイコン表示、再生操作、シーク、プレーヤー選択、マスター／アプリ別音量を、XENEON EDGE のタッチ画面へ移植したウィジェットです。**Windows 11 x64、iCUE 5.52 以降（Widget API 1.9.0）**を使用します。ブリッジはStream Deckプラグイン内で自動起動できます。Stream Deckを使わない場合は、Node.js 24以降で独立ブリッジを起動します。

既存のWindows Rustヘルパーとメディア選択・Chrome通信処理を使います。Stream Deckプラグイン内では同じメディア状態とChrome接続を共有し、別のブリッジプロセスは起動しません。Chrome拡張は任意です。個人利用向けの実装で、CORSAIR公式製品ではありません。iCUE / XENEON EDGE実機でのインポートと操作は未検証です。

## 対応機能

| 機能 | ブリッジモード（初期値） | iCUE標準モード |
|---|---|---|
| 曲名・アーティスト・アルバム・アート | Windows / 任意のChrome情報 | Media Data Provider 1.1 |
| アプリ／サイトアイコン | 取得できる場合に表示 | 未対応 |
| 前へ・再生／一時停止・次へ | 対象の対応操作だけ有効 | プロバイダーが選ぶアクティブプレーヤー |
| 停止・±10秒・シークバー | 対応する対象だけ有効、実際のシーク可能範囲に制限 | 未対応 |
| 再生位置と長さ | 取得値を基準に表示を補間、不明値は `--:--` | 未対応 |
| プレーヤー選択 | 自動または特定セッション、切断した対象を維持 | 未対応 |
| 音量・ミュート | マスターまたは特定Audio Session | 未対応 |
| 長い曲名 | スクロールのオン・オフ切替 | 同左 |

Stream Deck + のダイヤル／タップ操作は、画面のシーク・音量スライダーとボタンに置き換えています。物理キー／ダイヤルのイベント連携は使用しません。元のプラグインと同じく、アプリ／サイトが公開しない情報・操作は利用できません。Chrome の前／次など、元の拡張が対応しない操作も追加していません。

XENEON EDGE の全8枠に対応します。ポンプ／キーボードLCDは対象外です。

| サイズ | 横 | 縦 |
|---|---|---|
| S | 840×344 | 696×416 |
| M | 840×696 | 696×840 |
| L | 1688×696 | 696×1688 |
| XL | 2536×696 | 696×2536 |

## ビルドと導入

リポジトリのルートで実行します。公式 `icuewidget-cli` 0.5.1 は開発依存としてロックされています。

```powershell
npm ci
npm run icue:check
npm run icue:pack
npm run icue:bridge:pack
```

- `icue-widget-1.0.0.icuewidget`: iCUEへインポートするウィジェット。
- `icue-bridge-1.0.0.zip`: Node.js用ブリッジ、Windowsヘルパー、起動ファイル、Chrome登録スクリプト、ライセンス、説明書。

ウィジェットのバージョンは独立した1.0.0を維持しています。Stream Deck / Chrome版のリリース番号は変更しません。ブリッジのビルドにはRustとWindows x64向けVisual Studio C++ビルドツールが必要です。ZIPを使う側にはRustは不要ですが、Node.js 24以降が必要です。

1. **Stream Deckを使う場合:** この変更を含むMedia Controlsプラグインをビルド・導入し、プラグインを再起動します（開発時は `npm run build`、リンク済みなら `npm run restart`）。プラグイン起動時にiCUE用ブリッジも自動起動し、終了時に停止します。`run-bridge.cmd`、独立ブリッジZIP、別途のNode.jsインストールは不要です。iCUEのStream Deck Provider、仮想デバイス、専用キーの配置も不要です。
   **Stream Deckを使わない場合:** ZIPをローカルフォルダーに展開し、`run-bridge.cmd`を開きます。コンソールを開いたまま使用し、停止するにはCtrl+Cを押します。ログイン時の自動起動は登録しません。
   **独立ブリッジから切り替える場合:** 先にCtrl+Cで独立ブリッジを停止し、その後プラグインを再起動してください。既存の接続トークンとウィジェット設定はそのまま使用できます。
2. iCUEのXENEON EDGEウィジェット画面で、利用可能なウィジェットの `+` から `.icuewidget` をインポートし、Edge Media Deckを配置します。
   ファイル選択ダイアログが動かない場合は、`.icuewidget`を直接開いてください。Windowsの関連付けからiCUEのインポート画面を表示できます。
3. 表示されるローカル接続・自己署名証明書の権限を許可します。
4. 次のコマンドで**自分のPCで生成された**トークンを読み、iCUEの「接続トークン」に貼り付けます。トークンは秘密情報なので共有しないでください。

```powershell
Get-Content "$env:LOCALAPPDATA\StreamDeckMediaControls\icue-token.txt"
```

5. Windowsのメディアセッションに対応するアプリで再生し、画面の「プレーヤー」「音量の対象」を選びます。選択はウィジェットの `uniqueId` ごとに保存します。トークンはlocalStorageへ保存しません。

開発中は `npm run icue:bridge` でビルド・起動できます。Nodeやnpmの実行環境に問題がある場合は、同等の `node scripts/pack-icue.mjs`、`node scripts/pack-icue-bridge.mjs`、`node scripts/run-icue-bridge.mjs` を使用してください。

### 内蔵ブリッジのオン・オフ

Stream DeckでMedia Controlsのキーまたはダイヤルを選び、設定画面の「iCUE連携」を開いて「iCUE用ブリッジを有効にする」を切り替えます。設定はプラグイン全体で共通です。初期値はオンで、Stream Deckのグローバル設定 `icueBridgeEnabled` に保存し、再起動後も保持します。保存済みの設定を読み込む前には待受けを開始しません。

オンにすると内蔵ブリッジを起動し、オフにするとiCUEの接続と待受けを停止します。プラグインの再起動は不要で、Stream DeckとChromeの操作は継続します。トークンと証明書は削除しないため、再びオンにしたときも既存のウィジェット設定を使用できます。この切り替えは、別途 `run-bridge.cmd` で起動した独立ブリッジには適用しません。

設定画面には稼働中・オフ・起動失敗の状態を表示します。起動に失敗した場合はプラグインのログを確認し、独立ブリッジとの競合などを解消してからオフ・オンしてください。グローバル設定の読取りに失敗した場合はブリッジを起動せず、プラグインを再起動して確認します。

### 任意のChrome連携

既存のChrome拡張を導入し、展開したブリッジのフォルダーで、実際の拡張IDを指定して登録します。登録は明示的に実行したときだけHKCUのNative Messaging設定を変更します。

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\register-chrome-native-host.ps1 -ExtensionId 実際の拡張ID
```

拡張の設定で送信を有効にし、再生ページを再読み込みします。接続状態はウィジェット下部に表示します。登録先は既存のStream Deck版と共通です。

**Stream Deck内蔵ブリッジでは、Chrome受信をStream Deck側と共有するため、両方の画面でChrome情報を使用できます。** Chrome拡張の登録はStream Deckの設定画面からも行えます。

独立ブリッジとの同時起動は避けてください。iCUE受信の39762番ポートとChrome受信の39761番ポートは、それぞれ1プロセスだけが所有できます。プラグインのiCUE待受けに失敗した場合はログへ記録し、Stream Deckの操作は継続します。競合を解消した後、プラグインを再起動してください。独立ブリッジでChromeが不要なら `run-bridge.cmd --no-chrome` を使用できますが、iCUE受信ポートの競合は解消しません。Chromeの登録・送信の解除手順は既存の [FAQ](../docs/faq.ja.md) も参照してください。

### iCUE標準モード

「Windowsブリッジを使用」をオフにすると従来のMedia Data Provider 1.1による曲情報表示と前へ／再生一時停止／次へを使用できます。このモードにはNode.jsやRustヘルパーは不要です。シーク・音量・プレーヤー固定は利用できず、iCUEのアクティブセッションが操作対象になります。

ブリッジが切断されても標準モードへ自動切替しません。表示していない別プレーヤーへの操作を防ぐためです。

## 設定

| 設定ID | 内容 | 初期値 |
|---|---|---|
| `useBridge` | 独立Windowsブリッジを使用 | オン |
| `bridgeToken` | ローカルブリッジの認証トークン | 空欄（自分のPCの値を設定） |
| `showArtwork` | アルバムアート表示 | オン |
| `showAlbum` | アルバム名表示 | オン |
| `scrollTitle` | 長い曲名のスクロール | オン |
| `textColor` | 文字色 | `#F7F8FC` |
| `accentColor` | アクセント色 | `#66E6CE` |
| `backgroundColor` | 背景色 | `#111827` |
| `transparency` | 背景のみの透明度 | 0%、0〜100% |

既存の設定IDを維持しています。設定ラベルは日本語／英語、画面と操作ラベルは日本語です。背景透明度は文字・アート・ボタンを薄くしません。iCUEプレビューと実機用画面は比例拡縮し、縦長の枠では基準の文字・操作サイズを保ちながら、アートを拡大して操作部分を残りの高さへ配置します。横長の枠でもアートと操作が画面全幅を使います。アートは縦横比を保ち、画像全体を表示します。

Chrome連携は696px角を基準に画像候補を選び、350KBの取得上限内で大きなアートを優先します。YouTubeではMedia Sessionの縮小画像に加えて、現在の動画ID・曲名・再生要素が一致するプレーヤーの画像候補も使用します。URLを推測したり、前のページの汎用サムネイルを流用したりしません。候補がすべて小さい場合は最大の画像を使用します。提供元が低解像度の画像しか公開しない場合は、その画質が上限になります。更新後はChromeの拡張機能画面で拡張を再読み込みし、再生ページも再読み込みしてください。長い曲名は先頭で1秒待ってからスクロールし、末尾まで進むと先頭に戻って繰り返します。曲名を左右になぞるか、フォーカスして左右矢印・Home・Endキーを押すと手動でスクロールできます。操作後は2秒間その位置を保ち、自動スクロールがオンなら先頭から再開します。自動スクロールがオフの場合も手動操作は有効です。iCUEの「長い曲名のスクロール」をオンにすると、Windowsのアニメーション設定にかかわらずスクロールし、オフにすると省略表示します。設定が注入されないブラウザーデモではOSの「動きを減らす」設定に従います。

## 通信と権限

| manifestの権限 | 範囲 | 用途 |
|---|---|---|
| `url` | `127.0.0.1:39762` | 自分のPCのHTTPSブリッジから状態を受信し、操作を送信 |
| `self-signed-certificate` | `127.0.0.1` | ブリッジが生成するローカル証明書を使用 |

権限はインストール時に表示され、iCUE設定で取り消せます。ウィジェットは外部API、外部画像・スクリプト・フォント、ローカルファイル読取り、クリップボード、Stream Deck Providerを使用しません。アートとアイコンはブリッジからのサイズ制限付きPNG/JPEG/WebP data URLだけを表示します。APIキー・アカウントへのログインは不要です。

### iCUE 5.52.93と公式CLIの権限表記の差

実アプリのインポーターは `self-signed-certificate`（ハイフン）と `domain` フィールドを使用します。公式資料とCLI 0.5.1の `self_signed_certificate` / `host` とは表記が異なります。iCUE 5.52.93の実ログで、アンダースコア表記の「無効な権限タイプ」と、`host`指定による「Missing domain field in permission」を確認しました。ソースmanifestと配布パッケージは次の定義を使用し、ファイルを直接開いた実iCUEで権限確認画面まで進むことを確認済みです。権限承認後の最終インポートと実機タッチ操作は別途確認が必要です。

```json
{ "type": "self-signed-certificate", "domain": "127.0.0.1" }
```

`npm run icue:check` / `npm run icue:pack` は、一時コピーの証明書権限のタイプ名と項目名（`domain` → `host`）だけをCLI向けに変換して公式CLIの構造・スコープ・使用権限検査を実行します。検証後の配布には元のmanifestを使い、ロック済みCLIのZIP生成処理でパッケージ化します。権限の削除・拡張、TLS検証の無効化は行いません。`icuewidget validate icue-widget` の直接実行は、この表記差に対応しないため使用しないでください。

ブリッジは`127.0.0.1`のみに待受け、Bearer認証、Host／Origin検査、要求サイズ・接続数・同時コマンド数の制限を行います。ローカルHTMLのOriginは通常のChromiumが送る `null` と、実iCUEのQtWebEngineが送る `file://` の完全一致だけを認めます。トークンなしでは読取り・操作できません。トークンをURL・ログへ出さず、Windowsの保存先は現在のユーザーとSYSTEMに限定します。Chromeとは別のトークンを使います。

状態は変更通知で受信し、10秒ごとに状態と期限付きの表示確認情報を更新します。表示確認情報は操作先のセッション・曲・音量対象に結び付き、30秒で失効します。現在の対象・曲・対応操作と一致しなければ操作を拒否します。Chromeではdocumentとメディア要素のIDも照合します。シーク中に曲が変わった場合も、ジェスチャー開始時の対象を照合します。音量は絶対値を指定し、従来プラグインの相対音量操作も維持しています。

接続がなくなれば曲情報と操作を解除し、原因としてブリッジ未起動・トークン・権限の確認を案内します。18秒間応答がなければ再接続し、失敗時は3秒後に再試行します。非表示時は通信・タイマーを解放し、復帰時に再接続します。失敗した操作は再送せず、成功したと推測して再生状態を変更しません。情報なし・操作非対応は未知／無効として扱います。

## 検証

```powershell
node --test tests/icue-widget.test.mjs tests/icue-server.test.mjs
npm run check:fast
npm run test:icue:e2e
npm run icue:pack
npm run icue:bridge:pack
```

Playwrightのブラウザーがない場合は `npm run test:chrome:install` で導入します。テストはモックのプレーヤーと公開テスト用TLS証明書を使い、PCの実際の再生／音量を変更しません。スクリーンショットは `tests/.generated/icue-bridge-*.png` に出力します。

iCUE標準モードのブラウザーデモは `index.html?demo=1` で明示的に有効にできます。配布パッケージにデモは含めません。`.icuewidget`にはHTML/CSS/JS、manifest、翻訳、アイコン、プレビュー、ライセンスだけを含め、ブリッジ本体と秘密情報は含めません。

公式CLI・ブラウザーテストは実機受け入れの代替ではありません。実機ではインポート・ローカル通信権限・自己署名TLSの接続・タッチ・複数プレーヤー・スリープ復帰を別途確認してください。Marketplace公開用の審査や掲載資料は、この個人利用向け成果物の範囲外です。

配布パッケージのHTMLは、`scripts/icue-widget-html.mjs` が本体スクリプトをbody内へ埋め込んで生成します。実iCUEでは設定値とイベントの束縛がホストの関数スコープへ注入され、通常の外部スクリプトから接続トークンなどを参照できないためです。編集元は引き続き `scripts/bridge.js` と `scripts/widget.js` です。ソースHTMLのまま上書きせず、`npm run icue:pack` で生成したパッケージを導入してください。ブラウザーテストには、設定値をwindowへ公開しないホストスコープの再現も含めています。

## 編集先

| ファイル | 用途 |
|---|---|
| `index.html` / `styles/style.css` | 設定、画面、比例レイアウト |
| `scripts/widget.js` | 共通表示とiCUE標準プロバイダー |
| `scripts/bridge.js` | 認証通信、対象選択、追加操作、再接続 |
| `manifest.json` / `translation.json` | 対応環境、権限、設定ラベル |
| [icue-server.ts](../src/icue-server.ts) | HTTPS、表示確認情報、コマンド検証 |
| [icue-runtime.ts](../src/icue-runtime.ts) | 内蔵／独立ブリッジ共通のトークン、メディア状態・操作との接続 |
| [icue-integration.ts](../src/icue-integration.ts) | 内蔵ブリッジのグローバル設定、オン・オフ、稼働状態 |
| [plugin.ts](../src/plugin.ts) / [icue-bridge.ts](../src/icue-bridge.ts) | 内蔵／独立ブリッジそれぞれの起動／終了 |
| [build-icue-bridge.mjs](../scripts/build-icue-bridge.mjs) | 独立ブリッジのビルド |
| [pack-icue.mjs](../scripts/pack-icue.mjs) / [pack-icue-bridge.mjs](../scripts/pack-icue-bridge.mjs) | 配布物の生成 |
| [icue-server.test.mjs](../tests/icue-server.test.mjs) / [icue-bridge-e2e.mjs](../tests/icue-bridge-e2e.mjs) | 通信と表示／操作の検証 |

## 公式資料

- [Widget仕様](https://docs.elgato.com/icue/widgets/specification/)
- [Media Data Provider 1.1](https://docs.elgato.com/icue/widgets/references/plugins/media-data-provider/)
- [権限](https://docs.elgato.com/icue/widgets/references/permissions/)
