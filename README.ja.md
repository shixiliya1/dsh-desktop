# DSH Desktop

[简体中文](README.md) · [English](README.en.md) · **日本語**

DSH Desktop は DeepSeek Harness 用の Electron シェルです。ローカルの Harness インスタンスを自動起動し、Web UI をネイティブウィンドウ内に表示します。システムトレイ、ランダムなループバックポート、ログ、プロセスのライフサイクル管理、安全性を高めたウィンドウ設定を備えています。

設計では、[OptLTD/dsh-desktop](https://github.com/OptLTD/dsh-desktop) の軽量な Wails ラッパーとアプリ専用 npm キャッシュ、および [dataelement/dsh-desktop](https://github.com/dataelement/dsh-desktop) の Electron プロセス管理、起動確認、データ分離、BrowserWindow の保護を参考にしています。

## 主な機能

- Harness 子プロセスの起動・再起動・停止をワンクリックで管理
- `127.0.0.1` の 30000〜50000 からランダムにポートを選択し、最大 3 回まで起動を試行
- Electron のユーザーデータディレクトリ内に `DSH_HOME`、ログ、npm キャッシュを分離
- ウィンドウ、Harness、ログ、データディレクトリ、アプリ終了を操作できるシステムトレイ
- 状態とログをリアルタイム表示するローカル起動ページ
- `sandbox: true`、`contextIsolation: true`、`nodeIntegration: false`
- 起動ページと現在のローカル Harness origin 以外への画面遷移を制限
- 単一インスタンスロック

## 必要環境とクイックスタート

Node.js `>= 22.12` が必要です。パッケージ版アプリには、`npx` が利用するシステム Node.js は含まれていません。

```bash
npm install
npm start
```

初回起動時は `npx` が `@deepseek-ai/dsh` をダウンロードするため、時間がかかる場合があります。次回以降はアプリ専用の npm キャッシュを再利用します。

## データと設定

次のデータは Electron のユーザーデータディレクトリ（Windows のパッケージ版では通常 `%APPDATA%\DSH Desktop`）に保存されます。

```text
harness/          # DSH_HOME：profiles、sessions、プラグインなど
logs/harness.log
npm-cache/        # npx ダウンロードキャッシュ
```

正確な場所はアプリまたはトレイメニューからデータ／ログフォルダーを開いて確認してください。

| 環境変数 | 用途 |
| --- | --- |
| `DSH_DESKTOP_DSH_CMD` | Harness の起動コマンドを上書きします。`__PORT__` は選択されたポートに置換されます。例：`node C:\path\to\dsh\bin\dsh.js web --port __PORT__`。値はシステムシェルで実行されるため、信頼できる内容だけを指定してください |
| `DSH_DESKTOP_DSH_HOME` | Harness のデータディレクトリを変更します。実行中の複数インスタンスで同じディレクトリを共有しないでください |

モデルの API キーは Harness の **Settings → Models** で設定します。認証情報をこのリポジトリへコミットしないでください。

## 開発と検証

```bash
node --check src/main/harness.js
node --check src/main/index.js
node --check src/main/preload.js
node --check src/renderer/renderer.js
node --check scripts/generate-icon.js
npm run smoke
```

`npm run smoke` は実際の Harness プロセスを起動し、ローカルサービスの準備完了を確認して終了します。初回は `@deepseek-ai/dsh` をダウンロードする場合があります。起動画面と Harness 画面を保存するには `npx electron . --shot shots` を実行してください。

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
- ウイルス対策ソフトが `npx` のシステムシェル実行を検知する場合があります。許可する前にパッケージ名とログを確認してください。

## セキュリティ

レンダラープロセスはサンドボックス化され、Node integration は無効です。preload が公開する IPC は起動画面に必要な操作だけに限定され、画面遷移もローカルコンテンツと現在の Harness origin に制限されています。

`DSH_DESKTOP_DSH_CMD` はシステムシェルで実行される上級者向け設定です。信頼できない入力を設定しないでください。脆弱性の報告は [SECURITY.md](SECURITY.md) に従い、公開 Issue に詳細を書かないでください。

## ロードマップ

- [ ] モデルプロバイダーのワンクリック設定
- [ ] カスタム Agent プリセットのインポート／エクスポート
- [ ] electron-updater による自動更新
- [ ] macOS パッケージ、署名、公証の実機検証

## コントリビューションとライセンス

貢献する前に [CONTRIBUTING.md](CONTRIBUTING.md) と [行動規範](CODE_OF_CONDUCT.md) を確認してください。

DSH Desktop は [MIT License](LICENSE) の下で公開しています。DeepSeek Harness とその依存関係には、それぞれのアップストリームライセンスが適用されます。
