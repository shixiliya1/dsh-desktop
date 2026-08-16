'use strict'

// DSH Desktop 启动/状态页逻辑。
// 页面在 Harness 就绪后会被主进程切换为 Harness 的 Web UI。

const api = window.dshDesktop

const statusDot = document.getElementById('status-dot')
const statusText = document.getElementById('status-text')
const statusDetail = document.getElementById('status-detail')
const logBox = document.getElementById('log-box')
const meta = document.getElementById('meta')

const btnRestart = document.getElementById('btn-restart')
const btnLog = document.getElementById('btn-log')
const btnData = document.getElementById('btn-data')
const btnBrowser = document.getElementById('btn-browser')
const btnQuit = document.getElementById('btn-quit')
const btnUpdate = document.getElementById('btn-update')
const btnExportPresets = document.getElementById('btn-export-presets')
const btnImportPresets = document.getElementById('btn-import-presets')

const STATUS_LABEL = {
  idle: '正在初始化…',
  starting: '正在启动 Harness…',
  ready: 'Harness 已就绪',
  failed: '启动失败',
  stopped: '已停止'
}

let lastPort = null
let userScrolledUp = false

function setStatus(state) {
  statusDot.className = 'dot dot-' + (state.status || 'idle')
  statusText.textContent = STATUS_LABEL[state.status] || state.status
  if (state.status === 'ready' && state.port) lastPort = state.port

  const bits = []
  if (state.port) bits.push('端口 ' + state.port)
  if (state.attempts && state.status === 'starting') bits.push('第 ' + state.attempts + ' 次尝试')
  if (state.error) bits.push('错误：' + state.error)
  statusDetail.textContent = bits.join(' · ')

  btnRestart.disabled = state.status === 'starting'
  btnBrowser.disabled = state.status !== 'ready' && !lastPort
}

function appendLog(line) {
  const atBottom =
    logBox.scrollTop + logBox.clientHeight >= logBox.scrollHeight - 8
  logBox.textContent += line + '\n'
  const lines = logBox.textContent.split('\n')
  if (lines.length > 300) {
    logBox.textContent = lines.slice(lines.length - 300).join('\n')
  }
  if (atBottom && !userScrolledUp) {
    logBox.scrollTop = logBox.scrollHeight
  }
}

async function init() {
  const state = await api.getState()
  if (state) {
    setStatus(state)
    meta.textContent =
      'DSH_HOME: ' + (state.dshHome || '-') +
      (state.logFile ? '  ·  日志: ' + state.logFile : '')
  }
  const tail = await api.getLogTail()
  for (const line of tail) appendLog(line)
  const update = await api.getUpdateState()
  if (update) applyUpdateState(update)
}

api.onState(setStatus)
api.onLog(appendLog)

logBox.addEventListener('scroll', () => {
  userScrolledUp =
    logBox.scrollTop + logBox.clientHeight < logBox.scrollHeight - 24
})

btnRestart.addEventListener('click', () => {
  btnRestart.disabled = true
  api.restart()
})

btnLog.addEventListener('click', () => api.openLog())
btnData.addEventListener('click', () => api.openData())

btnBrowser.addEventListener('click', () => {
  const url = lastPort ? 'http://127.0.0.1:' + lastPort : null
  if (url) api.openExternal(url)
})

btnQuit.addEventListener('click', () => api.quit())
let updatePhase = 'idle'
function applyUpdateState(update) {
  updatePhase = update.phase || 'idle'
  if (update.phase === 'downloaded') {
    btnUpdate.textContent = '重启并安装 ' + update.version
    btnUpdate.disabled = false
  } else if (update.message) {
    btnUpdate.textContent = update.message
  } else if (update.phase === 'checking' || update.phase === 'downloading') {
    btnUpdate.textContent = '正在检查更新…'
    btnUpdate.disabled = true
  } else if (update.phase === 'unsupported') {
    btnUpdate.textContent = '仅安装版支持自动更新'
    btnUpdate.disabled = true
  }
}
btnUpdate.addEventListener('click', () => {
  if (updatePhase === 'downloaded') return api.installUpdate()
  return api.checkUpdate()
})
api.onUpdate(applyUpdateState)

btnExportPresets.addEventListener('click', async () => {
  const result = await api.exportPresets()
  if (result && result.message) appendLog('[预设] ' + result.message)
})

btnImportPresets.addEventListener('click', async () => {
  const result = await api.importPresets()
  if (result && result.message) appendLog('[预设] ' + result.message)
})

api.onPresetsMessage((message) => {
  if (message) appendLog('[预设] ' + message)
})

init()
