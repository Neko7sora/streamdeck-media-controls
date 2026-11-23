# macOS 開発版

macOS 13 以降、Stream Deck 7.1 以降、Node.js 24 以降を対象にしたソース実装です。Marketplace の公開済み Windows 版とは別で、macOS の実機受け入れ・公開審査は未完了です。

## 対応範囲

| 機能 | macOS |
|---|---|
| Music / Spotify | 起動中アプリの曲名・アーティスト・アルバム・再生状態・位置・長さ |
| 個別再生操作 | 再生／一時停止、前／次、シーク。停止は Music のみ |
| Chrome | 任意の拡張によるページ別情報・画像・再生操作。従来の認証済み HTTPS 通信を使用 |
| 音量・ミュート | システム出力のみ。アプリ別音量は非対応 |
| グローバルキーモード | 音量・ミュートのみ。再生操作にはオフにする |
| Music / Spotify のアートワーク・アプリアイコン | 未取得。欠損として扱う |
| 他のネイティブアプリ・Safari | 非対応。OS 全体の Now Playing 列挙は行わない |

アプリを自動起動しません。Music / Spotify で再生を開始してください。macOS が許可を求めたら「オートメーション」で対象アプリの操作を許可します。拒否した場合はシステム設定 → プライバシーとセキュリティ → オートメーションで確認してください。Stream Deck からの権限要求の表示・許可主体は実機確認が必要です。

操作対象は表示時のアプリ・プロセスID・曲IDです。曲の変更、アプリの終了・再起動、期限切れを検出した操作は拒否します。別アプリへのグローバル再生操作には切り替えません。取得できない情報は不明のまま表示します。

## ビルドとローカル導入

```sh
npm ci
node scripts/doctor.mjs
npm run check:fast
npm run build
node scripts/check-package.mjs
npm run link
```

Rust / Xcode のコンパイルは不要です。macOS 標準の `/usr/bin/osascript` で JavaScript for Automation を実行します。画像処理の sharp はビルドした Mac のアーキテクチャ向けに同梱されます。Mac の依存ライセンス一覧は `THIRD_PARTY_NOTICES.macos.txt` に生成し、既存の Windows 用一覧も保持します。

[GitHub Actions](../README.md#github-actions-でビルド) は Windows x64・Apple Silicon・Intel の各ビルドを1つのインストーラーへ統合します。Mac のライセンス一覧は `THIRD_PARTY_NOTICES.macos-arm64.txt` と `THIRD_PARTY_NOTICES.macos-x64.txt` として両方を同梱し、同じパッケージから各環境で画像描画を確認します。ローカルの `npm run build` は従来どおり実行環境の資産だけを生成します。`npm run pack` は従来の正式リリース手順です。macOS の正式配布は別途、実機検証と公開前の確認が必要です。

Chrome 拡張の ID を `chrome://extensions` で確認して、プラグイン設定画面の登録ボタンを押します。登録先は `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/dev.n7s.media_controls.json`、許可する拡張は入力した ID ひとつだけです。プラグインまたは Stream Deck の場所を移動した場合は再登録してください。

認証トークン・ローカル証明書・登録済みホストは `~/Library/Application Support/StreamDeckMediaControls` に保存します。ディレクトリは本人のみアクセス可能とし、秘密ファイルは `0600` に制限します。macOS 標準の OpenSSL でローカル証明書を作成します。キーチェーンへの追加・システム全体の信頼設定変更は行いません。アンインストール時は上記登録ファイルと専用ディレクトリを削除できます。

## 検証

```sh
node --test tests/macos-media.test.mjs tests/macos-registration.test.mjs
npm run test:smoke
```

自動テストは状態取得、対象変更・アプリ再起動・期限切れの拒否、範囲外シーク、拡張 ID の制限、シェルのパス引用、TLS 証明書とファイル権限を確認します。スモーク検査は読み取りと存在しない対象への操作拒否のみで、再生や音量を変更しません。

Music / Spotify の実再生・シーク、Chrome 拡張との往復、Stream Deck / Stream Deck + の表示・操作、Intel Mac は別途実機で確認してください。Windows の既存監査記録を macOS の検証証跡として扱いません。

実装の参考: [Apple の Mac Automation Scripting Guide](https://developer.apple.com/library/archive/documentation/LanguagesUtilities/Conceptual/MacAutomationScriptingGuide/)、[Chrome Native Messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging)。アプリ固有のコマンドは各アプリのスクリプティング辞書に依存します。
