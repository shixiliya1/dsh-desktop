'use strict'

// DSH Desktop — Electron 主进程。
// 职责：窗口/托盘/菜单、IPC、安全边界，以及 Harness 子进程生命周期编排。

const {
  app,
  BrowserWindow,
  Tray,
  Menu,
  ipcMain,
  shell,
  nativeImage,
  dialog
} = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const { HarnessManager } = require('./harness')
const { registerUpdateManager, check: checkForUpdates } = require('./updater')
const { exportPresets, importPresets, presetRoot } = require('./presets')

const SMOKE = process.argv.includes('--smoke')
const SMOKE_TIMEOUT_MS = 5 * 60 * 1000
// --shot <dir>：开发调试用——依次截取状态页与 Harness 页面后退出
const SHOT_DIR = (() => {
  const i = process.argv.indexOf('--shot')
  return i >= 0 ? process.argv[i + 1] : null
})()

let win = null
let tray = null
let manager = null
let quitting = false

// ---------- 单实例锁 ----------
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore()
      win.show()
      win.focus()
    }
  })

  app
    .whenReady()
    .then(main)
    .catch((error) => {
      console.error('[dsh-desktop] startup failed:', error)
      app.exit(1)
    })
}

function harnessOrigin() {
  const state = manager && manager.getState()
  return state && state.port ? `http://127.0.0.1:${state.port}` : null
}

function iconPath() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'icon.png')
    : path.join(__dirname, '..', '..', 'build', 'icon.png')
}

async function main() {
  registerUpdateManager()
  manager = new HarnessManager({
    userDataDir: app.getPath('userData'),
    onState: broadcastState,
    onLog: broadcastLog
  })

  if (!SMOKE) {
    createWindow()
    createTray()
    createMenu()
  }

  let result
  if (SMOKE) {
    const race = await Promise.race([
      manager.start(),
      new Promise((resolve) => setTimeout(() => resolve({ ok: false, timeout: true }), SMOKE_TIMEOUT_MS))
    ])
    result = race
    if (!result.ok) {
      await manager.stop()
      console.error('[smoke] harness 未就绪：')
      console.error(manager.logTail(60).join('\n'))
      app.exit(1)
      return
    }
    console.log(`[smoke] OK: harness ready at http://127.0.0.1:${result.port}`)
    await manager.stop()
    app.exit(0)
    return
  }

  result = await manager.start()
  if (SHOT_DIR) {
    // 先截状态页（file://），再加载 Harness 页面并截图
    await shot('status.png')
    if (result.ok) loadHarness()
    await new Promise((r) => setTimeout(r, 6000))
    await shot('harness.png')
    quitting = true
    await manager.stop()
    app.exit(0)
    return
  }
  if (result.ok) loadHarness()
}

// ---------- 截图（--shot 调试模式） ----------
async function shot(name) {
  if (!win || win.isDestroyed()) return
  try {
    const outDir = path.resolve(SHOT_DIR)
    fs.mkdirSync(outDir, { recursive: true })
    const image = await win.webContents.capturePage()
    fs.writeFileSync(path.join(outDir, name), image.toPNG())
    console.log(`[shot] saved ${name} (url=${win.webContents.getURL()})`)
  } catch (error) {
    console.error(`[shot] failed ${name}:`, error)
  }
}

// ---------- 状态与日志广播 ----------
function broadcastState(state) {
  if (win && !win.isDestroyed()) win.webContents.send('dsh:state', state)
  if (state.status === 'ready') loadHarness()
}

function broadcastLog(line) {
  if (win && !win.isDestroyed()) win.webContents.send('dsh:log', line)
}

function broadcastPresetsMessage(message) {
  if (win && !win.isDestroyed()) win.webContents.send('dsh:presets-message', message)
}

/** 执行预设操作并返回结果；菜单入口额外弹原生结果框。 */
async function runPresetAction(action) {
  if (!manager) return { ok: false, message: '应用尚未初始化。' }
  const result =
    action === 'export'
      ? await exportPresets(manager.dshHome)
      : await importPresets(manager.dshHome)
  broadcastPresetsMessage(result.message || '')
  return result
}

async function presetMenuAction(action) {
  const result = await runPresetAction(action)
  if (!result.canceled) {
    const parent = win && !win.isDestroyed() ? win : undefined
    await dialog.showMessageBox(parent, {
      type: result.ok ? 'info' : 'warning',
      title: result.ok ? '预设导入/导出' : '预设操作未完成',
      message: result.message
    })
  }
}

function loadHarness() {
  if (!win || win.isDestroyed()) return
  const origin = harnessOrigin()
  if (!origin) return
  if (win.webContents.getURL().startsWith(origin)) return
  win.loadURL(origin)
}

// ---------- 窗口 ----------
function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 960,
    minHeight: 620,
    show: false,
    backgroundColor: '#0b1020',
    title: 'DSH Desktop',
    icon: iconPath(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    }
  })

  win.once('ready-to-show', () => win.show())

  // 新窗口一律拒绝；http(s) 交给系统浏览器
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })

  // 阻止导航离开 Harness 自身页面；外部链接交给系统浏览器
  win.webContents.on('will-navigate', (event, url) => {
    const origin = harnessOrigin()
    const isOwn = url.startsWith('file://') || (origin && url.startsWith(origin))
    if (!isOwn) {
      event.preventDefault()
      if (/^https?:/i.test(url)) shell.openExternal(url)
    }
  })

  // 关闭窗口 = 隐藏到托盘（托盘菜单退出才是真正退出）
  win.on('close', (event) => {
    if (!quitting && !SMOKE) {
      event.preventDefault()
      win.hide()
    }
  })

  win.on('closed', () => {
    win = null
  })

  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'))
}

// ---------- 托盘 ----------
function createTray() {
  let image = nativeImage.createFromPath(iconPath())
  if (!image.isEmpty()) image = image.resize({ width: 16, height: 16 })
  tray = new Tray(image)
  tray.setToolTip('DSH Desktop')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: '显示 / 隐藏', click: toggleWindow },
      { type: 'separator' },
      {
        label: '重启 Harness',
        click: () => manager && manager.restart()
      },
      {
        label: '打开日志文件夹',
        click: () => manager && shell.openPath(manager.logDir)
      },
      {
        label: '打开数据目录',
        click: () => manager && shell.openPath(manager.dshHome)
      },
      {
        label: '打开预设目录',
        click: () => manager && shell.openPath(presetRoot(manager.dshHome))
      },
      { type: 'separator' },
      {
        label: '导出预设…',
        click: () => presetMenuAction('export')
      },
      {
        label: '导入预设…',
        click: () => presetMenuAction('import')
      },
      { type: 'separator' },
      {
        label: '退出',
        click: () => {
          quitting = true
          app.quit()
        }
      }
    ])
  )
  tray.on('double-click', toggleWindow)
}

function toggleWindow() {
  if (!win || win.isDestroyed()) return
  if (win.isVisible()) {
    win.hide()
  } else {
    win.show()
    win.focus()
  }
}

// ---------- 应用菜单 ----------
function createMenu() {
  const template = [
    {
      label: 'DSH Desktop',
      submenu: [
        {
          label: '重启 Harness',
          accelerator: 'CmdOrCtrl+Shift+R',
          click: () => manager && manager.restart()
        },
        {
          label: '检查更新',
          click: () => checkForUpdates(true)
        },
        { type: 'separator' },
        { label: '打开日志文件夹', click: () => manager && shell.openPath(manager.logDir) },
        { label: '打开数据目录', click: () => manager && shell.openPath(manager.dshHome) },
        { label: '打开预设目录', click: () => manager && shell.openPath(presetRoot(manager.dshHome)) },
        { type: 'separator' },
        { label: '导出预设…', click: () => presetMenuAction('export') },
        { label: '导入预设…', click: () => presetMenuAction('import') },
        { type: 'separator' },
        { role: 'quit', label: '退出' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload', label: '重新加载' },
        { role: 'toggleDevTools', label: '开发者工具' },
        { type: 'separator' },
        { role: 'resetZoom', label: '实际大小' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '全屏' }
      ]
    }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

// ---------- IPC ----------
ipcMain.handle('dsh:get-state', () => (manager ? manager.getState() : null))
ipcMain.handle('dsh:get-log-tail', () => (manager ? manager.logTail(200) : []))
ipcMain.handle('dsh:restart', () => (manager ? manager.restart() : null))
ipcMain.handle('dsh:quit', () => {
  quitting = true
  app.quit()
})
ipcMain.handle('dsh:open-log', () => (manager ? shell.openPath(manager.logDir) : ''))
ipcMain.handle('dsh:open-data', () => (manager ? shell.openPath(manager.dshHome) : ''))
ipcMain.handle('dsh:open-presets', () => (manager ? shell.openPath(presetRoot(manager.dshHome)) : ''))
ipcMain.handle('dsh:export-presets', () => runPresetAction('export'))
ipcMain.handle('dsh:import-presets', () => runPresetAction('import'))
ipcMain.handle('dsh:open-external', (_event, url) => {
  if (/^https?:/i.test(String(url))) shell.openExternal(String(url))
})

// ---------- 退出清理 ----------
app.on('before-quit', () => {
  quitting = true
  if (manager) manager.stop()
})

app.on('window-all-closed', () => {
  // 关闭窗口即隐藏，这里只在真正退出时触发
  if (quitting) app.quit()
})

app.on('activate', () => {
  if (win && !win.isDestroyed()) {
    win.show()
    win.focus()
  }
})
