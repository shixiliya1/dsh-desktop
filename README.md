# DSH Desktop

**简体中文** · [English](README.en.md) · [日本語](README.ja.md)

DeepSeek Harness 的桌面端（Electron 外壳）。自动启动本地 Harness 实例，在原生窗口中加载其 Web UI，附带托盘常驻、随机端口、日志管理、进程生命周期管理与安全加固。

本项目参考了两个社区方案的设计：

| 参考项目 | 技术 | 借鉴点 |
| --- | --- | --- |
| [OptLTD/dsh-desktop](https://github.com/OptLTD/dsh-desktop) | Wails 3 (Go) | 轻量外壳思路：检测 Node → `npx @deepseek-ai/dsh` → 窗口内打开 `127.0.0.1:3080`；npm 缓存收进应用数据目录 |
| [dataelement/dsh-desktop](https://github.com/dataelement/dsh-desktop) | Electron | 产品化思路：Harness 子进程生命周期管理、随机 loopback 端口与就绪探测、独立数据目录（profiles/sessions）、加固的 BrowserWindow |

## 特性

- **一键启动**：无需手动开终端；应用负责启动/重启/停止 Harness 子进程
- **随机端口**：每次启动在 `127.0.0.1` 上随机选端口（30000–50000），不占用固定端口，失败自动换端口重试
- **数据隔离**：Harness 的 `DSH_HOME` 指向应用数据目录（`%APPDATA%\dsh-desktop\harness`），与命令行/Web 版实例互不干扰，升级应用不丢数据
- **托盘常驻**：关闭窗口最小化到托盘；托盘菜单可显示/隐藏、重启 Harness、打开日志/数据目录、退出
- **状态页**：启动过程实时显示状态与日志（首次启动会显示 npx 下载进度）；失败可重试
- **日志管理**：子进程 stdout/stderr 追加写入 `logs/harness.log`，可一键打开
- **安全加固**：`contextIsolation` + `sandbox` + 无 `nodeIntegration`；外部链接一律交给系统浏览器，禁止导航离开 Harness 页面；子进程不继承渲染进程权限
- **单实例**：重复启动只会聚焦已有窗口

## 快速开始

要求：Node.js `>= 22.12`（运行时需要；应用本身不打包 Node）。

```bash
npm install        # 安装 electron 等依赖，并生成图标
npm start          # 启动应用
```

开发调试参数：

```bash
npm run smoke      # 冒烟测试：启动主进程 → 拉起真实 Harness → 就绪后退出（CI 可用）
npx electron . --shot shots   # 依次截取状态页与 Harness 页面到 shots/ 后退出
```

## 架构

```text
DSH Desktop (Electron Main)
├── HarnessManager
│   ├── npx -y @deepseek-ai/dsh --profile web --port <random>
│   ├── 就绪探测（轮询 http://127.0.0.1:<port>/）
│   ├── 日志 → %APPDATA%\DSH Desktop\logs\harness.log
│   └── taskkill /T /F 整树终止
├── BrowserWindow（sandbox + contextIsolation + preload）
│   ├── 启动状态页（file://，IPC 推送状态与日志）
│   └── 就绪后 → http://127.0.0.1:<random>  Harness Web UI
├── 托盘 / 应用菜单 / IPC
└── 单实例锁

Electron 用户数据目录（Windows 打包版通常为 `%APPDATA%\DSH Desktop`）/
├── harness\          # DSH_HOME：profiles / sessions / 插件等
├── logs\harness.log
└── npm-cache\        # npx 下载缓存，二次启动无需重新下载
```

## 配置

通过环境变量覆盖默认行为（启动应用前设置）：

| 环境变量 | 作用 |
| --- | --- |
| `DSH_DESKTOP_DSH_CMD` | 自定义启动命令；其中的 `__PORT__` 会被替换为实际端口。例如 `node C:\path\to\dsh\bin\dsh.js web --port __PORT__` |
| `DSH_DESKTOP_DSH_HOME` | 覆盖 Harness 数据目录（默认 `%APPDATA%\dsh-desktop\harness`）。设为你现有的 `~/.dsh` 即可与命令行实例共享数据（注意：与正在运行的实例共用同一 `DSH_HOME` 有风险，一般不建议） |

模型 API Key 等配置在 Harness 的 **Settings → Models** 里完成，与 Web 版完全一致。

## 打包发布

```bash
npm run dist:win    # Windows：NSIS 安装包 + 便携版（dist\）
npm run dist:mac    # macOS：DMG（需在 macOS 上执行）
npm run dist:dir    # 仅解包目录（dist\win-unpacked），用于快速验证
```

图标由 `scripts/generate-icon.js` 纯 Node 生成（PNG/ICO/ICNS，无第三方依赖），`postinstall` 自动执行。

## 验证

```bash
node --check src/main/*.js src/renderer/renderer.js scripts/generate-icon.js
npm run smoke       # 端到端：真实拉起 Harness 子进程并等待就绪
```

## 故障排查

- **首次启动慢**：`npx` 需要下载 `@deepseek-ai/dsh`（缓存在 `%APPDATA%\dsh-desktop\npm-cache`），状态页会实时显示进度；完成后即快。
- **启动失败**：状态页点「打开日志」查看 `logs\harness.log`；或在托盘菜单「重启 Harness」重试（会自动换端口）。
- **单实例与托盘**：应用是单实例的，重复启动只会聚焦已有窗口；关闭窗口是隐藏到托盘，请用托盘菜单「退出」真正结束。用任务管理器强杀主进程会遗留 Harness 子进程（占用随机端口），可手动清理或下次启动前用「重启 Harness」。
- **杀毒软件拦截**：`cmd.exe` 通过 `npx` 下载并执行 npm 包属于正常行为，如被拦截请添加白名单。

## 安全设计

- 渲染进程：`sandbox: true`、`contextIsolation: true`、`nodeIntegration: false`，仅暴露最小化 preload API
- 导航边界：`will-navigate` 只允许 Harness 自身 origin 与本地状态页；`setWindowOpenHandler` 一律拒绝新窗口，http(s) 转系统浏览器
- 子进程边界：Harness 子进程通过 `npx` 以独立环境启动（独立 `DSH_HOME`、独立 npm 缓存），与主进程/渲染进程隔离
- CSP：状态页声明严格 CSP（`default-src 'self'`）

`DSH_DESKTOP_DSH_CMD` 会交给系统 shell 执行，只应使用可信内容。发现安全问题时，请遵循 [安全政策](SECURITY.md)，不要在公开 Issue 中披露漏洞细节。

## Roadmap

- [ ] 模型供应商一键配置（借鉴 dataelement 的 onboarding 思路）
- [ ] 自定义 Agent 预设的导入/导出
- [ ] 自动更新（electron-updater）
- [ ] macOS 打包实测与签名/公证

## 参与贡献

提交代码或文档前，请阅读 [贡献指南](CONTRIBUTING.md) 和 [社区行为准则](CODE_OF_CONDUCT.md)。

## License

本项目采用 [MIT License](LICENSE)。DeepSeek Harness 及其依赖遵循各自上游许可证。
