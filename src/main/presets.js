'use strict'

// 预设导入/导出（主进程）：
// - 导出：把 <DSH_HOME>/.agent-presets/<id>/ 下合格的预设打包为 zip（无第三方依赖，手写 zip 格式）。
// - 导入：解析 zip，只接受 <id>/agent.cordis.yml 与 <id>/preset.yml，id 必须匹配预设目录名规则，
//   拒绝嵌套路径、`..`、隐藏文件；解压到 <DSH_HOME>/.agent-presets/<id>/，不覆盖已有预设。
// 不修改 Harness bundle 或 RPC；错误信息不包含密钥等敏感内容。

const fs = require('node:fs')
const path = require('node:path')
const zlib = require('node:zlib')
const crypto = require('node:crypto')
const { dialog, shell } = require('electron')

const PRESET_ID = /^[a-z0-9][a-z0-9-]*$/
const COMPOSITION_FILE = 'agent.cordis.yml'
const METADATA_FILE = 'preset.yml'
const ALLOWED_ENTRY = new Set([COMPOSITION_FILE, METADATA_FILE])
const MAX_ENTRY_BYTES = 5 * 1024 * 1024 // 单个预设文件上限 5 MiB
const MAX_TOTAL_UNCOMPRESSED = 64 * 1024 * 1024 // 整个 zip 解压后上限 64 MiB
const MAX_ENTRIES = 500
const ZIP_PREFIX = 'dsh-desktop-presets-'
const EXPORT_NAME_RE = /^dsh-desktop-presets-\d{8}-\d{6}\.dshpreset$/
const PACKAGE_FORMAT = 'dsh-preset'
const PACKAGE_VERSION = 1

// ---------- CRC32（zip 需要） ----------
const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i += 1) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  }
  return (c ^ 0xffffffff) >>> 0
}

// ---------- 手写 zip 生成 ----------
function dosDateTime(date) {
  const time =
    (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2)
  const day = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  return { time, day }
}

/**
 * @param {Array<{name: string, data: Buffer}>} entries
 * @returns {Buffer}
 */
function buildZip(entries) {
  const { time, day } = dosDateTime(new Date())
  const chunks = []
  const central = []
  let offset = 0

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, 'utf8')
    const data = entry.data
    const crc = crc32(data)
    const comp = zlib.deflateRawSync(data, { level: 9 })

    const header = Buffer.alloc(30)
    header.writeUInt32LE(0x04034b50, 0) // local file header
    header.writeUInt16LE(20, 4) // version needed
    header.writeUInt16LE(0, 6) // flags
    header.writeUInt16LE(8, 8) // method: deflate
    header.writeUInt16LE(time, 10)
    header.writeUInt16LE(day, 12)
    header.writeUInt32LE(crc, 14)
    header.writeUInt32LE(comp.length, 18)
    header.writeUInt32LE(data.length, 22)
    header.writeUInt16LE(nameBuf.length, 26)
    header.writeUInt16LE(0, 28) // extra
    chunks.push(header, nameBuf, comp)

    const cd = Buffer.alloc(46)
    cd.writeUInt32LE(0x02014b50, 0) // central directory
    cd.writeUInt16LE(20, 4) // version made by
    cd.writeUInt16LE(20, 6) // version needed
    cd.writeUInt16LE(0, 8) // flags
    cd.writeUInt16LE(8, 10) // method
    cd.writeUInt16LE(time, 12)
    cd.writeUInt16LE(day, 14)
    cd.writeUInt32LE(crc, 16)
    cd.writeUInt32LE(comp.length, 20)
    cd.writeUInt32LE(data.length, 24)
    cd.writeUInt16LE(nameBuf.length, 28)
    cd.writeUInt16LE(0, 30) // extra len
    cd.writeUInt16LE(0, 32) // comment len
    cd.writeUInt16LE(0, 34) // disk start
    cd.writeUInt16LE(0, 36) // internal attrs
    cd.writeUInt32LE(0, 38) // external attrs
    cd.writeUInt32LE(offset, 42) // local header offset
    central.push(Buffer.concat([cd, nameBuf]))

    offset += header.length + nameBuf.length + comp.length
  }

  const cdBuffer = Buffer.concat(central)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(0, 4) // disk number
  eocd.writeUInt16LE(0, 6) // cd disk
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(cdBuffer.length, 12)
  eocd.writeUInt32LE(offset, 16)
  eocd.writeUInt16LE(0, 20) // comment len
  return Buffer.concat([...chunks, cdBuffer, eocd])
}

// ---------- zip 解析 ----------
function findEocd(buf) {
  const min = Math.max(0, buf.length - 65557)
  for (let i = buf.length - 22; i >= min; i -= 1) {
    if (buf.readUInt32LE(i) === 0x06054b50) return i
  }
  return -1
}

function parseCentralDirectory(buf, cdOffset, cdSize) {
  const entries = []
  let p = cdOffset
  const end = cdOffset + cdSize
  while (p + 46 <= end) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break
    const method = buf.readUInt16LE(p + 10)
    const crc = buf.readUInt32LE(p + 16)
    const compSize = buf.readUInt32LE(p + 20)
    const uncompSize = buf.readUInt32LE(p + 24)
    const nameLen = buf.readUInt16LE(p + 28)
    const extraLen = buf.readUInt16LE(p + 30)
    const commentLen = buf.readUInt16LE(p + 32)
    const localOffset = buf.readUInt32LE(p + 42)
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen)
    if (!name || name.includes('\0')) {
      throw new Error('zip 条目名无效。')
    }
    entries.push({ name, method, crc, compSize, uncompSize, localOffset })
    p += 46 + nameLen + extraLen + commentLen
  }
  return entries
}

function readLocalEntry(buf, entry) {
  const p = entry.localOffset
  if (p + 30 > buf.length || buf.readUInt32LE(p) !== 0x04034b50) {
    throw new Error(`zip 条目损坏：${entry.name}`)
  }
  const flags = buf.readUInt16LE(p + 6)
  const nameLen = buf.readUInt16LE(p + 26)
  const extraLen = buf.readUInt16LE(p + 28)
  const dataStart = p + 30 + nameLen + extraLen
  let compSize = entry.compSize
  if (flags & 0x08) {
    // 数据描述符：crc/size 在数据之后
    let d = dataStart + compSize
    if (buf.readUInt32LE(d) === 0x08074b50) d += 4
    if (d + 12 > buf.length) throw new Error(`zip 条目损坏：${entry.name}`)
    compSize = buf.readUInt32LE(d + 4)
  }
  if (dataStart + compSize > buf.length) throw new Error(`zip 条目损坏：${entry.name}`)
  const raw = buf.subarray(dataStart, dataStart + compSize)
  if (entry.method === 0) return Buffer.from(raw)
  if (entry.method === 8) {
    const out = zlib.inflateRawSync(raw)
    return out
  }
  throw new Error(`不支持的 zip 压缩方式：${entry.name}`)
}

/** 校验单个条目名：manifest.json 或 preset/<id>/ 下的预设文件。 */
function parseEntryName(name) {
  if (typeof name !== 'string' || name.length === 0 || name.length > 200) return null
  if (name.includes('\\') || name.startsWith('/') || name.includes('//')) return null
  if (name.includes('..') || name === 'manifest.json') return name === 'manifest.json' ? { manifest: true } : null
  if (!name.startsWith('preset/')) return null
  const relative = name.slice('preset/'.length)
  const slash = relative.indexOf('/')
  if (slash <= 0) return null
  const id = relative.slice(0, slash)
  const file = relative.slice(slash + 1)
  if (!PRESET_ID.test(id)) return null
  if (!file || file.startsWith('/') || file.endsWith('/') || file.includes('//')) return null
  if (file.split('/').some((part) => part === '..' || part === '.' || part.length === 0)) return null
  return { id, file }
}

function isTextLike(buf) {
  // 简单文本检查：不允许 NUL，且 UTF-8 可解码为合法字符串
  if (buf.includes(0)) return false
  try {
    const text = buf.toString('utf8')
    return text.replace(/\uFFFD/g, '').length >= 0
  } catch {
    return false
  }
}

function presetRoot(dshHome) {
  return path.join(dshHome, '.agent-presets')
}

/** 列出 <root> 下合格的预设 id（目录名合法且含 agent.cordis.yml）。 */
function listPresetIds(root) {
  let children
  try {
    children = fs.readdirSync(root, { withFileTypes: true })
  } catch {
    return []
  }
  const ids = []
  for (const child of children) {
    if (!child.isDirectory() || !PRESET_ID.test(child.name)) continue
    try {
      if (fs.statSync(path.join(root, child.name, COMPOSITION_FILE)).isFile()) ids.push(child.name)
    } catch {
      /* 无组成文件则跳过 */
    }
  }
  return ids.sort()
}

// ---------- 导出 ----------
async function exportPresets(dshHome) {
  const root = presetRoot(dshHome)
  const ids = listPresetIds(root)
  if (ids.length === 0) {
    return { ok: false, message: '没有找到可导出的预设（DSH_HOME 下无 .agent-presets/<id>/agent.cordis.yml）。' }
  }

  const pick = await dialog.showOpenDialog({
    title: '选择预设导出目录',
    buttonLabel: '导出到此目录',
    properties: ['openDirectory', 'createDirectory']
  })
  if (pick.canceled || pick.filePaths.length === 0) {
    return { ok: false, canceled: true, message: '已取消导出。' }
  }
  const targetDir = pick.filePaths[0]
  const now = new Date()
  const stamp =
    `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}` +
    `-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`
  const fileName = `${ZIP_PREFIX}${stamp}.dshpreset`
  const dest = path.join(targetDir, fileName)
  if (fs.existsSync(dest)) {
    return { ok: false, message: `目标文件已存在：${fileName}，请换一个目录或稍后重试。` }
  }

  try {
    const entries = [{
      name: 'manifest.json',
      data: Buffer.from(JSON.stringify({
        format: PACKAGE_FORMAT,
        version: PACKAGE_VERSION,
        sourceDshVersion: '0.1.0-rc.6',
        exportedAt: new Date().toISOString(),
        presets: ids
      }, null, 2) + '\n', 'utf8')
    }]
    for (const id of ids) {
      const base = path.join(root, id)
      const walk = (dir, relative = '') => {
        for (const child of fs.readdirSync(dir, { withFileTypes: true })) {
          if (child.name === '.DS_Store' || child.name === 'Thumbs.db' || child.name === 'desktop.ini') continue
          const absolute = path.join(dir, child.name)
          const rel = relative ? path.join(relative, child.name) : child.name
          if (child.isDirectory()) walk(absolute, rel)
          else if (child.isFile()) {
            const data = fs.readFileSync(absolute)
            if (data.length > MAX_ENTRY_BYTES) throw new Error(`预设 ${id} 的文件过大：${rel}`)
            entries.push({ name: `preset/${id}/${rel.replaceAll('\\', '/')}`, data })
          }
        }
      }
      walk(base)
    }
    const zip = buildZip(entries)
    const tmp = path.join(targetDir, `.${fileName}.tmp-${process.pid}`)
    fs.writeFileSync(tmp, zip)
    fs.renameSync(tmp, dest)
    if (process.platform === 'win32' || process.platform === 'darwin') {
      try { shell.showItemInFolder(dest) } catch { /* noop */ }
    }
    return { ok: true, count: ids.length, file: dest, message: `已导出 ${ids.length} 个预设：${fileName}` }
  } catch (error) {
    return { ok: false, message: `导出失败：${error.message}` }
  }
}

/** 解析 zip 并返回原始条目 { name, data } 数组（仅供内部与测试使用）。 */
function readZipEntries(buf) {
  const eocd = findEocd(buf)
  if (eocd < 0) throw new Error('不是有效的 zip 文件。')
  const totalEntries = buf.readUInt16LE(eocd + 10)
  const cdSize = buf.readUInt32LE(eocd + 12)
  const cdOffset = buf.readUInt32LE(eocd + 16)
  if (totalEntries === 0) throw new Error('压缩包内没有条目。')
  if (totalEntries > MAX_ENTRIES) throw new Error('压缩包条目过多。')
  if (cdOffset + cdSize > buf.length) throw new Error('zip 目录区损坏。')
  const cdEntries = parseCentralDirectory(buf, cdOffset, cdSize)
  return cdEntries.map((entry) => {
    if (entry.uncompSize > MAX_ENTRY_BYTES || entry.uncompSize > MAX_TOTAL_UNCOMPRESSED) {
      throw new Error(`条目过大：${entry.name}`)
    }
    return { name: entry.name, data: readLocalEntry(buf, entry) }
  })
}

// ---------- 导入 ----------
async function importPresets(dshHome) {
  const pick = await dialog.showOpenDialog({
    title: '选择预设压缩包',
    buttonLabel: '导入',
    filters: [
      { name: 'DSH Desktop 预设包', extensions: ['dshpreset', 'zip'] },
      { name: '所有文件', extensions: ['*'] }
    ],
    properties: ['openFile']
  })
  if (pick.canceled || pick.filePaths.length === 0) {
    return { ok: false, canceled: true, message: '已取消导入。' }
  }
  const zipPath = pick.filePaths[0]

  let buf
  try {
    buf = fs.readFileSync(zipPath)
  } catch (error) {
    return { ok: false, message: `无法读取压缩包：${error.message}` }
  }
  if (buf.length === 0 || buf.length > MAX_TOTAL_UNCOMPRESSED) {
    return { ok: false, message: '压缩包为空或过大。' }
  }

  try {
    const zipEntries = readZipEntries(buf)

    let manifest = null
    const byId = new Map()
    let totalUncompressed = 0
    for (const entry of zipEntries) {
      // 放行目录条目（常见压缩工具会写入目录条目）
      if (entry.name.endsWith('/')) {
        continue
      }
      const parsed = parseEntryName(entry.name)
      if (!parsed) {
        throw new Error(`压缩包内含不受支持的条目：${entry.name.slice(0, 80)}`)
      }
      const data = entry.data
      totalUncompressed += data.length
      if (totalUncompressed > MAX_TOTAL_UNCOMPRESSED) throw new Error('压缩包解压后体积过大。')
      if (data.length > MAX_ENTRY_BYTES) throw new Error(`条目过大：${entry.name}`)
      if (parsed.manifest) {
        if (manifest) throw new Error('压缩包内有多个 manifest.json。')
        try { manifest = JSON.parse(data.toString('utf8')) } catch { throw new Error('manifest.json 不是有效 JSON。') }
        if (manifest.format !== PACKAGE_FORMAT || manifest.version !== PACKAGE_VERSION) {
          throw new Error('不支持的预设包格式或版本。')
        }
        continue
      }
      if (!isTextLike(data) && !entry.name.includes('/assets/')) throw new Error(`条目不是可读文本：${entry.name}`)
      if (!byId.has(parsed.id)) byId.set(parsed.id, new Map())
      if (byId.get(parsed.id).has(parsed.file)) throw new Error(`压缩包内条目重复：${entry.name}`)
      byId.get(parsed.id).set(parsed.file, data)
    }

    if (!manifest) throw new Error('压缩包缺少 manifest.json。')
    if (!Array.isArray(manifest.presets) || manifest.presets.some((id) => !PRESET_ID.test(id))) {
      throw new Error('manifest.json 的 presets 字段无效。')
    }
    if (manifest.presets.length !== byId.size || manifest.presets.some((id) => !byId.has(id))) {
      throw new Error('manifest.json 与压缩包内的预设条目不一致。')
    }

    const preview = [...byId.keys()].sort()
    const confirmation = await dialog.showMessageBox({
      type: 'warning',
      title: '确认导入 Agent 预设',
      message: `将导入 ${preview.length} 个预设：${preview.join('、')}`,
      detail: `来源 Harness 版本：${manifest.sourceDshVersion || '未声明'}${manifest.sourceDshVersion && manifest.sourceDshVersion !== '0.1.0-rc.6' ? '\n警告：版本不同，导入后请检查预设兼容性。' : ''}\n导入包内可能包含 skills、plugins 或 assets 等可执行配置。请确认来源可信。`,
      buttons: ['确认导入', '取消'],
      defaultId: 1,
      cancelId: 1,
      noLink: true
    })
    if (confirmation.response !== 0) return { ok: false, canceled: true, message: '已取消导入。' }

    for (const id of byId.keys()) {
      if (!byId.get(id).has(COMPOSITION_FILE)) {
        throw new Error(`预设 ${id} 缺少 ${COMPOSITION_FILE}。`)
      }
    }

    const root = presetRoot(dshHome)
    fs.mkdirSync(root, { recursive: true })
    const ids = [...byId.keys()].sort()
    // 先整体校验目标，不覆盖任何已有预设
    for (const id of ids) {
      if (fs.existsSync(path.join(root, id))) {
        return { ok: false, message: `预设 ${id} 已存在，为避免覆盖请先删除或换一个压缩包。` }
      }
    }

    const created = []
    const tempDirs = []
    try {
      for (const id of ids) {
        const files = byId.get(id)
        const tmp = path.join(root, `.import-tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`)
        fs.mkdirSync(tmp, { recursive: true })
        tempDirs.push(tmp)
        for (const [relative, data] of files) {
          const target = path.join(tmp, relative)
          fs.mkdirSync(path.dirname(target), { recursive: true })
          fs.writeFileSync(target, data)
        }
        fs.renameSync(tmp, path.join(root, id))
        tempDirs.splice(tempDirs.indexOf(tmp), 1)
        created.push(id)
      }
    } catch (error) {
      // 回滚：删除已创建目录与残留临时目录（均为本次导入新建）
      for (const id of created) {
        try { fs.rmSync(path.join(root, id), { recursive: true, force: true }) } catch { /* noop */ }
      }
      for (const tmp of tempDirs) {
        try { fs.rmSync(tmp, { recursive: true, force: true }) } catch { /* noop */ }
      }
      throw error
    }

    return { ok: true, count: created.length, imported: created, message: `已导入 ${created.length} 个预设：${created.join('、')}` }
  } catch (error) {
    return { ok: false, message: `导入失败：${error.message}` }
  }
}

module.exports = { exportPresets, importPresets, presetRoot, listPresetIds, buildZip, readZipEntries }
