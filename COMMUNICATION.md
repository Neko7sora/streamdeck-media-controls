# 通信の最適化（v0.4.7）

既存の Node.js / HTTP / Native Messaging を使い、新しい依存関係は追加していません。描画、30fpsの文字送り、再生位置の補間、ChromeとWindowsの照合条件、表示した対象への操作、音量対象の分離は維持しています。

## 方式

```text
ページ ─ イベント・位置補正 ─→ isolated bridge ─→ Chrome worker
                                                     │ 差分 + 画像参照
                                                     ↓
                                               Native Messaging
                                                     │
                                                     ↓
                                               Node.js host
                                                     │ 認証付き HTTP POST
                                                     ↓
                                               Stream Deck plugin
                                                     │
操作指示 ← 同じ document / target ID で検証 ← Native Messaging ← 常設 HTTP 受信ストリーム
```

- **操作**: `GET /chrome/events` の認証付き NDJSON ストリームで即時配信します。状態の送信、画像の取得、画像転送の応答を待ちません。タブ・フレーム・document IDで配信し、ページ内のtarget ID・曲名も従来どおり検証します。操作はdocument単位で直列化し、全体32件に制限します。HTTP応答に操作が戻る互換経路も同じ待ち行列を使い、切断・復旧で経路が混在しても受信順に実行します。トグルなどの実行結果が不明な操作は自動再送しません。
- **状態**: ページイベントで変化を通知します。Media Sessionのメタデータなど変更イベントがない値を発見するため、ページ内の1秒観測は維持します。通常再生はローカル補間し、5秒ごとの位置補正と、0.25秒を超える位置のずれ・状態変更で再同期します。無メディアのページは初回と変化時だけ通知します。isolated bridgeの250msの合流処理も維持します。
- **差分**: documentごとのbase sequenceを確認し、変更したトップレベルフィールドだけを送ります。ネストしたtimeline等は1フィールドとして置換します。baseが失われた場合は全状態で復旧します。画像以外の状態は64KB、保持するフレームは256件までです。
- **画像**: 同じ曲情報とURL候補の取得を共有し、取得済み内容のSHA-256を画像参照に使います。曲が変わった場合は同じURLでも再取得し、可変URLの画像を古いまま表示しません。同じ内容の画像はタブ・曲・favicon/アートワークをまたいで重複転送しません。同時転送も合流します。他フレームが画像を転送中でもメタデータを先に送り、完了後に画像参照を追加します。受信側はハッシュと従来の画像形式制限を検証します。受信キャッシュは128件・16MBまでで、未保持の参照が来た場合は不足画像だけ再送します。外部画像の5分キャッシュと失敗時の短い再試行期限は維持します。
- **接続状態**: 実際の状態・操作通信を接続確認に使います。常設経路に活動がない場合だけ約5秒ごとに短い通知を送り、Chromeから確認応答を返します。通常通信がある間の独立したstatus要求を抑えます。ネイティブホストが生きているだけではChromeの接続状態を延命しません。ホストは通常のHTTP応答も生存確認に使います。ホストの応答停止監視は12秒、Chromeセッションの期限は従来どおり15秒です。
- **設定画面**: 初回に全一覧を取得し、その後はsessions/audio/接続状態の変更した集合だけを通知します。観測時計の更新だけでは送信しません。3秒間応答がない場合の軽い生存確認と、6秒の応答停止検知は残します。設定revision、保存済み対象、切断済み対象、選択欄の維持は従来どおりです。Chromeのpopupも状態変化を専用の拡張内portで受信します。
- **Windowsヘルパー**: `--watch --delta` を追加し、currentはsession ID参照、画像はヘルパー内で内容を共有した参照にします。変更がない間は5秒ごとの短い通知だけです。Windows APIのイベント購読と1秒の補助観測は維持します。プロセス再起動では独立したキャッシュから再開します。

## 復旧とセキュリティ

HTTPは引き続き `127.0.0.1` だけで待ち受け、Bearer tokenとWindows DACLを変更しません。トークンはホストだけが読み、Chrome拡張には渡しません。ストリームにも同じトークンが必要です。ホストごとの一時client IDで、状態を送信したホストに操作を配信します。ストリームは最大8本、書き込みが詰まった接続は閉じます。

拡張機能は `storage.local` の `bridgeClientId` に接続元ごとの UUID を保存し、各要求の `client_id` として送ります。再生状態・差分の基準・操作・結果の照合にはこの安定した ID を含め、同じタブ／frame／document ID が別の接続元に存在しても混在させません。Native Messaging ホストの `x-sdmc-client` は一時的な配送先として使い、再接続で変わっても保存済みの再生対象は維持します。`client_id` を省略する旧拡張は従来の名前空間を使います。新方式への初回更新時は明示選択していた Chrome 対象の再選択が必要です。

Native Messagingのallowed_origins、TRUSTED_CONTEXTS、送信のオプトイン、画像URL・容量・MIME・リダイレクトの制限、ページURLからの秘密情報除去を維持します。popupのportも拡張IDとoptions.htmlのURLで検証します。

ホストは切断後250msから最大5秒の間隔で再接続し、再接続のたびにトークンを読み直します。ストリームreadyまたはepoch変更時には差分のbaseと転送済み画像を忘れ、15秒以内にページから観測した状態と必要な画像を再送します。古いdocument、無効化前の処理、閉じたタブの画像・操作は復活させません。キャッシュ失効、タブ移動、Chrome worker再起動にも全状態または不足画像の再送で対応します。

設定画面の購読がプラグイン再起動で失われた場合は、`alive` / `watch` への応答に `optionsRequired` を付けて全一覧の再取得を要求します。設定画面は既存の設定revisionで再登録し、復旧待ちの編集を古い応答で上書きしません。再登録後は差分通知と軽い生存確認に戻ります。

## 測定結果（2026-10-21）

比較元は `344746fce64a6985e4724f629d8af9187b1d6bc5`。生の結果は [docs/communication-measurements.json](docs/communication-measurements.json) です。

### 同一イベント列の60秒リプレイ

旧版と作業ツリーの実際のページ・bridge・workerをVM内で実行しました。1ページの通常再生、timeupdate 4Hz、ページ内観測1Hz、200,000 byteのアートワーク、favicon、変更のない曲情報です。無メディアのページは別に測定しました。

| 指標 | 変更前 | 変更後 |
|---|---:|---:|
| 無メディアのページ→拡張更新 | 61回 | 1回（初回のみ） |
| 再生ページ→拡張更新 | 241回 | 13回 |
| ページ→拡張のJSON | 168,939 B | 9,087 B |
| ローカル状態HTTP要求 | 241回 | 15回 |
| ローカル状態HTTP本文 | 64,222,183 B | 270,894 B（99.58%減） |
| 拡張→Native Messaging要求 | 255回 | 17回 |
| 拡張→Native Messaging要求＋4 byteヘッダー | 64,230,361 B | 271,430 B |
| 同じアートワークのローカル転送 | 240回 | 1回 |
| 独立したstatus要求 | 14回 | 1回（初回） |
| 外部画像の取得 | 2回 | 2回 |

HTTP本文とNative Messagingの値は同じ情報が別の境界を通る量です。合計してインターネット通信量と解釈しないでください。HTTP/TCPヘッダー、受信ストリームの通知、USB転送、ブラウザの音声・映像通信は含みません。受信ストリームは接続時のreadyと、約5秒以上活動がない場合の短い通知が加わります。画像の取得完了は非同期のため、複数画像が同時に完了する場合の要求数は合流タイミングで変わり得ます。

設定画面は4KiBの詳細1件、30秒時点で音量変更、45秒時点で曲変更の同じ60秒です。

| 指標 | 変更前 | 変更後 |
|---|---:|---:|
| 全一覧応答 | 61回 | 1回 |
| 設定画面の要求 / 応答 | 61 / 61回 | 21 / 23回 |
| JSONペイロード合計 | 271,555 B | 11,297 B（95.84%減） |

### 実プロセスの操作完了時間

旧・新それぞれのホストとサーバーを動かし、Native Messagingとlocalhost HTTPを往復し、結果のacknowledgementまで測りました。旧版は一時停止ページの1Hz更新に対し0〜950msの20位相、新版は状態更新なしで20操作です。Chrome DOMや実機の処理時間は含みません。

| 指標 | 変更前 | 変更後 |
|---|---:|---:|
| p50 | 592.47 ms | 15.83 ms |
| p95 | 987.55 ms | 16.34 ms |
| 最大 | 1,031.97 ms | 16.46 ms |

別の統合テストでは、状態更新を止めたまま操作を20件配信してp95が500ms未満であること、受信経路とプラグインの再起動後に復旧することを検証しています。数値はマシン負荷とOSのスケジューリングで変わります。

### Windowsヘルパーの実測

同じデスクトップで旧形式と差分形式を同時に6.2秒観測しました。GSMTCセッションは0件、Core Audioは取得可能でした。

| 指標 | 旧形式 | 差分形式 |
|---|---:|---:|
| 標準出力 | 9,709 B / 7パケット | 1,469 B / 2パケット |
| 内容変更を含む受信 | 7回 | 1回 |

この実測には再生中セッションの画像は含まれません。画像の共有・状態変更・キャッシュリセットはRustとJavaScriptのテストで別途検証しています。

## 再現手順

```powershell
node scripts/measure-communication.mjs --baseline=344746fce64a6985e4724f629d8af9187b1d6bc5 --verify
node scripts/measure-command-latency.mjs --baseline=344746fce64a6985e4724f629d8af9187b1d6bc5
node scripts/measure-native-traffic.mjs
node --test tests/*.test.mjs
```

比較元commitを取得済みのGit checkoutが必要です。実通信テストはlocalhost接続が可能な環境、Windows測定はビルド済みmedia-info.exeと対話ユーザーのWindows APIアクセスが必要です。計測スクリプトは `--output=<path>` でJSONを保存できます。npmの `measure:communication` / `measure:latency` / `measure:native` からも実行できます。

最終検証ではJavaScript 145件、Rust 8件が成功しました。TypeScript型チェック、Chromeスクリプトの構文確認、Rustの書式、releaseビルド、同梱画像ランタイムと日本語フォント描画、読み取り専用のWindows API smoke、公式スキーマ検証も成功し、v0.4.7.0の配布パッケージを生成しています。`--verify` はページの更新頻度、画像転送1回、状態HTTP本文300KB未満、設定ペイロード15KB未満の通信予算を検証します。

## 互換性と残る確認

- 新しい依存、権限、クラウド接続は追加していません。設定形式とアクションUUIDは変更していません。
- 新しいプラグイン・Chrome拡張に加え、設定画面の「Chrome 連携を登録」を一度実行してインストール済みホストを更新し、拡張と再生ページを再読み込みしてください。旧ホスト・旧プラグインとの組み合わせでは従来の状態更新による操作受信へ戻り、1秒間隔を維持します。最適化は新方式を確認できてから有効にします。
- Windowsヘルパーの単独JSON / `--watch` は維持します。プラグインは旧形式も読み取れます。旧設定画面は従来の要求方式で利用できます。
- Chromeの次/前、Web Audioのみの操作、閉じたShadow DOM等の既存の未対応範囲を広げる変更ではありません。既存のWindows経由の曲送りは維持します。
- Chromeの強いバックグラウンド抑制で15秒間サンプルが来ないフレームは、従来どおりセッションが失効します。常設経路が生きているだけで古い再生状態を延命しません。
- ライブ配信のseekable/buffered範囲など実際の状態が頻繁に変化する場合は、その変更を保つため更新頻度が上がります。上記の削減率は固定の測定条件に対する値です。
- 物理Stream Deck / Stream Deck + と実Chromeサイトでの総合操作、Chromeプロセス再起動・省電力復帰は実機確認が残ります。自動テストはworker再生成、ホスト切断、プラグイン再起動、古いdocument・opt-inの無効化を検証します。

## 主な変更ファイル

| 範囲 | ファイル |
|---|---|
| ページ・拡張・popup | `chrome-extension/page-main.js`, `bridge-isolated.js`, `background.js`, `options.js` |
| HTTP・Native Messaging | `src/chrome-server.ts`, `src/chrome-wire.ts`, `scripts/chrome-native-host.mjs` |
| Windows IPC | `native/media-info/src/main.rs`, `wire.rs`, `src/native-client.ts`, `src/native-wire.ts` |
| 設定の通知 | `src/plugin.ts`, `src/media-state.ts`, `src/inspector-updates.ts`, `dev.n7s.media-controls.sdPlugin/ui/settings.js` |
| 回帰検証・測定 | `tests/communication.test.mjs`, `chrome-transport.test.mjs`, ページ・worker・settingsの既存テスト、共有harness、`scripts/measure-*.mjs` |
| バージョン・説明 | `package.json`, `package-lock.json`, 両manifest、`README.md`, 本文書、測定JSON |
