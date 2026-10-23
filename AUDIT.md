# 引き継ぎ監査・改修報告（2026-10-16 / Asia/Tokyo）

対象は v0.2.0 の実ソースです。改修候補を v0.3.0（プラグイン manifest は 0.3.0.0）としてビルド・パッケージ化しました。導入手順と情報一覧は [README](README.md) にあります。

## 1. 既に実装されていた機能

- 10アクションの宣言、画像資産、SendInput による7種類のグローバル操作、Volume Dial、Now Playing / Now Playing + の基本描画。
- Rust の GSMTC プロパティ・再生情報・Controls・Timeline・Thumbnail 取得コードと、Windows INPUT の完全な union レイアウト。
- Chrome MAIN / ISOLATED scripts、Media Session と HTMLMediaElement のスナップショット、MV3 worker、オプトイン設定、Bearer トークン付き localhost POST。
- 曲名・利用可能なアーティストを照合する補完関数、画像 URL 候補のサイズ順選択、簡易キャッシュ、5件のモデルテスト。

ただし「ソースに処理がある」と「ビルド・実動作する」は別です。初期状態の TypeScript 型チェックは失敗し、Rust の非同期 API 呼び出しも指定クレートの API と一致していませんでした。

## 2. 実際には未完成だった機能

| 領域 | v0.2.0 の実態 | 改修後 |
|---|---|---|
| SDK 3 | 不正な JsonObject import、旧デコレーター設定、nullable feedback | 型チェック成功、現行 SDK の設定・イベント動作に対応 |
| Windows helper | windows 0.62.2 に存在しない `.get()`、WinRT 初期化なし | `.join()`、MTA 初期化/解放、Windows release ビルド成功 |
| GSMTC session | 一覧は取得するが操作・選択なし。同じ AUMID の全セッションを current と表示 | IUnknown の同一性で current を判定し、存続期間内の一時 ID で対象指定 |
| Chrome 複数タブ/フレーム | tab ID だけで上書き、空フレームが再生情報を消せる | tab/frame/document を区別、移動後の選択対象は失効 |
| Chrome ライフサイクル | 短い TTL、非同期取得の順序逆転、失敗画像の永続キャッシュ | 直列処理/最新更新の集約、期限付きキャッシュ、設定再読込、受信停止後の状態消去 |
| Artwork | MIME/文字列検査のみ。失敗した Chrome 画像が Windows 画像を隠せる | マジックバイト・実デコード・画素数検証、contain 変換、Windows 画像へのフォールバック |
| + UI | `$B1` の単純な位置/バー。音量・アーティスト・touch handler なし | 専用レイアウト、音量 read-back、押下/回転/タップ/長押し |
| 対象整合性 | 表示に関係なくグローバルキーを送信 | Now Playing は表示用に最後に送ったセッションへ操作。消えた対象では拒否 |
| Core Audio | 未実装 | マスター/アプリ別音量・ミュート、独立した対象選択、1秒ポーリング |
| 配布 | TypeScript/Rust 未検証のソースのみ | ネイティブ画像ランタイムを含む `.streamDeckPlugin` を生成 |

## 3. 発見したバグ・設計問題と根拠

| 根拠となるコード/実測 | 問題 | 修正 |
|---|---|---|
| 初期 `tsc --noEmit` の TS2614 / TS1238 / TS2345 | 型とデコレーターがビルドを阻害 | import の除去、標準デコレーター、null を含まない feedback |
| 指定 windows クレートの実コンパイルで E0599 | WinRT async の `.get()` が存在しない | 実クレートの `.join()` を使用 |
| `image_of(session)` がプロパティを再取得 | 曲メタデータと画像が別読込になり、曲変更時に混ざり得る | 同じ MediaProperties オブジェクトから画像を読む |
| `SourceAppUserModelId` の文字列比較 | 同一アプリの複数セッションを区別できない | 保持する COM オブジェクトの同一性で照合 |
| `chromeTabs: Map<number,...>` と all_frames | 別フレームや空フレームによる上書き | フレームごとの状態とドキュメント識別 |
| `latestChrome()` が単一候補だけを返す | 別タブが新しく通知すると一致する曲を補完できない | 有効な全フレームから一意な一致を探す |
| 元の sameTrack が欠損 artist を許容 | 同じタイトルの別曲を混合し得る | 両者の artist 一致必須、album 競合/複数一致を拒否 |
| 元の publish が Windows 読込成功後のみ | 障害が続くと古い情報や期限切れタブが残る | 失効タイマー、helper watchdog、切断時の空状態通知 |
| 元の feedback が画像キーを省略 | 画像なしの曲で前曲のアイコンが残る | 毎回フォールバックを含む確定値を送る |
| 元の unknown position → `0` | 取得不能を再生開始位置と誤表示 | null とゼロを区別し `--:--` を表示 |
| 元の setPositionState ラッパー | リセットや曲変更後に前の位置が残る | 成功した呼出しだけを記録し、リセット/曲情報変更で無効化 |
| 元の title fallback = document.title | ページ名を楽曲名として捏造 | 曲名 null とページタイトルを別々に保存 |
| 元の cachedArtwork に失敗期限なし | 一時的な HTTP 失敗後に永続的に画像なし | 失敗5秒、成功5分の期限、曲/album/候補をキーにする |
| Windows の `mode:0o600` のみ | POSIX mode では Windows DACL を制限できない | 現在ユーザー/SYSTEM の ACL、再起動時の既存トークン保護もテスト |
| 画像ライブラリ追加時の online npm audit | 旧 sharp に高深刻度の既知脆弱性 | 修正済み 0.35.5、最終 audit は検出0件 |
| SDK 3 の設定イベント仕様 | plugin から setSettings した長押し選択が描画用キャッシュに戻らない | キャッシュを明示更新し、設定画面へ最新設定を返す |

## 4. 修正した内容

- `src/media-model.ts` / `media-validation.ts`：境界の個別フィールド検査、null、欠損/未知値の扱い、保守的な照合、全候補からの選択、取得元/観測時刻、進捗計算。
- `native/media-info`：WinRT lifetime、正しい async API、セッション通知・メタデータ/再生/Timeline 通知、周期スナップショット、画像キャッシュ/予算、同じプロパティからの画像読込、MIME が空でも対応する実シグネチャなら利用。
- `src/native-client.ts`：常駐プロセスとの JSON Lines IPC、要求 ID、有限の待ち時間/待機件数、応答停止時の再起動、切断時の状態消去、ログ抑制、終了処理。
- `src/chrome-server.ts`：loopback 限定、一定時間比較の認証、本文/接続/時間の上限、HTTP エラー、テスト可能な起動/終了、文書を限定した操作キュー、結果 ACK、Windows ACL。
- Chrome：秘密を渡さない MAIN/ISOLATED 境界、trusted storage、フレーム別処理/同時処理上限、移動前ドキュメントへの操作防止、サイズ制限、公開画像の無資格情報 fetch、URL の userinfo/query/fragment 除去、設定エラー表示、抑制付き接続エラーログ。
- `src/artwork.ts`：対応シグネチャ・デコード・画素数の検証、SVG/アニメーション/破損画像の拒否、PNG への contain 変換、サイズ別キャッシュ。
- `scripts/build-plugin.mjs`：sharp を external としてバンドルし、インストール済み production graph と Windows ネイティブモジュールを配布物へ同梱。古い生成ランタイムを除去。パッケージ検査で同梱先から実ロード・PNG 作成。
- `native/media-keys`：SendInput の途中挿入では key-up を試行し、挿入件数をエラーに含める。

## 5. 新たに追加した機能

- アクションごとのセッション選択と取得情報ビュー。
- 選択した GSMTC セッションへの再生/一時停止、前/次、停止、シーク。
- Chrome の特定ドキュメント内で一意に選べる HTMLMediaElement への再生/一時停止、停止（pause、可能なら先頭へ）、シーク。失敗/非対応時は警告し、別アプリへ操作しない。
- Core Audio の既定 multimedia 出力の master と、そのデバイスの個別 Audio Session の音量・ミュート取得/変更。PID と取得可能な実行ファイル情報を使って選択肢を表示。GSMTC との自動対応付けはしない。
- Now Playing + の曲名・アーティスト・アート・再生状態・位置/長さ・進捗・選択対象の Windows 音量、タップシークと長押しセッション切替。
- 既存の7種類のグローバル操作と Volume Dial の互換モード。初期設定は対象指定モードに変更。
- 18件の JavaScript テストと計4件の Rust テスト、読み取り専用の native smoke script。

## 6. 検証コマンドと結果

環境：Windows x64、Node 24.19.0、Cargo 1.98.1、MSVC 14.51 / Windows SDK 10.0.26100.0。最初はリンカーが見つからず失敗しましたが、利用可能な MSVC/SDK の PATH・LIB を設定して成功しました。GSMTC 読み取りと localhost 接続はサンドボックス内では拒否され、承認された通常の Windows 実行で確認しました。

| コマンド | 結果 |
|---|---|
| `npm run check` | 成功。JS/設定画面構文、18 JS テスト、SDK 型、Windows release ビルド、資産、同梱画像ランタイム |
| `npm run test:native` | 成功。media-info 2件、media-keys 2件。実際の再生や音量は変更しない |
| `npm run test:smoke` | 成功。継続スナップショット、存在しない対象の拒否、stdin 終了後の正常終了 |
| 実 API 読み取り | GSMTC current=null / sessions=[]、Core Audio の4セッションと master の音量/ミュートが取得できた |
| `npm run validate` | Elgato 公式スキーマ取得を許可した状態で成功。10アクションと custom layout |
| `streamdeck pack ./dev.n7s.media-controls.sdPlugin --no-file-list` | 成功。v0.3.0.0、165ファイル、展開時約21.2 MiB |
| `npm audit --json` | 成功。検出0件 |
| `cargo fmt` / `git diff --check` | フォーマット・空白検査を実施 |

画像テストでは縦横比と余白の画素値を検査しました。HTTP は実 loopback 接続で認証/形式/フレーム配送/ACK を検査しました。MV3 は worker を再生成する模擬環境、ページ処理は模擬 DOM、SDK 操作対象は SDK の接続境界を模擬したテストです。これらを実 Chrome や物理デバイスの検証とは数えていません。

## 7. 未検証・未実装

**未検証**：物理 Stream Deck / +、実 Chrome 拡張を通した実サイトでのメディア再生、再生中の実 GSMTC プロパティ/画像/通知、成功する transport / SendInput / Core Audio 変更、長時間負荷、スリープ復帰、音声デバイス切替。今回の API smoke 中には GSMTC の再生セッションがありませんでした。master 音量・ミュートや実アプリの再生状態はテストのために変更していません。

**未実装**：Core Audio の native volume callback（1秒ポーリングで代替）、全出力デバイスのミキサー、shuffle/repeat/rate 変更 UI、PiP/buffer 操作 UI、Chrome のサイト固有の次/前/Web Audio handler 操作、歌詞/チャプター、対応外画像、ストア公開/署名。ブラウザの制約・DRM・資格情報は回避しません。

**制約**：公開されたタイトル/artist/album が同一でも同一録音であることは証明できません。GSMTC・Core Audio と各 Web API にまたがる原子的なスナップショットもありません。現在の照合は曖昧な補完を減らす保守的な規則です。GSMTC の選択 ID は helper 再起動で変わり、Chrome 選択 ID はページ移動で変わるため、明示選択は再選択が必要です。位置は API が公開したサンプル値を表示し、未公開の経過を推測して足しません。MAIN world の通知はページ側から偽装可能なので、信頼済みデータとは扱いません。

## 8. Windows での導入・確認

1. [README のビルド手順](README.md#windows-x64-ビルド)を実行するか、生成済み `dev.n7s.media-controls.streamDeckPlugin` を開いて導入します。
2. Stream Deck に Now Playing / + を配置し、アクション設定から再生対象と音量対象を独立して選びます。初期値は自動選択と master です。
3. Chrome を利用する場合は拡張を読み込み、専用トークンをオプションに登録して有効化し、ページを再読み込みします。
4. [README の実機受け入れ確認](README.md#実機の受け入れ確認)を実施してください。取得可能な情報・表示/操作の対応は README 冒頭の一覧表に整理しています。

この作業ではプラグインの自動インストール、既存プロファイル変更、拡張の強制導入、Git commit/push、ストア公開は行っていません。
