import { makeTempDir } from '../../scripts/_test-temp.mjs'
import { require as tsxRequire } from 'tsx/cjs/api'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { encryptFixtureKey as encryptSyntheticKey } from './_launchApp.mjs'

const require = createRequire(import.meta.url)
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

export const FIXTURE_API_KEY = 'mcp-l2-loopback-key'

function mediaFixture() {
  const root = makeTempDir('nomi-mcp-l2-media-')
  const videoPath = path.join(root, 'fixture.mp4')
  execFileSync(require('@ffmpeg-installer/ffmpeg').path, [
    '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=teal:s=64x64:d=1',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-y', videoPath,
  ])
  const image = buildPng(16, 16, [32, 160, 160, 255])
  const poster = image
  const referencePath = path.join(root, 'reference.png')
  fs.writeFileSync(referencePath, image)
  return { image, video: fs.readFileSync(videoPath), poster, referencePath, root, layers: LAYER_SPLIT_FIXTURE.map((layer) => buildPng(layer.width, layer.height, layer.rgba)) }
}

/**
 * 图层分离的替身回话（设计卡 docs/plan/2026-11-26-layer-split.md）：底图 + 2 层，一层带识别出的字。
 * 形状照 APIMart Seedream 5.5 文档（docs.apimart.ai/en/api-reference/images/seedream-5-5/generation，2026-11-26 取）：
 * `data.result.images[0].url[]`（0 = 底图）与 `layers[]` 按下标平行；z_index 底图 0、升序叠；bounding_box.absolute 是底图像素 [左, 上, 右, 下]。
 * 每层这里给的是「裁到框」的那种图（文档没写死裁不裁，真付费那一跑定案）。
 */
export const LAYER_SPLIT_FIXTURE = [
  { width: 640, height: 360, rgba: [40, 70, 110, 255], layer: { z_index: 0, name: 'background' } },
  { width: 200, height: 140, rgba: [230, 120, 40, 255], layer: { z_index: 1, name: '人物', bounding_box: { absolute: [60, 140, 260, 280] } } },
  { width: 240, height: 60, rgba: [250, 250, 250, 220], layer: { z_index: 2, name: '标题文字', bounding_box: { absolute: [340, 40, 580, 100] }, text_recognition: { text: 'NOMI' } } },
]

/**
 * 假价目（只给 Seedream 5.5 的图层分离用；字段形状照 APIMart 公开价目接口，数是编的）：auto 按高档，30 层 ≈ 30 × 0.0282 美元，
 * 首张输入图免费 → 发送键印 8.46 积分。别的模型照旧 404（价未知，不印数）。
 */
const LAYER_SPLIT_PRICE = {
  success: true,
  data: {
    model_name: 'seedream-5-5', membership: { category: 'image' },
    layer_decomposition_paid_prices: { '1K': 0.0141, '2K': 0.0282 }, layer_decomposition_max_images: 100,
    input_image_paid_price: 0.0035, input_image_first_free: true,
  },
}
const IMAGE_PRICE_LIST = { success: true, data: { models: { image: [{ id: 'seedream-5-5', specification: 'image', fixed_prices: { unit: 'usd_per_image' } }] } } }

// APIMart Seedance 2.5 的两步（docs.apimart.ai/en/api-reference/videos/seedance-2-5/generation，2026-11-26 取），替身照官方规则回：
//   · `draft: true` 只收 480p（「resolution must be 480p … any other resolution, including 4k, returns HTTP 400」）；
//   · `draft_task_id` 只收 model / draft_task_id / resolution（「do not resend inherited fields」「even identical values return 400」），
//     不能和 draft: true 同发；样片号必须是本替身出过、没过期的样片（「an expired draft returns 400 … without creating a task」）；
//     成片清晰度 1080p / 4k，不写按 1080p。一个样片可以出多次成片，每次是独立任务。
// 400 不建任务——和官方「不建任务、不扣费」一致。`expiredDrafts`：把这些样片号当成已过期（走查不用真等 3 天）。
const SAMPLE_FINAL_KEYS = new Set(['model', 'draft_task_id', 'resolution'])
function draftRuleViolation(parsed, tasks, expiredDrafts) {
  if (!parsed || typeof parsed !== 'object') return null
  if (parsed.draft_task_id !== undefined) {
    if (parsed.draft === true) return 'draft_task_id cannot be combined with draft: true'
    const inherited = Object.keys(parsed).filter((key) => !SAMPLE_FINAL_KEYS.has(key))
    if (inherited.length) return `do not resend inherited fields: ${inherited.sort().join(', ')}`
    const draft = tasks.get(String(parsed.draft_task_id))
    if (!draft?.draft) return `draft task not found: ${parsed.draft_task_id}`
    if (expiredDrafts.has(String(parsed.draft_task_id))) return `draft expired: ${parsed.draft_task_id}`
    if (parsed.resolution !== undefined && !['1080p', '4k'].includes(parsed.resolution)) return `draft_task_id supports 1080p / 4k, got ${parsed.resolution}`
    return null
  }
  if (parsed.draft === true && parsed.resolution !== undefined && parsed.resolution !== '480p') return `draft: true requires resolution 480p, got ${parsed.resolution}`
  return null
}

function parseJsonBody(body) {
  try { return JSON.parse(body) } catch { return null }
}

export async function startFakeApimartServer({ pendingPolls = 0, dropSubmits = 0, failTasks = 0, expiredDrafts = [] } = {}) {
  const expired = new Set(expiredDrafts.map(String))
  let holdProcessing = false
  let dropsLeft = dropSubmits
  let failsLeft = failTasks
  const media = mediaFixture()
  const tasks = new Map()
  const hits = []
  /** 真建成的任务（被 400 拒掉的不算）：任务号 + 请求体，按建的先后。 */
  const created = []
  let sequence = 0
  const socketEvents = []
  const server = http.createServer((req, res) => {
    let body = ''
    req.on('data', (chunk) => { body += chunk })
    req.on('end', () => {
      hits.push({ method: req.method, url: req.url, body, at: new Date().toISOString() })
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
      const layerFile = /^\/fixture\/layer-(\d+)\.png$/.exec(req.url || '')
      if (layerFile && media.layers[Number(layerFile[1])]) {
        const bytes = media.layers[Number(layerFile[1])]
        res.writeHead(200, { 'content-type': 'image/png', 'content-length': bytes.length }); res.end(bytes); return
      }
      if (req.method === 'GET' && req.url === '/api/pricing/model?model=seedream-5-5') { json(LAYER_SPLIT_PRICE); return }
      if (req.method === 'GET' && req.url === '/api/pricing/models/all') { json(IMAGE_PRICE_LIST); return }
      if (req.url === '/v1/uploads/images') {
        setTimeout(() => json({ url: `${origin}/fixture/image.png` }), 25)
        return
      }
      const create = /^\/v1\/(images|videos)\/generations$/.exec(req.url || '')
      if (create && dropsLeft > 0) {
        // 收下了请求、不回话就断开：调用方分不清供应商收没收下（结果未知）。
        dropsLeft -= 1
        req.socket.destroy()
        return
      }
      const parsedBody = create ? parseJsonBody(body) : null
      const violation = create ? draftRuleViolation(parsedBody, tasks, expired) : null
      if (violation) { json({ code: 400, error: { message: violation, type: 'invalid_request_error' } }, 400); return }
      if (create) {
        const taskId = `mcp-l2-${++sequence}`
        // 前 failTasks 个建好的任务：查询时报供应商一侧的普通失败（可重试），用来和「结果未知」并排。
        const failed = failsLeft > 0
        if (failed) failsLeft -= 1
        const layerSplit = create[1] === 'images' && parsedBody?.layer_decomposition === true
        tasks.set(taskId, { kind: create[1] === 'videos' ? 'video' : 'image', remaining: pendingPolls, body, failed, layerSplit, draft: parsedBody?.draft === true })
        created.push({ taskId, url: req.url, body: parsedBody })
        json({ code: 200, data: [{ status: 'submitted', task_id: taskId }] }); return
      }
      const query = /^\/v1\/tasks\/([^/]+)$/.exec(req.url || '')
      if (query) {
        const task = tasks.get(query[1])
        if (!task) { json({ code: 404, data: { status: 'failed', error: { message: 'unknown task' } } }, 404); return }
        if (holdProcessing || task.remaining > 0) { task.remaining = Math.max(0, task.remaining - 1); json({ code: 200, data: { id: query[1], status: 'processing' } }); return }
        if (task.failed) { json({ code: 200, data: { id: query[1], status: 'failed', error: { message: 'generation failed upstream' } } }); return }
        const entry = task.kind === 'video'
          ? { id: query[1], url: [`${origin}/fixture/video.mp4`], thumbnail_url: `${origin}/fixture/poster.png`, filename: 'fixture.mp4' }
          : task.layerSplit
            ? { id: query[1], url: LAYER_SPLIT_FIXTURE.map((_, index) => `${origin}/fixture/layer-${index}.png`), filename: 'layers.png', layers: LAYER_SPLIT_FIXTURE.map((item) => item.layer) }
            : { id: query[1], url: [`${origin}/fixture/image.png`], filename: 'fixture.png' }
        json({ code: 200, data: { id: query[1], status: 'completed', result: task.kind === 'video' ? { videos: [entry] } : { images: [entry] } } }); return
      }
      json({ error: 'not found' }, 404)
    })
  })
  // 出站失败（`fetch failed`）在调用方那侧只剩一句「fetch failed」——真正能分清
  // 「请求根本没到过供应商」与「到了但连接半路断了」的，只有服务端这半边的连接账本。
  // 2026-09-18 C9 那条间歇红就卡在这个区分上。
  server.on('connection', (socket) => {
    const at = new Date().toISOString()
    socketEvents.push(`open ${at} ${socket.remoteAddress}:${socket.remotePort}`)
    socket.on('close', (hadError) => socketEvents.push(`close ${new Date().toISOString()} opened=${at} hadError=${hadError}`))
  })
  server.on('clientError', (error, socket) => {
    socketEvents.push(`clientError ${new Date().toISOString()} ${error?.code || error?.message}`)
    try { socket.destroy() } catch { /* 诊断不许反过来弄炸夹具 */ }
  })
  let origin = ''
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  origin = `http://127.0.0.1:${server.address().port}`
  return {
    origin,
    hits,
    created,
    socketEvents,
    /** 走查中途把某个样片号标成已过期（官方 3 天有效期，走查不真等）。 */
    expireDraft: (taskId) => { expired.add(String(taskId)) },
    setProcessingHold: (held) => { holdProcessing = held },
    /** Node 默认 5s 就把闲置的 keep-alive 连接关掉；把它记下来，好判断空窗期是不是跨过了它。 */
    keepAliveTimeoutMs: server.keepAliveTimeout,
    referencePath: media.referencePath,
    videoPath: path.join(media.root, 'fixture.mp4'),
    close: () => new Promise((resolve) => server.close(resolve)),
  }
}

export function encryptFixtureKey(userDataDir) {
  return encryptSyntheticKey({ rootDir: repoRoot, userDataDir, appName: 'Nomi', plaintext: FIXTURE_API_KEY })
}

export function writeFakeApimartCatalog(settingsDir, userDataDir, _origin = '', { withKey = true } = {}) {
  // 目录由主人造（tests/world 的 buildWorld → ensureBuiltinModelSeeds + mutateCatalog 落盘），这里只声明「多一把加密好的假 key」。
  const { buildWorld } = tsxRequire('../world/index.ts', import.meta.url)
  const now = new Date().toISOString()
  const record = { vendorKey: 'apimart', apiKey: encryptFixtureKey(userDataDir), enc: 'safeStorage', enabled: true, createdAt: now, updatedAt: now }
  // 2026-09-21：这里曾经给 apimart 的视频模型塞一行 `pricing: { cost: 0, enabled: true }`——那是为了绕过当时的「算不出价就不发付费门」
  // 而**编出来的 0 元价**，让这条旅程一直在测一个「所有模型都标着 ¥0」的世界。闸开了之后绕行没有存在的理由：去掉它，
  // 这条旅程从此跑的是真实处境（价格未知）。内置种子保持出厂原样：连接范围、baseUrlHint 都不改——
  // 回环地址由显式的夹具环境变量选择，改 baseUrlHint 会正确地触发直连 key 的范围守卫。
  buildWorld({ settingsDir, projects: [], encryptedApiKeys: withKey ? { apimart: record } : {} })
  return { apiKeysByVendor: withKey ? { apimart: record } : {} }
}

function buildPng(width, height, [r, g, b, a]) {
  const zlib = require('node:zlib')
  const raw = Buffer.alloc(height * (1 + width * 4))
  for (let y = 0; y < height; y += 1) { const row = y * (1 + width * 4); raw[row] = 0; for (let x = 0; x < width; x += 1) { const p = row + 1 + x * 4; raw[p] = r; raw[p + 1] = g; raw[p + 2] = b; raw[p + 3] = a } }
  const crcTable = new Int32Array(256); for (let n = 0; n < 256; n += 1) { let c = n; for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcTable[n] = c }
  const crc32 = (buf) => { let crc = -1; for (const byte of buf) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 0xff]; return crc ^ -1 }
  const chunk = (type, data) => { const t = Buffer.from(type); const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])) >>> 0); return Buffer.concat([len, t, data, crc]) }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}
