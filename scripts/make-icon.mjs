#!/usr/bin/env node
/**
 * Generates the BeatFrame Studio app icon (build/icon.png + build/icon.ico)
 * with zero dependencies: pixels are drawn analytically (rounded square with
 * the brand gradient + three equalizer bars), PNG-encoded via zlib, and the
 * ICO simply embeds PNGs (supported since Windows Vista).
 *
 * Run: node scripts/make-icon.mjs
 */
import { deflateSync } from 'zlib'
import { mkdirSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

// Brand colors (matches the UI accent gradient).
const PINK = [255, 45, 120]
const BLUE = [45, 155, 255]

// --------------------------------------------------------------------------
// Drawing
// --------------------------------------------------------------------------

/** Signed distance to a rounded rectangle centered at (0.5, 0.5). */
function sdRoundedSquare(u, v, half, radius) {
  const dx = Math.abs(u - 0.5) - (half - radius)
  const dy = Math.abs(v - 0.5) - (half - radius)
  const ax = Math.max(dx, 0)
  const ay = Math.max(dy, 0)
  return Math.hypot(ax, ay) + Math.min(Math.max(dx, dy), 0) - radius
}

/** Signed distance to a vertical capsule (rounded bar). */
function sdBar(u, v, cx, halfWidth, halfHeight) {
  const dx = Math.abs(u - cx) - halfWidth
  const dy = Math.abs(v - 0.5) - (halfHeight - halfWidth)
  const ax = Math.max(dx, 0)
  const ay = Math.max(dy, 0)
  return Math.hypot(ax, ay) + Math.min(Math.max(dx, dy), 0) - halfWidth
}

const BARS = [
  { cx: 0.3, hh: 0.15 },
  { cx: 0.5, hh: 0.25 },
  { cx: 0.7, hh: 0.19 }
]

/** Render an RGBA buffer at `size` with 4x supersampling. */
function render(size) {
  const ss = 4
  const S = size * ss
  const out = Buffer.alloc(size * size * 4)
  const aaWidth = 1.5 / S

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const u = (px * ss + sx + 0.5) / S
          const v = (py * ss + sy + 0.5) / S

          const dSquare = sdRoundedSquare(u, v, 0.46, 0.115)
          const squareCov = coverage(dSquare, aaWidth)
          if (squareCov <= 0) continue

          // Diagonal gradient with a subtle vertical darkening for depth.
          const t = clamp01((u + v) / 2)
          const shade = 1 - 0.12 * v
          let cr = lerp(PINK[0], BLUE[0], t) * shade
          let cg = lerp(PINK[1], BLUE[1], t) * shade
          let cb = lerp(PINK[2], BLUE[2], t) * shade

          // Equalizer bars in white.
          let barCov = 0
          for (const bar of BARS) {
            barCov = Math.max(barCov, coverage(sdBar(u, v, bar.cx, 0.042, bar.hh), aaWidth))
          }
          cr = lerp(cr, 255, barCov)
          cg = lerp(cg, 255, barCov)
          cb = lerp(cb, 255, barCov)

          r += cr * squareCov
          g += cg * squareCov
          b += cb * squareCov
          a += 255 * squareCov
        }
      }
      const n = ss * ss
      const i = (py * size + px) * 4
      out[i] = Math.round(r / n)
      out[i + 1] = Math.round(g / n)
      out[i + 2] = Math.round(b / n)
      out[i + 3] = Math.round(a / n)
    }
  }
  return out
}

const clamp01 = (x) => Math.min(1, Math.max(0, x))
const lerp = (a, b, t) => a + (b - a) * t
/** Anti-aliased coverage from a signed distance. */
const coverage = (d, aa) => clamp01(0.5 - d / (2 * aa))

// --------------------------------------------------------------------------
// PNG encoding
// --------------------------------------------------------------------------

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
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

function encodePng(rgba, size) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type RGBA
  // scanlines with filter byte 0
  const raw = Buffer.alloc(size * (size * 4 + 1))
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4)
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ])
}

// --------------------------------------------------------------------------
// ICO container (PNG-compressed entries)
// --------------------------------------------------------------------------

function encodeIco(pngsBySize) {
  const count = pngsBySize.length
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0) // reserved
  header.writeUInt16LE(1, 2) // type: icon
  header.writeUInt16LE(count, 4)

  const entries = []
  const blobs = []
  let offset = 6 + count * 16
  for (const { size, png } of pngsBySize) {
    const e = Buffer.alloc(16)
    e[0] = size >= 256 ? 0 : size
    e[1] = size >= 256 ? 0 : size
    e[2] = 0 // palette
    e[3] = 0 // reserved
    e.writeUInt16LE(1, 4) // planes
    e.writeUInt16LE(32, 6) // bpp
    e.writeUInt32LE(png.length, 8)
    e.writeUInt32LE(offset, 12)
    entries.push(e)
    blobs.push(png)
    offset += png.length
  }
  return Buffer.concat([header, ...entries, ...blobs])
}

// --------------------------------------------------------------------------

const sizes = [256, 128, 64, 48, 32, 16]
const pngs = sizes.map((size) => ({ size, png: encodePng(render(size), size) }))

mkdirSync(join(root, 'build'), { recursive: true })
writeFileSync(join(root, 'build', 'icon.png'), pngs[0].png)
writeFileSync(join(root, 'build', 'icon.ico'), encodeIco(pngs))
console.log(`build/icon.png (${pngs[0].png.length} bytes) and build/icon.ico written`)
