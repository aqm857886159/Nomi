const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const zlib = require('node:zlib')

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
const REQUIRED_ICO_SIZES = [16, 24, 32, 48, 64, 96, 128, 256]
const MAX_TRANSPARENT_CORNER_ALPHA = 2

function paeth(left, above, upperLeft) {
  const estimate = left + above - upperLeft
  const leftDistance = Math.abs(estimate - left)
  const aboveDistance = Math.abs(estimate - above)
  const upperLeftDistance = Math.abs(estimate - upperLeft)
  if (leftDistance <= aboveDistance && leftDistance <= upperLeftDistance) return left
  return aboveDistance <= upperLeftDistance ? above : upperLeft
}

function decodeRgbaPng(bytes, label) {
  assert.ok(bytes.subarray(0, 8).equals(PNG_SIGNATURE), `${label} must be PNG`)
  let offset = 8
  let width = 0
  let height = 0
  const idat = []
  while (offset < bytes.length) {
    const length = bytes.readUInt32BE(offset)
    const type = bytes.toString('ascii', offset + 4, offset + 8)
    const data = bytes.subarray(offset + 8, offset + 8 + length)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      assert.equal(data[8], 8, `${label} must use 8-bit channels`)
      assert.equal(data[9], 6, `${label} must be RGBA`)
      assert.equal(data[12], 0, `${label} must not be interlaced`)
    } else if (type === 'IDAT') {
      idat.push(data)
    } else if (type === 'IEND') {
      break
    }
    offset += length + 12
  }
  assert.ok(width > 0 && height > 0 && idat.length > 0, `${label} has incomplete PNG data`)
  const packed = zlib.inflateSync(Buffer.concat(idat))
  const stride = width * 4
  assert.equal(packed.length, height * (stride + 1), `${label} has an unexpected scanline layout`)
  const rgba = Buffer.alloc(width * height * 4)
  let sourceOffset = 0
  for (let y = 0; y < height; y += 1) {
    const filter = packed[sourceOffset]
    sourceOffset += 1
    for (let x = 0; x < stride; x += 1) {
      const raw = packed[sourceOffset + x]
      const target = y * stride + x
      const left = x >= 4 ? rgba[target - 4] : 0
      const above = y > 0 ? rgba[target - stride] : 0
      const upperLeft = y > 0 && x >= 4 ? rgba[target - stride - 4] : 0
      if (filter === 0) rgba[target] = raw
      else if (filter === 1) rgba[target] = (raw + left) & 0xff
      else if (filter === 2) rgba[target] = (raw + above) & 0xff
      else if (filter === 3) rgba[target] = (raw + Math.floor((left + above) / 2)) & 0xff
      else if (filter === 4) rgba[target] = (raw + paeth(left, above, upperLeft)) & 0xff
      else assert.fail(`${label} uses unsupported PNG filter ${filter}`)
    }
    sourceOffset += stride
  }
  return { width, height, rgba }
}

function assertTransparentCorners(image, label) {
  const { width, height, rgba } = image
  const alphaAt = (x, y) => rgba[(y * width + x) * 4 + 3]
  for (const [x, y] of [[0, 0], [width - 1, 0], [0, height - 1], [width - 1, height - 1]]) {
    assert.ok(
      alphaAt(x, y) <= MAX_TRANSPARENT_CORNER_ALPHA,
      `${label} must have visually transparent corners`,
    )
  }
}

function auditAppIcons(repoRoot) {
  const pngPath = path.join(repoRoot, 'build/icon.png')
  const png = decodeRgbaPng(fs.readFileSync(pngPath), 'build/icon.png')
  assert.deepEqual([png.width, png.height], [1024, 1024], 'build/icon.png must be 1024x1024')
  assertTransparentCorners(png, 'build/icon.png')

  const icoPath = path.join(repoRoot, 'build/icon.ico')
  const ico = fs.readFileSync(icoPath)
  assert.equal(ico.readUInt16LE(0), 0, 'build/icon.ico reserved header must be zero')
  assert.equal(ico.readUInt16LE(2), 1, 'build/icon.ico must be an icon resource')
  const count = ico.readUInt16LE(4)
  const sizes = []
  for (let index = 0; index < count; index += 1) {
    const entry = 6 + index * 16
    const width = ico[entry] || 256
    const height = ico[entry + 1] || 256
    assert.equal(width, height, `build/icon.ico entry ${index} must be square`)
    assert.equal(ico.readUInt16LE(entry + 6), 32, `build/icon.ico ${width}px entry must be 32-bit`)
    const byteLength = ico.readUInt32LE(entry + 8)
    const imageOffset = ico.readUInt32LE(entry + 12)
    const embedded = decodeRgbaPng(ico.subarray(imageOffset, imageOffset + byteLength), `build/icon.ico ${width}px entry`)
    assert.deepEqual([embedded.width, embedded.height], [width, height], `build/icon.ico ${width}px directory mismatch`)
    assertTransparentCorners(embedded, `build/icon.ico ${width}px entry`)
    sizes.push(width)
  }
  assert.deepEqual([...sizes].sort((a, b) => a - b), REQUIRED_ICO_SIZES, 'build/icon.ico must contain the required Windows sizes exactly once')
  return { png: `${png.width}x${png.height}`, icoSizes: sizes }
}

if (require.main === module) {
  const result = auditAppIcons(path.resolve(__dirname, '..'))
  console.log(`APP ICON CHECK PASS png=${result.png} ico=${result.icoSizes.join(',')}`)
}

module.exports = { auditAppIcons, decodeRgbaPng }
