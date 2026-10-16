# Stream Deck Media Controls v0.4.3

Windows + Chrome 向けの Stream Deck プラグインです。v0.4.3 では日本語の曲名・アーティスト名を Meiryo UI で描画し、字間と文字サイズを調整しました。滑らかなスクロール、再生位置のリアルタイム表示、ダイヤルによる巻き戻し・早送りも引き続き利用できます。

**開発・検証候補です。Windows x64 のビルド・API 読み取り・自動テストは確認済みですが、物理 Stream Deck / Stream Deck + と実 Chrome 拡張を通した実サイト操作は未確認です。** 自動テストではセッション選択、Chrome の処理待ち、ヘルパー切断・復旧、シーク、日本語フォント・連続フレームの描画を確認しています。Windows の1セッションの読み取りは v0.4.0 で確認済みです。v0.3.0 時点の監査の詳細は [AUDIT.md](AUDIT.md) を参照してください。

## 取得・表示・操作

アプリやサイトが公開した情報だけを扱います。欠損メタデータは内部で `null`、未知の数値は `null`、UI では `Unavailable` / `--:--` として扱います。ページタイトルを曲名として代用しません。API が返す空文字やゼロ値はネイティブ JSON にそのまま残る場合があります。

| 情報・機能 | Windows | Chrome | Stream Deck での利用 |
|---|---|---|---|
| アートワーク | GSMTC Thumbnail | Media Session artwork、サイズ・MIME 候補 | 通常キー / + に縦横比を維持して表示。Chrome 画像失敗時は Windows 画像、それもない場合は既定アイコン |
| アプリ / サイトアイコン | AUMID の登録ロゴ / Shell アイコン。実行ファイル名が一致する Audio Session があれば、その実行ファイルも参照 | ページの icon / apple-touch-icon と同じオリジンの /favicon.ico | Now Playing の右上 / + の状態表示の横に表示。favicon を優先し、欠損・取得失敗・デコード失敗時は Windows のアプリアイコン |
| 曲名・アーティスト | GSMTC | Media Session | 通常キー / +。欠損をページ名から推測しない |
| アルバム | GSMTC | Media Session | 設定画面の取得情報 |
| サブタイトル・アルバムアーティスト・ジャンル・トラック番号/総数・メディア種別 | 公開時のみ | 共通 API からは取得しない | 設定画面の取得情報 / native JSON |
| 再生状態 | GSMTC enum と表示用状態 | Media Session / アクセス可能な HTMLMediaElement | キーの状態記号 / + の状態文字 |
| 位置・長さ・シーク可能範囲 | GSMTC Timeline | HTMLMediaElement、観測後の setPositionState | + に位置・長さ・進捗を表示。再生中は取得時刻・速度から位置を補間。対応時は回転 / バーのタップでシーク |
| 再生速度 | GSMTC | HTMLMediaElement / 観測した setPositionState | 取得情報。速度変更 UI は未実装 |
| シャッフル・リピート | GSMTC | HTMLMediaElement の loop のみ（同義とは扱わない） | 取得情報。変更 UI は未実装 |
| 利用可能な操作 | GSMTC Controls | アクセスできる HTMLMediaElement の操作だけ | 未対応操作を拒否してアラート。ブラウザの次/前は直接操作しない |
| 再生 / 一時停止・停止・次/前 | 指定した GSMTC オブジェクトへ Try*Async | 再生/一時停止・停止・シークのみ、対象ドキュメントの HTML 要素へ | 基本操作 / Now Playing。従来のグローバルキーも設定で選択可 |
| 複数セッション・アプリ情報 | WinRT オブジェクト単位の一時 ID、AUMID | タブ + frame + document ID、ページ URL / タイトル | 各アクションの設定で選択。+ の長押しで順に切替 |
| マスター音量・ミュート | Core Audio、既定のマルチメディア出力 | ブラウザ要素の volume / muted は別の情報 | Volume Dial / + に Windows の選択対象の音量。回転で2%/tick、Volume Dial 押下/タップでミュート |
| アプリ別音量・ミュート | 同じ出力デバイスの Audio Session、PID / 実行ファイル名 | GSMTC やタブとは自動対応付けしない | 独立した音量対象リストで明示選択して変更 |
| buffered / seekable、ended、readyState、PiP、loop | 対応する共通 GSMTC 情報なし | アクセス可能な HTMLMediaElement | 設定画面の取得情報。専用の操作 UI は未実装 |
| 取得元・観測時刻 | observed_at、Timeline 更新時刻 | 受信時刻、補完時刻 | 取得情報。補完したフィールドの取得元も記録 |

## Windows x64 ビルド

Windows 10 1809+ / Windows 11、Stream Deck 7.1+、Node.js 24、Rust MSVC toolchain と Visual Studio C++ Build Tools / Windows SDK が必要です。CLI はプロジェクト依存に含まれます。

**Developer PowerShell for Visual Studio（x64）** でリポジトリを開きます。`cargo` / `node` / `npm` が PATH にあることを確認してください。

```powershell
npm ci
npm run check
npm run test:native
npm run test:smoke
npm run validate
npm run pack
```

`check` は JS 構文、TypeScript の SDK 型、JS テスト、Rust release ビルド、パッケージ資産と同梱画像ランタイムを検証します。`test:native` は Rust テスト（ローカル実行ファイルの Shell アイコン読み取りを含む）、`test:smoke` は実際の Windows API 読み取り・存在しない対象の操作拒否・終了確認です。再生や音量は変更しません。

Cargo.lock / package-lock.json を固定してビルドします。`link.exe not found` は C++ ツール未導入か開発用シェルの環境設定不備を確認してください。GSMTC が `0x80070005` を返す制限付きシェルでは、通常の対話 Windows ユーザー環境で実行してください。スキーマ取得エラーがある場合、CLI の「成功」表示だけを正式な検証成功と扱わないでください。

生成した `.streamDeckPlugin` をダブルクリックして導入できます。開発中は次も使用できます。

```powershell
npm run link
npm run restart
```

プラグインの `.sdPlugin/node_modules` は sharp のネイティブ画像処理ランタイムです。`bin` / `native` と一緒に配布してください。ビルドはその生成済み node_modules を毎回作り直します。依存のライセンスファイルも同梱します。

## 設定と操作

各アクションを選択すると、表示・再生対象と音量対象を別々に選べます。

- 自動表示は再生中のセッションを優先し、同じ再生状態の候補が複数あっても現在の対象を維持します。定期受信・再生位置の更新・Windows 現在セッションの変動だけでは切り替えません。初回や対象の切断時は、再生中の候補（なければ全候補）から Windows 現在セッション、更新時刻の順で選びます。現在の対象が一時停止・停止して別の対象が再生中なら切り替えます。表示・操作したい対象を固定する場合は明示選択できます。
- Chrome 補完には「Chrome の Windows セッション」「空でない同じ曲名・アーティスト」「アルバムが競合しない」「一致候補が1個」の条件が必要です。タイトルだけの一致では補完しません。
- 選択対象が消えた場合やヘルパー再起動後には、別セッションへ自動で切り替えません。設定画面で再選択してください。GSMTC の ID はヘルパー存続期間内だけ有効です。
- Now Playing はアートワーク・曲名・アーティスト・状態を表示し、押すと表示用に最後に送信したセッションへ再生/一時停止を要求します。
- アプリ / サイトアイコンはアートワークと別に表示します。favicon の取得には Chrome 拡張の更新・再読み込みと、再生ページの再読み込みが必要です。PNG / JPEG / WebP / ICO の favicon を32pxの PNG に変換して扱い、SVG は対象外です。Windows セッションへの favicon の補完は、曲名・アーティスト・アルバムの既存の一致条件を満たす一意の Chrome セッションだけで行います。Chrome セッションを直接選んだ場合の Windows アイコンも一意に一致する Chrome の Windows セッションから取得します。どちらのアイコンも取得できない場合、アイコン欄は空になります。未登録の Win32 アプリでは実行ファイルを解決できず、アイコンが取得できないことがあります。
- Now Playing / Now Playing + の長い曲名・アーティスト名は、それぞれ独立して自動スクロールします。全文を一度画像化し、約30fps・毎秒30px（通常キーは2倍解像度で描画）の速さで表示範囲を動かします。文字を1文字ずつ切り替えません。先頭と末尾で1.5秒止まり、末尾まで表示してから先頭へ戻ります。短い文字列は動かしません。再生位置の更新や一時停止ではスクロールをリセットせず、曲やセッションが変わると先頭から表示します。
- Now Playing + の曲名は上段の全幅を使い、アーティスト名はアートワークの横に表示します。通常キーはアートワークに状態・曲名・アーティスト名を合成し、文字の下に暗い背景を敷きます。文字は画像内に描画するため、Stream Deck のタイトル文字サイズには依存しません。全文は取得元から取得できた範囲（各500文字まで）です。描画済みの文字とアートワークを再利用し、ダイヤル画面には変わった項目だけを送信します。非表示時にはアニメーション対象から外れます。
- 文字は Windows の Meiryo UI のフォントファイルを明示して描画します。未導入の場合は Yu Gothic UI、Segoe UI の順に利用します。フォントファイルは同梱しません。曲名は標準の太さで表示し、文字列や絵文字の有無による画像全体の縮小を行いません。
- Now Playing + はアートワーク・曲名・アーティスト・状態・位置/長さ・進捗を表示します。右回転＝早送り、左回転＝巻き戻しで、初期値は5秒/目盛りです。設定から1 / 5 / 10 / 30 / 60秒を選べます。押下＝再生/一時停止、進捗バーをタップ＝対応時だけシーク、長押し＝セッション切替です。表示用に最後に送信したセッションだけを操作します。
- Now Playing + の「ダイヤル回転」を「音量」にすると従来どおり選択した Windows 音量を操作・表示します。シークモードでは右下に移動幅（例：±5s）を表示します。Volume Dial は引き続き音量専用です。
- 連続回転は移動量を積み上げ、操作が返るまでの回転をまとめて順に送信します。Chrome のシーク可能範囲に隙間があっても小さな回転を積み上げ、次の範囲へ進めます。一時停止中の同じ位置の定期受信では積み上げを消さず、同じ位置への重複シークも抑えます。範囲の端で回しすぎても逆回転ですぐ戻せます。位置や範囲が取得できない場合はアラートを表示します。
- Volume Dial は回転＝音量、押下またはタップ＝ミュートです。
- 基本7操作と Volume Dial で「従来のグローバルメディアキー」を有効にすると SendInput を使用します。このモードでは OS が操作対象を決めます。Now Playing にはこの設定を適用しません。
- 対象指定モードの基本操作は同じ対象設定にしてください。個々のキーとダイヤルはそれぞれ独立した設定を持ちます。

## Chrome 拡張（任意・オプトイン）

1. プラグインを起動します。`127.0.0.1:39761` にだけ待ち受けます。
2. `chrome://extensions` の開発者モードで `chrome-extension` を「パッケージ化されていない拡張機能」として読み込みます。
3. 拡張のオプションで `%LOCALAPPDATA%\StreamDeckMediaControls\chrome-token.txt` の64桁トークンを登録し、送信を有効にします。
4. 既に開いていたメディアページを再読み込みして、再生を開始します。Stream Deck の設定に Chrome の各フレームが現れるか確認してください。
5. 拡張やプラグインを更新した場合、両方を更新して再起動してください。v0.2 の旧通信形式とは互換ではありません。

Web サイト全般の Media Session と CDN 画像を扱うため HTTP / HTTPS の広いホストアクセスを宣言しています。`tabs`、Cookie、履歴、webRequest、scripting、音声キャプチャの権限は使いません。Chrome のサイトアクセス設定で対象サイトを絞れます。無効時にはメタデータや画像を送信・取得しません。既存の表示は最長約15秒で失効します。

トークンはページへ渡さず、Chrome storage.local のアクセスも TRUSTED_CONTEXTS に制限します。Windows のフォルダー/既存トークンには現在のユーザーと SYSTEM の DACL を設定します（ローカル管理者に対する秘匿機能ではありません）。読み込み・ACL 設定に失敗した場合、ブリッジを起動しません。不正な既存トークンをリセットする場合は、プラグイン停止後にファイルを削除して再起動・再ペアリングしてください。トークンを共有・コミットしないでください。

ページ URL の userinfo・クエリ・フラグメントは送信前に除去します。画像取得は公開 HTTPS URL の上位3候補まで、credentials omit / redirect error / no-referrer、350,000 byte 上限・タイムアウト付きです。既知のプライベート IP・非標準ポート等を拒否します。認証 Cookie、保存認証情報、音声/映像ストリーム、DRM データは取得しません。画像 CDN が認証を要求する場合は取得失敗として扱います。

## 更新・復旧・制限

GSMTC は常駐ヘルパーでセッション/現在対象・メタデータ・再生・タイムラインの変更通知を購読し、約1秒のポーリングで補います。Core Audio は約1秒ポーリングで変更を通知します。Core Audio のネイティブ callback、全出力デバイスの列挙、音量の絶対値入力 UI は未実装です。

Chrome はページイベントと約1秒間隔のスナップショットを使います。MV3 worker は再起動ごとに設定を読み直します。処理はフレームごとに直列化し、同時に8フレームまで処理します。空きができると待機中のフレームを順に再開し、処理済みフレームの待機状態を解放します。document ID を使って移動前のページへの誤操作を避け、タブ終了時には待機処理と後続の操作を打ち切ります。worker 停止・ネットワーク失敗時は次のメッセージで再接続します。バックグラウンドタブのタイマー制限では15秒の TTL を超えて表示が消える場合があります。操作の結果が不明な場合、再生トグルを自動再送しません。

Now Playing + は250msごとに表示内容を見直します。Windows は GSMTC の Position / LastUpdatedTime、Chrome は HTML 要素の currentTime または観測した setPositionState を基準とし、再生中だけ経過時間と再生速度で補間します。一時停止・停止や Chrome のバッファ待ち / シーク中は補間しません。新しいサンプルで位置を補正し、公開された末尾を超えて進めません。長さや位置が未公開の場合は `--:--` のままです。setPositionState だけのページでは再生状態の切り替わりを次の観測時に反映するため、最大約1秒のずれが生じ得ます。

ネイティブ応答停止は約12秒でプロセスを終了し、状態消去後に再起動します。入出力パイプの切断も検出し、保留中の操作を失敗として返してから復旧します。古いヘルパーの終了通知や応答で、新しいヘルパーの操作を取り消しません。タイムアウトした対象指定操作をグローバルキーへ置き換えません。UI は同じ内容の再送を抑止します。

Windows 画像は1 MiB、デコードは PNG/JPEG/WebP・約16.8メガピクセルまでです。アニメーション・SVG・破損画像は表示しません。Windows スナップショットの画像予算、キャッシュ件数/容量、Chrome タブ状態、同時処理数、HTTP 本文に上限があります。失敗画像のキャッシュは再試行期限付きです。GSMTC の全プロパティは完全な OS トランザクションとして読み取れないため、厳密な同時刻性は保証しません。

Media Session にはサイトの action handler を外部から呼び出す標準 API がありません。Chrome 直接操作は一意に選べる HTMLMediaElement に限り、次/前、Web Audio のみの再生制御、閉じた Shadow DOM、アクセス不能なフレーム、非対応画像は unavailable です。`setPositionState` はページへの挿入後に成功した呼び出しだけを観測し、未観測の位置を推測しません。複数の HTML メディア要素が同時再生して一意に選べない場合は要素情報・操作を付けません。

## 実機の受け入れ確認

Chrome の複数タブと Windows の2種類以上のメディアアプリで、次を確認してください。

1. 拡張なしで GSMTC の曲名・画像・位置・操作可否が取得できる。
2. 拡張ありで一致する曲だけを補完し、違う曲や曖昧な候補は混合しない。
3. 曲送り・アート更新・欠損画像・縦長画像・ライブ配信・停止・再生速度変更が表示に反映する。
4. 再生対象と音量対象を別々に選び、意図した対象だけを操作する。未対応操作はアラートになる。
5. + の押下・回転・バーのタップ・長押しと、無効なシーク範囲を確認する。
6. タブ移動/終了、worker 停止、プラグイン再起動、誤トークン、音声デバイス切替から復旧する。

## 公式資料

- [Elgato SDK 3・ダイヤルとタッチストリップ](https://docs.elgato.com/streamdeck/sdk/guides/dials/)
- [Microsoft GSMTC](https://learn.microsoft.com/en-us/uwp/api/windows.media.control.globalsystemmediatransportcontrolssession)
- [Microsoft Core Audio endpoint volume](https://learn.microsoft.com/en-us/windows/win32/coreaudio/endpoint-volume-controls)
- [Microsoft Audio Session identifiers](https://learn.microsoft.com/en-us/windows/win32/api/audiopolicy/nn-audiopolicy-iaudiosessioncontrol2)
- [Chrome content scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts)
- [Chrome storage access control](https://developer.chrome.com/docs/extensions/reference/api/storage)
- [Chrome extension network requests](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests)
- [Media Session position state](https://developer.mozilla.org/en-US/docs/Web/API/MediaSession/setPositionState)
- [sharp packaging](https://sharp.pixelplumbing.com/install/)
