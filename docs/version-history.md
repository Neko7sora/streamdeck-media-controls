# リリース履歴

## 1.0.0 (STABLE)

Media Controls の初回 STABLE リリースです。プラグインは [Elgato Marketplace](https://marketplace.elgato.com/product/media-controls-c3009ed3-da9b-44ea-8edb-81db01b81ecc) で無料公開中、任意の Chrome 拡張は [Chrome Web Store](https://chromewebstore.google.com/detail/stream-deck-media-metadat/iagfcpchjohmpnnlcgppdcadehinhdpa) で公開中です。Windows 11 以降（x64）、Stream Deck 7.1 以降に対応します。

- 再生／一時停止、停止、前／次の曲の操作と、再生対象の選択。
- PC全体または選択したアプリの音量・ミュート操作。
- Now Playing のアートワーク、曲名、アーティスト、アプリ／サイトアイコン、再生状態の表示。
- Stream Deck + の音量調整、シーク、再生位置・長さ・進捗表示、長押しによる再生対象の切替。
- 日本語・英語のインターフェース、日本語テキストの描画、滑らかな文字送り、アクションごとの表示カスタマイズ。
- 任意の Chrome 連携によるメディア情報の取得、対応する再生操作、接続状態と拡張バッジの表示。
- 状態更新と独立した操作経路、差分送信、画像キャッシュ、設定の変更通知。

### 導入と制限

Chrome 連携には、Chrome 111 以降、Chrome Web Store からの拡張機能のインストール、拡張機能 ID を指定したローカル連携登録、送信の有効化が必要です。ストア版の拡張 ID は `iagfcpchjohmpnnlcgppdcadehinhdpa` です。利用できる情報・操作は対象アプリやページに依存します。Chrome の前／次の曲への直接操作には対応していません。

Windows x64 のビルド・API 読み取り・自動テストの結果、実機・実サイトの確認記録、更新時の検査手順は [ガイドライン総合監査](guideline-audit.md) を参照してください。

導入・操作手順は [README](../README.md)、英語のリリースノートは [release-notes.en.txt](marketplace/release-notes.en.txt) を参照してください。

### 公開前の開発記録

製品のリリース履歴は 1.0.0 から始まります。Git 履歴や [監査記録](../AUDIT.md)、[通信測定記録](../COMMUNICATION.md) に残る 0.x.x は、公開前の開発用識別番号です。当時の測定値・検証結果は各開発時点の記録として保持します。

非公開 Rust クレートのパッケージ番号、依存ライブラリのバージョン、テスト用の固定データ、掲載素材の生成証跡は、それぞれの用途で管理します。
