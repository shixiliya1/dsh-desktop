'use strict'

// 纯 Node 图标生成器（无第三方依赖）：
// 用 SDF + 超采样绘制渐变圆角方块 + “>_” 终端提示符图形，
// 输出 build/icon.png (512)、build/icon.ico（16/32/48 BMP + 256 PNG）、
// build/icon.icns（128/256/512/1024 PNG）。

const fs = require('node:fs')
const path = require('node:path')
const zlib = require('node:zlib')

// ---------- 基础绘制 ----------

function insideRoundedRect(px, py, S) {
  const r = S * 0.21
  const cx = Math.min(Math.max(px, r), S - r)
  const cy = Math.min(Math.max(py, r), S - r)
  return (px - cx) * (px - cx) + (py - cy) * (py - cy) <= r * r
}

function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax
  const dy = by - ay
  const len2 = dx * dx + dy * dy
  let t = len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2
  t = Math.max(0, Math.min(1, t))
  const qx = ax + t * dx
  const qy = ay + t * dy
  return Math.hypot(px - qx, py - qy)
}

function glyphDistance(px, py, S) {
  const u = (v) => v * S
  // “>” 两段折线
  const d1 = segDist(px, py, u(0.30), u(0.40), u(0.45), u(0.50))
  const d2 = segDist(px, py, u(0.45), u(0.50), u(0.30), u(0.60))
  // “_” 下划线
  const d3 = segDist(px, py, u(0.56), u(0.60), u(0.70), u(0.60))
  return Math.min(d1, d2, d3)
}

/** 返回 RGBA Buffer（S×S）。 */
function drawIcon(S) {
  const rgba = Buffer.alloc(S * S * 4)
  const thickness = S * 0.115
  const samples = 2
  const inv = 1 / (samples * samples)
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      let cov = 0
      let glyph = 0
      for (let sy = 0; sy < samples; sy++) {
        for (let sx = 0; sx < samples; sx++) {
          const px = x + (sx + 0.5) / samples
          const py = y + (sy + 0.5) / samples
          if (!insideRoundedRect(px, py, S)) continue
          cov++
          if (glyphDistance(px, py, S) <= thickness / 2) glyph++
        }
      }
      const covF = cov * inv
      const glyphF = glyph * inv
      const gy = y / S
      // 垂直渐变 #86A0FF → #3347C4，顶部轻微提亮
      const baseR = 134 + (51 - 134) * gy
      const baseG = 160 + (71 - 160) * gy
      const baseB = 255 + (196 - 255) * gy
      const glow = Math.max(0, 1 - gy * 3)
      let r = baseR + glow * 18
      let g = baseG + glow * 22
      let b = baseB + glow * 30
      // 白色字形混合
      r = r + (255 - r) * glyphF
      g = g + (255 - g) * glyphF
      b = b + (255 - b) * glyphF
      const idx = (y * S + x) * 4
      rgba[idx] = Math.round(Math.min(255, Math.max(0, r)))
      rgba[idx + 1] = Math.round(Math.min(255, Math.max(0, g)))
      rgba[idx + 2] = Math.round(Math.min(255, Math.max(0, b)))
      rgba[idx + 3] = Math.round(covF * 255)
    }
  }
  return rgba
}

// ---------- PNG ----------

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function pngChunk(type, data) {
  const out = Buffer.alloc(12 + data.length)
  out.writeUInt32BE(data.length, 0)
  out.write(type, 4, 4, 'ascii')
  data.copy(out, 8)
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length)
  return out
}

function encodePNG(width, height, rgba) {
  const stride = width * 4
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0 // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0))
  ])
}

// ---------- ICO ----------

/** 32bpp BGRA + AND 掩码的 BMP 条目（bottom-up）。 */
function encodeBMPEntry(width, height, rgba) {
  const header = Buffer.alloc(40)
  header.writeUInt32LE(40, 0)
  header.writeInt32LE(width, 4)
  header.writeInt32LE(height * 2, 8) // XOR + AND
  header.writeUInt16LE(1, 12)
  header.writeUInt16LE(32, 14)
  header.writeUInt32LE(width * height * 4, 20)
  const xor = Buffer.alloc(width * height * 4)
  for (let y = 0; y < height; y++) {
    const srcRow = (height - 1 - y) * width * 4
    const dstRow = y * width * 4
    for (let x = 0; x < width; x++) {
      const si = srcRow + x * 4
      const di = dstRow + x * 4
      xor[di] = rgba[si + 2]
      xor[di + 1] = rgba[si + 1]
      xor[di + 2] = rgba[si]
      xor[di + 3] = rgba[si + 3]
    }
  }
  const andStride = Math.ceil(width / 32) * 4
  const andMask = Buffer.alloc(andStride * height) // 全 0 = 不透明
  return Buffer.concat([header, xor, andMask])
}

function encodeICO(entries) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2) // type: icon
  header.writeUInt16LE(entries.length, 4)
  const dir = []
  let offset = 6 + 16 * entries.length
  for (const e of entries) {
    const entry = Buffer.alloc(16)
    entry[0] = e.width === 256 ? 0 : e.width
    entry[1] = e.height === 256 ? 0 : e.height
    entry[2] = 0
    entry[3] = 0
    entry.writeUInt16LE(1, 4) // planes
    entry.writeUInt16LE(32, 6) // bpp
    entry.writeUInt32LE(e.data.length, 8)
    entry.writeUInt32LE(offset, 12)
    dir.push(entry)
    offset += e.data.length
  }
  return Buffer.concat([header, ...dir, ...entries.map((e) => e.data)])
}

// ---------- ICNS ----------

function encodeICNS(pngs) {
  const entries = pngs.map(({ fourcc, data }) => {
    const head = Buffer.alloc(8)
    head.write(fourcc, 0, 4, 'ascii')
    head.writeUInt32BE(data.length + 8, 4)
    return Buffer.concat([head, data])
  })
  const body = Buffer.concat(entries)
  const header = Buffer.alloc(8)
  header.write('icns', 0, 4, 'ascii')
  header.writeUInt32BE(body.length + 8, 4)
  return Buffer.concat([header, body])
}

// ---------- 主流程 ----------

function main() {
  const outDir = path.join(__dirname, '..', 'build')
  fs.mkdirSync(outDir, { recursive: true })

  console.log('drawing icon.png (512)…')
  const png512 = encodePNG(512, 512, drawIcon(512))
  fs.writeFileSync(path.join(outDir, 'icon.png'), png512)

  console.log('drawing icon.ico (16/32/48 BMP + 256 PNG)…')
  const icoEntries = []
  for (const size of [16, 32, 48]) {
    icoEntries.push({
      width: size,
      height: size,
      data: encodeBMPEntry(size, size, drawIcon(size))
    })
  }
  icoEntries.push({ width: 256, height: 256, data: encodePNG(256, 256, drawIcon(256)) })
  fs.writeFileSync(path.join(outDir, 'icon.ico'), encodeICO(icoEntries))

  console.log('drawing icon.icns (128/256/512/1024 PNG)…')
  const icns = encodeICNS([
    { fourcc: 'ic07', data: encodePNG(128, 128, drawIcon(128)) },
    { fourcc: 'ic08', data: encodePNG(256, 256, drawIcon(256)) },
    { fourcc: 'ic09', data: encodePNG(512, 512, drawIcon(512)) },
    { fourcc: 'ic10', data: encodePNG(1024, 1024, drawIcon(1024)) }
  ])
  fs.writeFileSync(path.join(outDir, 'icon.icns'), icns)

  console.log('done:')
  for (const name of ['icon.png', 'icon.ico', 'icon.icns']) {
    const file = path.join(outDir, name)
    console.log(`  ${name}  ${fs.statSync(file).size} bytes`)
  }
}

main()
