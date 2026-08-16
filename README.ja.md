# DSH Desktop

[简体中文](README.md) · [English](README.en.md) · **日本語**

DSH Desktop は DeepSeek Harness 用の Electron シェルです。固定した `@deepseek-ai/dsh@0.1.0-rc.6` をアプリに同梱し、ローカルで起動して Web UI をネイティブウィンドウ内に表示します。システムトレイ、ランダムなループバックポート、ログ、プロセス管理、安全性を高めたウィンドウ設定を備えています。

設計では、[OptLTD/dsh-desktop](https://github.com/OptLTD/dsh-desktop) の軽量な Wails ラッパーとアプリ専用 npm キャッシュ、および [dataelement/dsh-desktop](https://github.com/dataelement/dsh-desktop) の Electron プロセス管理、起動確認、データ分離、BrowserWindow の保護を参考にしています。

## 主な機能

- Harness 子プロセスの起動・再起動・停止をワンクリックで管理
- `127.0.0.1` の 30000〜50000 からランダムにポートを選択し、最大 3 回まで起動を試行
- Electron のユーザーデータディレクトリ内に `DSH_HOME` とログを分離
- Harness の Models 設定によるモデルプロバイダー、認証情報、モデル一覧の初期設定
- カスタム Agent プリセットの安全なインポート／エクスポート
- Windows NSIS インストーラー向け GitHub Releases 自動更新
- ウィンドウ、Harness、ログ、データディレクトリ、アプリ終了を操作できるシステムトレイ
- 状態とログをリアルタイム表示するローカル起動ページ
- `sandbox: true`、`contextIsolation: true`、`nodeIntegration: false`
- 起動ページと現在のローカル Harness origin 以外への画面遷移を制限
- 単一インスタンスロック

## 必要環境とクイックスタート

開発には Node.js `>= 22.12` が必要です。パッケージ版には固定した Harness ランタイムが含まれ、実行時に `npx` でダウンロードすることはありません。

```bash
npm install
npm start
```

開発時の `npm install` で固定バージョンを取得します。実行時は Electron の Node モードからインストール済みランタイムを直接起動します。

## データと設定

次のデータは Electron のユーザーデータディレクトリ（Windows のパッケージ版では通常 `%APPDATA%\DSH Desktop`）に保存されます。

```text
harness/          # DSH_HOME：profiles、sessions、プラグイン、.agent-presets
logs/harness.log
```

正確な場所はアプリまたはトレイメニューからデータ／ログフォルダーを開いて確認してください。

| 環境変数 | 用途 |
| --- | --- |
| `DSH_DESKTOP_DSH_CMD` | Harness の起動コマンドを上書きします。`__PORT__` は選択されたポートに置換されます。例：`node C:\path\to\dsh\bin\dsh.js web --port __PORT__`。値はシステムシェルで実行されるため、信頼できる内容だけを指定してください |
| `DSH_DESKTOP_DSH_HOME` | Harness のデータディレクトリを変更します。実行中の複数インスタンスで同じディレクトリを共有しないでください |

モデルの API キーは Harness の **Settings → Models** で設定します。認証情報をこのリポジトリへコミットしないでください。

Models 画面がプロバイダー設定の入口です。プロバイダーを選択し、認証情報を保護された入力欄から登録してモデルを追加または検出してください。デスクトップ側で別のプロバイダー一覧を持たないため、Harness の設定形式と互換性があります。

カスタムプリセットは `harness/.agent-presets/` に保存されます。**プリセットをエクスポート** で `.dshpreset` パッケージを作成し、**プリセットをインポート** で内容を確認してから確定します。既存の ID は上書きされません。

## 開発と検証

```bash
node --check src/main/harness.js
node --check src/main/index.js
node --check src/main/preload.js
node --check src/renderer/renderer.js
node --check scripts/generate-icon.js
npm run smoke
```

`npm run smoke` は実際の Harness プロセスを起動し、ローカルサービスの準備完了を確認して終了します。起動画面と Harness 画面を保存するには `npx electron . --shot shots` を実行してください。

## パッケージ作成

```bash
npm run dist:win    # Windows NSIS インストーラーとポータブル版
npm run dist:mac    # macOS DMG（macOS 上で実行）
npm run dist:dir    # 簡易確認用の展開済みアプリ
```

macOS の署名、公証、実機テストは今後の対応項目です。アイコンは `postinstall` 時に `scripts/generate-icon.js` が生成します。

## トラブルシューティング

- 起動に失敗した場合は、起動画面またはトレイから `logs/harness.log` を開き、**Harness を再起動**してください。
- ウィンドウを閉じてもトレイに格納されるだけです。完全に停止するにはトレイの **終了** を使用してください。
- Electron を強制終了すると Harness プロセスが残る場合があります。必要に応じて手動で終了してください。
- ウイルス対策ソフトが Electron の子プロセス起動を検知する場合があります。許可する前に署名済みインストーラーとログを確認してください。

## セキュリティ

レンダラープロセスはサンドボックス化され、Node integration は無効です。preload が公開する IPC は起動画面に必要な操作だけに限定され、画面遷移もローカルコンテンツと現在の Harness origin に制限されています。

`DSH_DESKTOP_DSH_CMD` はシステムシェルで実行される上級者向け設定です。信頼できない入力を設定しないでください。脆弱性の報告は [SECURITY.md](SECURITY.md) に従い、公開 Issue に詳細を書かないでください。

## ロードマップ

- [x] Harness の Models 画面によるモデルプロバイダー初期設定
- [x] カスタム Agent プリセットのインポート／エクスポート
- [x] electron-updater による自動更新（Windows NSIS）
- [ ] macOS パッケージ、署名、公証の実機検証

## コントリビューションとライセンス

貢献する前に [CONTRIBUTING.md](CONTRIBUTING.md) と [行動規範](CODE_OF_CONDUCT.md) を確認してください。

DSH Desktop は [MIT License](LICENSE) の下で公開しています。DeepSeek Harness とその依存関係には、それぞれのアップストリームライセンスが適用されます。
