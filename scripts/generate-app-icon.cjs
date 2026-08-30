const fs = require('node:fs')
const path = require('node:path')
const zlib = require('node:zlib')
const { decodeRgbaPng } = require('./check-app-icons.cjs')

const ICON_SIZES = [16, 24, 32, 48, 64, 96, 128, 256]
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

function crc32(bytes) {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

function pngChunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii')
  const chunk = Buffer.alloc(12 + data.length)
  chunk.writeUInt32BE(data.length, 0)
  typeBytes.copy(chunk, 4)
  data.copy(chunk, 8)
  chunk.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 8 + data.length)
  return chunk
}

function encodeRgbaPng(image) {
  const { width, height, rgba } = image
  const scanlines = Buffer.alloc(height * (width * 4 + 1))
  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * (width * 4 + 1)
    scanlines[rowOffset] = 0
    rgba.copy(scanlines, rowOffset + 1, y * width * 4, (y + 1) * width * 4)
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8
  header[9] = 6
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk('IHDR', header),
    pngChunk('IDAT', zlib.deflateSync(scanlines, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

function resizeRgba(source, size) {
  const rgba = Buffer.alloc(size * size * 4)
  const scale = source.width / size
  for (let y = 0; y < size; y += 1) {
    const sourceTop = Math.floor(y * scale)
    const sourceBottom = Math.min(source.height, Math.ceil((y + 1) * scale))
    for (let x = 0; x < size; x += 1) {
      const sourceLeft = Math.floor(x * scale)
      const sourceRight = Math.min(source.width, Math.ceil((x + 1) * scale))
      let alphaTotal = 0
      let redTotal = 0
      let greenTotal = 0
      let blueTotal = 0
      let count = 0
      for (let sy = sourceTop; sy < sourceBottom; sy += 1) {
        for (let sx = sourceLeft; sx < sourceRight; sx += 1) {
          const sourceOffset = (sy * source.width + sx) * 4
          const alpha = source.rgba[sourceOffset + 3]
          alphaTotal += alpha
          redTotal += source.rgba[sourceOffset] * alpha
          greenTotal += source.rgba[sourceOffset + 1] * alpha
          blueTotal += source.rgba[sourceOffset + 2] * alpha
          count += 1
        }
      }
      const targetOffset = (y * size + x) * 4
      const alpha = Math.round(alphaTotal / count)
      rgba[targetOffset + 3] = alpha
      if (alpha > 0) {
        rgba[targetOffset] = Math.round(redTotal / alphaTotal)
        rgba[targetOffset + 1] = Math.round(greenTotal / alphaTotal)
        rgba[targetOffset + 2] = Math.round(blueTotal / alphaTotal)
      }
    }
  }
  return { width: size, height: size, rgba }
}

function buildIco(entries) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(entries.length, 4)
  const directory = Buffer.alloc(entries.length * 16)
  let imageOffset = header.length + directory.length
  const images = []
  entries.forEach(({ size, png }, index) => {
    const offset = index * 16
    directory[offset] = size === 256 ? 0 : size
    directory[offset + 1] = size === 256 ? 0 : size
    directory.writeUInt16LE(1, offset + 4)
    directory.writeUInt16LE(32, offset + 6)
    directory.writeUInt32LE(png.length, offset + 8)
    directory.writeUInt32LE(imageOffset, offset + 12)
    imageOffset += png.length
    images.push(png)
  })
  return Buffer.concat([header, directory, ...images])
}

function generateAppIcon(repoRoot = path.resolve(__dirname, '..')) {
  const sourcePath = path.join(repoRoot, 'build', 'icon.png')
  const targetPath = path.join(repoRoot, 'build', 'icon.ico')
  const source = decodeRgbaPng(fs.readFileSync(sourcePath), 'build/icon.png')
  const entries = ICON_SIZES.map((size) => ({
    size,
    png: encodeRgbaPng(resizeRgba(source, size)),
  }))
  fs.writeFileSync(targetPath, buildIco(entries))
  return { source: `${source.width}x${source.height}`, sizes: ICON_SIZES }
}

if (require.main === module) {
  const result = generateAppIcon()
  console.log(`APP ICON GENERATED png=${result.source} ico=${result.sizes.join(',')}`)
}

module.exports = { ICON_SIZES, buildIco, encodeRgbaPng, generateAppIcon, resizeRgba }
