// Gera build/icon.png (512x512) sem dependências externas: quadrado arredondado azul
// com uma vitrine/loja estilizada em branco. O electron-builder converte para .ico.
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'

const SIZE = 512
const px = new Uint8Array(SIZE * SIZE * 4)

const lerp = (a, b, t) => Math.round(a + (b - a) * t)
const top = [59, 130, 246] // #3b82f6
const bottom = [29, 78, 216] // #1d4ed8

function insideRoundedRect(x, y, x0, y0, x1, y1, r) {
  const cx = Math.min(Math.max(x, x0 + r), x1 - r)
  const cy = Math.min(Math.max(y, y0 + r), y1 - r)
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r
}

// Supersampling 4x4 para bordas suaves
function coverage(test, x, y) {
  let hits = 0
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) if (test(x + (i + 0.5) / 4, y + (j + 0.5) / 4)) hits++
  return hits / 16
}

const bg = (x, y) => insideRoundedRect(x, y, 16, 16, 496, 496, 110)
const shapes = [
  // toldo
  (x, y) => insideRoundedRect(x, y, 104, 120, 408, 200, 24),
  // corpo da loja
  (x, y) => x >= 136 && x <= 376 && y >= 200 && y <= 392,
  // base
  (x, y) => insideRoundedRect(x, y, 112, 380, 400, 408, 14)
]
// recortes (porta e vitrine) e listras do toldo
const holes = [
  (x, y) => insideRoundedRect(x, y, 168, 236, 240, 392, 10),
  (x, y) => insideRoundedRect(x, y, 268, 236, 344, 316, 10),
  (x, y) => y >= 120 && y <= 200 && [180, 256, 332].some((cx) => Math.abs(x - cx) <= 5)
]

for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    const i = (y * SIZE + x) * 4
    const a = coverage(bg, x, y)
    if (a === 0) continue
    const t = y / SIZE
    let r = lerp(top[0], bottom[0], t)
    let g = lerp(top[1], bottom[1], t)
    let b = lerp(top[2], bottom[2], t)
    const white = coverage((sx, sy) => shapes.some((s) => s(sx, sy)) && !holes.some((h) => h(sx, sy)), x, y)
    r = lerp(r, 255, white)
    g = lerp(g, 255, white)
    b = lerp(b, 255, white)
    px[i] = r
    px[i + 1] = g
    px[i + 2] = b
    px[i + 3] = Math.round(a * 255)
  }
}

function crc32(buf) {
  let c
  const table = []
  for (let n = 0; n < 256; n++) {
    c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  let crc = 0xffffffff
  for (const byte of buf) crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}

const raw = Buffer.alloc((SIZE * 4 + 1) * SIZE)
for (let y = 0; y < SIZE; y++) {
  raw[y * (SIZE * 4 + 1)] = 0
  Buffer.from(px.buffer, y * SIZE * 4, SIZE * 4).copy(raw, y * (SIZE * 4 + 1) + 1)
}
const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(SIZE, 0)
ihdr.writeUInt32BE(SIZE, 4)
ihdr[8] = 8
ihdr[9] = 6
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0))
])

const out = path.resolve('build', 'icon.png')
fs.mkdirSync(path.dirname(out), { recursive: true })
fs.writeFileSync(out, png)
console.log(`Ícone gerado: ${out}`)
