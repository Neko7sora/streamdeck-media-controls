# Edge Media Deck — XENEON EDGE iCUE ウィジェット

同梱の `icue-widget` テンプレートを基にした、XENEON EDGE 向けのメディアウィジェットです。**Windows、iCUE 5.52 以降、Widget API 1.9.0 / Media Data Provider 1.1** を対象にしています。

曲名・アーティスト・アルバム・アルバムアートを表示し、前の曲／再生・一時停止／次の曲をタッチで操作できます。外観設定ではアクセント色と背景色を変更できます。画面と操作ラベルは日本語、iCUE の外観設定は日本語・英語に対応しています。

## ビルドとインストール

リポジトリのルートで実行してください。Node.js 24 以降が必要です。公式 `icuewidget-cli` は開発依存としてロックされているため、グローバルインストールは不要です。

```powershell
npm ci
npm run icue:check
npm run icue:pack
```

ルートに `icue-widget-1.0.0.icuewidget` が生成されます。出力名はウィジェットの `manifest.json` のバージョンに従います。ウィジェットは独立した成果物として 1.0.0 を使用し、Stream Deck / Chrome 拡張のリリース番号は変更しません。

1. iCUE で XENEON EDGE のウィジェット画面を開きます。
2. 利用可能なウィジェットの `+` から生成した `.icuewidget` を選択します。
3. Edge Media Deck をディスプレイへ追加します。
4. Windows のシステムメディア情報に対応するアプリで曲を再生します。
5. iCUE のウィジェット設定でアクセント色と背景色を調整します。

パッケージ生成は必要な HTML / CSS / JS、manifest、設定の翻訳、アイコン、プレビュー、ライセンスだけを一時フォルダに集め、公式 CLI で検証・生成します。デモプロバイダー、サンプル画像、テストコードは配布物に含めません。

## データと操作の範囲

iCUE が提供する `window.plugins.Mediadataprovider` を使用します。Stream Deck アプリ、プラグイン、Rust ヘルパー、Chrome 拡張の導入は不要です。ウィジェットから外部ネットワークへの通信、API キー、追加権限、ファイルアクセスは使用しません。

- 初期値を非同期の `get*(requestId)` / `asyncResponse` で読み取り、プロパティ変更通知で表示を更新します。非同期取得のタイムアウト時は現在のプロパティ値を利用し、不明な値に以前の曲情報を流用しません。
- 通知の取りこぼしに備え、表示中は20秒ごとに再取得します。画面を閉じるとタイマーと保留要求を解放し、復帰時に再接続します。
- 取得情報は文字列として表示します。画像はサイズを制限した PNG data URL のみ受け付け、未取得・読み込み失敗時は音符を表示します。
- 曲名が未取得、または該当する操作メソッドが提供されない場合、ボタンを無効にします。再生状態が未取得なら「再生状態不明」と表示します。

**再生時間、シーク、音量、アプリ名、プレーヤー選択、セッションID、操作可否の詳細は公式 Media Data Provider 1.1 の公開APIにありません。** 操作先は iCUE のプロバイダーが選ぶアクティブセッションです。表示済みの曲情報と現在のプロパティが異なる場合やプロバイダーが交換された場合は、一度表示を更新してから次の操作を受け付けます。ただし、曲情報が同じセッションの切り替えや、表示確認から操作までの間の切り替えを検出して固定することはできません。特定のアプリへ操作を固定する必要がある場合は、既存の Stream Deck プラグインを使用してください。

対応状況は各アプリが Windows / iCUE に公開する情報に依存します。このウィジェットはコミュニティ製であり、CORSAIR 公式製品ではありません。

## ブラウザーのデモと検証

`index.html?demo=1` をブラウザーで開くと、サンプル曲と動作する操作ボタンを確認できます。ローカルサーバーを使う場合は次のとおりです。

```powershell
py -m http.server 8765 --directory icue-widget
```

[ブラウザーデモ](http://localhost:8765/index.html?demo=1) は明示したときだけ有効です。通常の読み込みでは偽の曲を表示せず、実際のプロバイダーが注入されている場合はデモで上書きしません。配布パッケージにはデモ自体がありません。

```powershell
node --test tests/icue-widget.test.mjs
npm run check:fast
npm run test:chrome:install
npm run test:icue:e2e
npm run icue:pack
```

ブラウザーテストは既存の Playwright を共用します。2560×720、1280×360、640×180、320×140、280×320 の配置と操作領域、キーボード操作、遅延初期化、空のメディア、色設定、外部通信なしを確認します。スクリーンショットは `tests/.generated/icue-*.png` に出力します。Python 版の旧スモークテストは Node.js 版へ統合しました。

公式 CLI 検証やモックプロバイダーによる Chromium テストは、実際の iCUE / XENEON EDGE での受け入れ確認を代替しません。実機でのインポート、複数プレーヤー間の切り替え、タッチ操作、スリープ復帰は別途確認が必要です。

## 編集先

| ファイル | 用途 |
|---|---|
| `index.html` | 画面、iCUE 外観設定、初期化入口 |
| `manifest.json` | iCUE の対応環境と Media Provider 宣言 |
| `translation.json` | iCUE 外観設定の日本語・英語ラベル |
| `scripts/widget.js` | プロバイダー接続、非同期応答、表示、操作、終了・復帰 |
| `scripts/demo-provider.js` | ブラウザー専用のデモ |
| `styles/style.css` | 横長・コンパクト表示とフォーカス表示 |
| `resources/` | アイコン、選択プレビュー、テンプレートのデモ画像 |
| [pack-icue.mjs](../scripts/pack-icue.mjs) | 配布ファイルの収集と公式CLIでのパッケージ化 |
| [icue-widget.test.mjs](../tests/icue-widget.test.mjs) | プロバイダーの単体テスト |
| [icue-e2e.mjs](../tests/icue-e2e.mjs) | ブラウザーでの表示・操作テスト |

## トラブル対応

- インポートに失敗する場合は iCUE 5.52 以降か確認し、`npm run icue:check` と `npm run icue:pack` を再実行してください。HTML の先頭は大文字の `<!DOCTYPE html>` を維持してください。
- 曲が表示されない場合は Windows のメディアセッションに対応するアプリで再生してください。ブラウザーデモで画面だけを確認できます。
- 画像がない場合は iCUE が画像を返しているか確認してください。未取得の音符表示は正常です。
- 操作に失敗した場合は曲を再生し直し、iCUE 側のメディア情報を確認してください。ウィジェットは成功したと仮定して再生状態を変更しません。

## 公式資料

- [Widget の導入・パッケージ・インポート](https://docs.elgato.com/icue/widgets/)
- [Widget API 1.9.0 仕様](https://docs.elgato.com/icue/widgets/specification/)
- [Media Data Provider 1.1](https://docs.elgato.com/icue/widgets/references/plugins/media-data-provider/)
- [プラグインの初期化](https://docs.elgato.com/icue/widgets/references/plugins/)
- [設定の翻訳](https://docs.elgato.com/icue/widgets/references/translations/)
