## DSH Desktop v0.1.0

DeepSeek Harness 桌面端（Electron 外壳）。自动启动本地 Harness 实例，在原生窗口中加载其 Web UI。

### 功能

- 一键启动：应用负责 Harness 子进程的启动 / 重启 / 停止，无需手动开终端
- 随机 loopback 端口（30000–50000），失败自动换端口重试
- 独立数据目录（`%APPDATA%\dsh-desktop\harness`），与命令行 / Web 实例互不干扰
- 托盘常驻：关窗隐藏到托盘，托盘菜单可重启 Harness、打开日志 / 数据目录、退出
- 启动状态页：实时显示启动状态与日志（含 npx 下载进度）
- 安全加固：sandbox + contextIsolation、导航边界、外部链接交给系统浏览器
- 单实例锁，重复启动聚焦已有窗口

### 安装包

- `dsh-desktop-win-setup-x64.exe` — NSIS 安装版（推荐）
- `dsh-desktop-win-portable-x64.exe` — 便携版，解压即用

### 要求

- Windows x64
- Node.js >= 22.12（首次启动时应用会自动通过 npx 下载 DeepSeek Harness）
