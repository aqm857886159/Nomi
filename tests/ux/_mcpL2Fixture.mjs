import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { withLinuxNoSandbox, withLinuxSyntheticCredentialStorage, currentCatalogVersion } from './_launchApp.mjs'

const require = createRequire(import.meta.url)
const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..')

export const FIXTURE_API_KEY = 'mcp-l2-loopback-key'

function mediaFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-mcp-l2-media-'))
  const videoPath = path.join(root, 'fixture.mp4')
  execFileSync(require('@ffmpeg-installer/ffmpeg').path, [
    '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=teal:s=64x64:d=1',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-y', videoPath,
  ])
  const image = buildTinyPng()
  const poster = image
  const referencePath = path.join(root, 'reference.png')
  fs.writeFileSync(referencePath, image)
  return { image, video: fs.readFileSync(videoPath), poster, referencePath, root }
}

export async function startFakeApimartServer({ pendingPolls = 0 } = {}) {
  const media = mediaFixture()
  const tasks = new Map()
  const hits = []
  let sequence = 0
  const server = http.createServer((req, res) => {
    let body = ''
    req.on('data', (chunk) => { body += chunk })
    req.on('end', () => {
      hits.push({ method: req.method, url: req.url, body })
      const json = (value, status = 200) => {
        const payload = JSON.stringify(value)
        res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) })
        res.end(payload)
      }
      if (req.url === '/fixture/image.png') {
        res.writeHead(200, { 'content-type': 'image/png', 'content-length': media.image.length }); res.end(media.image); return
      }
      if (req.url === '/fixture/poster.png') {
        res.writeHead(200, { 'content-type': 'image/png', 'content-length': media.poster.length }); res.end(media.poster); return
      }
      if (req.url === '/fixture/video.mp4') {
        res.writeHead(200, { 'content-type': 'video/mp4', 'content-length': media.video.length }); res.end(media.video); return
      }
      const create = /^\/v1\/(images|videos)\/generations$/.exec(req.url || '')
      if (create) {
        const taskId = `mcp-l2-${++sequence}`
        tasks.set(taskId, { kind: create[1] === 'videos' ? 'video' : 'image', remaining: pendingPolls, body })
        json({ code: 200, data: [{ status: 'submitted', task_id: taskId }] }); return
      }
      const query = /^\/v1\/tasks\/([^/]+)$/.exec(req.url || '')
      if (query) {
        const task = tasks.get(query[1])
        if (!task) { json({ code: 404, data: { status: 'failed', error: { message: 'unknown task' } } }, 404); return }
        if (task.remaining > 0) { task.remaining -= 1; json({ code: 200, data: { id: query[1], status: 'processing' } }); return }
        const entry = task.kind === 'video'
          ? { id: query[1], url: [`${origin}/fixture/video.mp4`], thumbnail_url: `${origin}/fixture/poster.png`, filename: 'fixture.mp4' }
          : { id: query[1], url: [`${origin}/fixture/image.png`], filename: 'fixture.png' }
        json({ code: 200, data: { id: query[1], status: 'completed', result: task.kind === 'video' ? { videos: [entry] } : { images: [entry] } } }); return
      }
      json({ error: 'not found' }, 404)
    })
  })
  let origin = ''
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  origin = `http://127.0.0.1:${server.address().port}`
  return { origin, hits, referencePath: media.referencePath, close: () => new Promise((resolve) => server.close(resolve)) }
}

export function encryptFixtureKey(userDataDir) {
  const script = path.join(repoRoot, 'tests/ux/_encryptFixtureKey.cjs')
  const result = spawnSync(require('electron'), withLinuxSyntheticCredentialStorage(
    withLinuxNoSandbox([script, FIXTURE_API_KEY]), true,
  ), {
    cwd: repoRoot,
    env: {
      ...process.env, NOMI_E2E: '1', NOMI_APP_NAME: 'Nomi', NOMI_ELECTRON_USER_DATA_DIR: userDataDir,
      NOMI_E2E_SYNTHETIC_CREDENTIAL_STORAGE: '1',
    },
    encoding: 'utf8',
  })
  if (result.status !== 0 || !result.stdout.trim()) throw new Error(`safeStorage fixture key failed: ${result.stderr || result.stdout}`)
  return result.stdout.trim()
}

export function writeFakeApimartCatalog(settingsDir, userDataDir, origin = '', { withKey = true } = {}) {
  const { applyBuiltinSeeds } = require(path.join(repoRoot, 'dist-electron/catalog/seedBuiltins.js'))
  const seeded = applyBuiltinSeeds({ version: currentCatalogVersion(), vendors: [], models: [], mappings: [], apiKeysByVendor: {} }, new Date().toISOString()).state
  const encrypted = encryptFixtureKey(userDataDir)
  const vendors = seeded.vendors.map((vendor) => vendor.key === 'apimart' && origin ? { ...vendor, baseUrlHint: origin } : vendor)
  const catalog = {
    ...seeded,
    vendors,
    apiKeysByVendor: withKey ? {
      apimart: { vendorKey: 'apimart', apiKey: encrypted, enc: 'safeStorage', enabled: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    } : {},
  }
  fs.writeFileSync(path.join(settingsDir, 'model-catalog.json'), JSON.stringify(catalog), 'utf8')
  return catalog
}

function buildTinyPng() {
  const zlib = require('node:zlib'); const width = 16; const height = 16
  const raw = Buffer.alloc(height * (1 + width * 4))
  for (let y = 0; y < height; y += 1) { const row = y * (1 + width * 4); raw[row] = 0; for (let x = 0; x < width; x += 1) { const p = row + 1 + x * 4; raw[p] = 32; raw[p + 1] = 160; raw[p + 2] = 160; raw[p + 3] = 255 } }
  const crcTable = new Int32Array(256); for (let n = 0; n < 256; n += 1) { let c = n; for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcTable[n] = c }
  const crc32 = (buf) => { let crc = -1; for (const byte of buf) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 0xff]; return crc ^ -1 }
  const chunk = (type, data) => { const t = Buffer.from(type); const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])) >>> 0); return Buffer.concat([len, t, data, crc]) }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}
