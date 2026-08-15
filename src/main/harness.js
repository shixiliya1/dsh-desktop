'use strict'

// HarnessManager: 负责 DeepSeek Harness 子进程的完整生命周期——
// 启动（npx 或自定义命令）、随机端口、就绪探测、日志采集、树级终止。

const { spawn, execFile } = require('node:child_process')
const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')

const PORT_MIN = 30000
const PORT_MAX = 50000
const FIRST_READY_TIMEOUT_MS = 5 * 60 * 1000 // 首次启动可能需 npx 下载 dsh
const RETRY_READY_TIMEOUT_MS = 90 * 1000 // 重试端口时缩短等待
const MAX_PORT_ATTEMPTS = 3
const POLL_INTERVAL_MS = 400
const LOG_RING_LIMIT = 300

function randomPort() {
  return crypto.randomInt(PORT_MIN, PORT_MAX + 1)
}

class HarnessManager {
  /**
   * @param {object} options
   * @param {string} options.userDataDir Electron userData 目录
   * @param {(state: object) => void} [options.onState] 状态变化回调
   * @param {(line: string) => void} [options.onLog] 日志行回调
   */
  constructor({ userDataDir, onState, onLog }) {
    this.userDataDir = userDataDir
    this.onState = onState || (() => {})
    this.onLog = onLog || (() => {})
    this.dshHome =
      process.env.DSH_DESKTOP_DSH_HOME || path.join(userDataDir, 'harness')
    this.logDir = path.join(userDataDir, 'logs')
    this.logFile = path.join(this.logDir, 'harness.log')
    this.npmCacheDir = path.join(userDataDir, 'npm-cache')
    this.state = {
      status: 'idle', // idle | starting | ready | failed | stopped
      port: null,
      pid: null,
      dshHome: this.dshHome,
      logFile: this.logFile,
      error: null,
      attempts: 0
    }
    this.child = null
    this.logStream = null
    this.ring = []
    this._stopping = false
  }

  getState() {
    return { ...this.state }
  }

  setState(patch) {
    this.state = { ...this.state, ...patch }
    this.onState(this.getState())
  }

  logLine(raw) {
    const clean = String(raw).replace(/\x1b\[[0-9;]*m/g, '').replace(/\r?\n$/, '')
    if (clean.length === 0) return
    if (this.logStream && !this.logStream.destroyed) this.logStream.write(clean + '\n')
    this.ring.push(clean)
    if (this.ring.length > LOG_RING_LIMIT) this.ring.shift()
    this.onLog(clean)
  }

  logTail(limit = 100) {
    return this.ring.slice(-limit)
  }

  ensureDirs() {
    fs.mkdirSync(this.dshHome, { recursive: true })
    fs.mkdirSync(this.logDir, { recursive: true })
    fs.mkdirSync(this.npmCacheDir, { recursive: true })
  }

  /**
   * 组装启动命令行。可通过环境变量 DSH_DESKTOP_DSH_CMD 覆盖，
   * 其中 __PORT__ 会被替换为实际端口。
   */
  commandLine(port) {
    const override = process.env.DSH_DESKTOP_DSH_CMD
    if (override && override.trim()) {
      return override.replace(/__PORT__/g, String(port))
    }
    return `npx -y @deepseek-ai/dsh --profile web --port ${port}`
  }

  spawnChild(port) {
    const commandLine = this.commandLine(port)
    const env = {
      ...process.env,
      DSH_HOME: this.dshHome,
      npm_config_cache: this.npmCacheDir
    }
    this.logLine(`[dsh-desktop] launching: ${commandLine}`)
    this.logLine(`[dsh-desktop] DSH_HOME=${this.dshHome}`)
    const child =
      process.platform === 'win32'
        ? spawn('cmd.exe', ['/d', '/s', '/c', commandLine], {
            env,
            windowsHide: true,
            stdio: ['ignore', 'pipe', 'pipe']
          })
        : spawn('/bin/sh', ['-c', commandLine], {
            env,
            stdio: ['ignore', 'pipe', 'pipe']
          })
    child.stdout.on('data', (chunk) => this.logLine(chunk.toString()))
    child.stderr.on('data', (chunk) => this.logLine(chunk.toString()))
    child.on('error', (error) => {
      this.logLine(`[dsh-desktop] child spawn error: ${error.message}`)
      this.setState({ error: error.message })
    })
    child.on('exit', (code, signal) => {
      this.logLine(`[dsh-desktop] harness exited (code=${code}, signal=${signal})`)
      if (this.child !== child) return
      this.child = null
      if (this._stopping) {
        this.setState({ status: 'stopped', pid: null })
      } else if (this.state.status === 'ready') {
        this.setState({
          status: 'failed',
          pid: null,
          error: `harness 意外退出 (code=${code}, signal=${signal})`
        })
      } else {
        // 就绪前退出：start() 的就绪探测会失败并重试，这里只记录
        this.setState({ pid: null })
      }
    })
    this.child = child
    this.setState({ pid: child.pid, error: null })
    return child
  }

  /** 探测一次端口是否已响应 HTTP。 */
  probe(port) {
    return new Promise((resolve) => {
      const req = http.get(
        { host: '127.0.0.1', port, path: '/', timeout: 2000 },
        (res) => {
          res.resume()
          resolve(true) // 任意 HTTP 响应都视为服务已就绪
        }
      )
      req.on('timeout', () => req.destroy())
      req.on('error', () => resolve(false))
    })
  }

  async waitReady(port, timeoutMs) {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      if (this._stopping) return false
      if (this.child && this.child.exitCode !== null) return false
      if (await this.probe(port)) return true
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
    }
    return false
  }

  /** 启动 Harness，失败时更换端口重试。 */
  async start() {
    this.ensureDirs()
    if (!this.logStream || this.logStream.destroyed) {
      this.logStream = fs.createWriteStream(this.logFile, { flags: 'a' })
    }
    this._stopping = false
    let attempt = 0
    while (attempt < MAX_PORT_ATTEMPTS) {
      attempt += 1
      const port = randomPort()
      this.setState({ status: 'starting', port, attempts: attempt, error: null })
      const child = this.spawnChild(port)
      const timeout = attempt === 1 ? FIRST_READY_TIMEOUT_MS : RETRY_READY_TIMEOUT_MS
      const ready = await this.waitReady(port, timeout)
      if (ready) {
        this.setState({ status: 'ready', port })
        return { ok: true, port }
      }
      this.logLine(
        `[dsh-desktop] port ${port} 未在 ${Math.round(timeout / 1000)}s 内就绪，更换端口重试`
      )
      this.killTree(child.pid)
    }
    this.setState({
      status: 'failed',
      error: `harness 尝试 ${MAX_PORT_ATTEMPTS} 次均未就绪，详见日志`
    })
    return { ok: false }
  }

  /** Windows 用 taskkill /T /F 终止整棵进程树，POSIX 用进程组。 */
  killTree(pid) {
    if (!pid) return
    if (process.platform === 'win32') {
      execFile('taskkill', ['/pid', String(pid), '/T', '/F'], () => {})
    } else {
      try {
        process.kill(-pid, 'SIGTERM')
      } catch {
        /* noop */
      }
    }
  }

  /** 停止 Harness 子进程并关闭日志流。 */
  async stop() {
    this._stopping = true
    const child = this.child
    this.child = null
    if (child) {
      this.killTree(child.pid)
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, 3000)
        child.once('exit', () => {
          clearTimeout(timer)
          resolve()
        })
      })
    }
    if (this.logStream && !this.logStream.destroyed) {
      await new Promise((resolve) => this.logStream.end(resolve))
      this.logStream = null
    }
    this.setState({ status: 'stopped', pid: null })
  }

  async restart() {
    await this.stop()
    return this.start()
  }
}

module.exports = { HarnessManager, randomPort }
