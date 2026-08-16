'use strict'

const { app, BrowserWindow, ipcMain } = require('electron')
const { autoUpdater } = require('electron-updater')

let state = { phase: 'idle', version: app.getVersion(), message: '' }
let registered = false

function supported() {
  return app.isPackaged && process.platform === 'win32' && !process.env.PORTABLE_EXECUTABLE_DIR
}

function snapshot() { return { ...state, supported: supported() } }
function emit(next) {
  state = { ...state, ...next }
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('dsh:update', snapshot())
  }
}

function registerUpdateManager() {
  if (registered) return
  registered = true
  ipcMain.handle('dsh:update-state', () => snapshot())
  ipcMain.handle('dsh:check-update', () => check(true))
  ipcMain.handle('dsh:install-update', () => {
    if (state.phase === 'downloaded') autoUpdater.quitAndInstall(false, true)
  })
  if (!supported()) {
    emit({ phase: 'unsupported', message: '自动更新仅适用于 Windows 安装版。' })
    return
  }
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.on('checking-for-update', () => emit({ phase: 'checking', message: '正在检查更新…' }))
  autoUpdater.on('update-available', (info) => emit({ phase: 'downloading', version: info.version, message: '正在下载更新…' }))
  autoUpdater.on('download-progress', (progress) => emit({ phase: 'downloading', percent: Math.round(progress.percent), message: '正在下载更新…' }))
  autoUpdater.on('update-not-available', () => emit({ phase: 'idle', message: '已是最新版本。' }))
  autoUpdater.on('update-downloaded', (info) => emit({ phase: 'downloaded', version: info.version, message: '更新已下载，重启后安装。' }))
  autoUpdater.on('error', (error) => emit({ phase: 'error', message: error.message }))
  setTimeout(() => check(false), 10000)
}

async function check(manual) {
  if (!supported()) return snapshot()
  try { await autoUpdater.checkForUpdates() } catch (error) {
    emit({ phase: 'error', message: error.message })
  }
  return snapshot()
}

module.exports = { registerUpdateManager, snapshot, check }
