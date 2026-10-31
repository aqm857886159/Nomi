// Strict loopback relay. Protocol shape, never provider identity, chooses the routes.
import http from 'node:http'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

export const FAKE_RELAY_KEY = 'relay-rehearsal-placeholder-key'
export const RELAY_CASES = [
  { id: 'opaque-alpha', kind: 'video', duration: 3, resolution: '720p' },
  { id: 'opaque-beta', kind: 'video', frameOnly: true, duration: 3, resolution: '540p' },
  { id: 'opaque-gamma', kind: 'video', duration: 1, resolution: '360p', audio: false },
]
const MP4 = fs.readFileSync(fileURLToPath(new URL('../../electron/providerAdapter/__fixtures__/certification-media/valid.mp4', import.meta.url)))
const AUTH = { Authorization: 'Bearer {{user_api_key}}' }

export function relayDeclaration(baseUrl, { id = 'opaque-gamma', frameOnly = false, shape = 'plural-url', queryPath } = {}) {
  const root = shape === 'content' ? '/v1/videos' : shape === 'legacy-url' ? '/v1/video/generations' : '/v1/videos/generations'
  const native = shape === 'plural-url'
  const taskPath = native ? 'data.0.task_id' : shape === 'content' ? 'id' : 'task_id'
  const body = native
    ? { model: '{{model.modelKey}}', prompt: '{{request.prompt}}', duration: '{{request.params.duration}}', resolution: '{{request.params.resolution}}', aspect_ratio: '{{request.params.size}}', audio: false }
    : shape === 'content'
      ? { model: '{{model.modelKey}}', prompt: '{{request.prompt}}', seconds: '{{request.params.duration}}', size: '1280x720' }
      : { model: '{{model.modelKey}}', prompt: '{{request.prompt}}', duration: '{{request.params.duration}}', size: '{{request.params.resolution}}' }
  if (frameOnly) body.image_urls = ['{{request.params.image_url}}']
  const mode = {
    taskKind: frameOnly ? 'image_to_video' : 'text_to_video', delivery: 'asynchronous',
    create: { method: 'POST', path: root, headers: AUTH, body, response_mapping: { task_id: taskPath }, provider_meta_mapping: { task_id: taskPath } },
    query: { method: 'GET', path: `${queryPath ?? root}/{{providerMeta.task_id}}`, headers: AUTH,
      response_mapping: { status: native ? 'data.status' : 'status', ...(shape === 'content' ? {} : { video_url: native ? 'data.result.videos.0.url.0' : 'video_url' }) } },
    ...(shape === 'content' ? { result: { method: 'GET', path: `${root}/{{providerMeta.task_id}}/content`, headers: AUTH, mediaResponse: { kind: 'binary', contentType: 'video/mp4' } } } : {}),
    statusMapping: { queued: ['queued', 'submitted'], running: ['processing', 'in_progress'], succeeded: ['completed', 'succeeded'], failed: ['failed'] },
    ...(frameOnly ? { referenceParam: 'image_url', referenceShape: 'single' } : {}),
    sourceUrls: ['https://docs.example.test/video'],
  }
  if (shape === 'content') {
    delete mode.create.body
    // Wire fields read the neutral controls, so the visible defaults are what goes out.
    mode.create.multipart = { fields: { model: '{{model.modelKey}}', prompt: '{{request.prompt}}', seconds: '{{request.params.duration}}', size: '{{request.params.resolution}}' } }
  }
  return {
    provider: { baseUrl, authType: 'bearer', providerKind: 'openai-compatible' },
    sources: [{ url: 'https://docs.example.test/video', evidence: `${root}; explicit task query and result contract` }],
    assetIngestion: { strategy: 'none', sourceUrl: 'https://docs.example.test/video' },
    models: [{ modelKey: id, labelZh: id, kind: 'video', parameters: shape === 'content' ? [
      { key: 'duration', label: '时长', type: 'select', options: [{ value: '4', label: '4s' }], default: '4' },
      { key: 'resolution', label: '清晰度', type: 'select', options: [{ value: '1280x720', label: '1280x720' }], default: '1280x720' },
    ] : [
      { key: 'duration', label: '时长', type: 'number', min: 1, max: 15, default: 1 },
      { key: 'resolution', label: '清晰度', type: 'select', options: [{ value: '360p', label: '360p' }], default: '360p' },
    ], modes: [mode] }],
  }
}

export async function startRelayVideoFixture({ shape = 'plural-url', models = RELAY_CASES, listedIds, descriptors = false, fault = null } = {}) {
  const hits = []
  const tasks = new Map()
  const sockets = new Set()
  const root = shape === 'content' ? '/v1/videos' : shape === 'legacy-url' ? '/v1/video/generations' : '/v1/videos/generations'
  let baseUrl
  const server = http.createServer(async (req, res) => {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const raw = Buffer.concat(chunks).toString('utf8')
    let body = {}
    try {
      if (String(req.headers['content-type']).startsWith('multipart/form-data')) {
        body = Object.fromEntries(await new Request('http://fixture', { method: 'POST', headers: { 'Content-Type': req.headers['content-type'] }, body: Buffer.concat(chunks) }).formData())
      } else body = JSON.parse(raw || '{}')
    } catch { /* malformed requests are rejected by required fields below */ }
    const pathname = new URL(req.url, 'http://fixture').pathname
    const hit = { method: req.method, path: pathname, body, contentType: req.headers['content-type'] ?? '', authorized: req.headers.authorization === `Bearer ${FAKE_RELAY_KEY}` }
    hits.push(hit)
    const json = (status, value) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)) }
    if (pathname === '/asset.mp4') { res.writeHead(200, { 'Content-Type': 'video/mp4' }); return res.end(MP4) }
    if (!hit.authorized) return json(401, { error: { message: 'fixture key required' } })
    if (pathname === '/v1/balance') return json(200, { remain_balance: 100 })
    if (pathname === '/models' || pathname === '/v1/models') return json(200, { data: models.filter((m) => !listedIds || listedIds.includes(m.id)).map((m) => ({ id: m.id, ...(descriptors ? { architecture: { input_modalities: m.frameOnly ? ['image'] : ['text'], output_modalities: ['video'] } } : {}) })) })
    if (req.method === 'POST' && pathname === root) {
      if (fault === 'create-rejected') return json(404, { error: { message: 'documented route unavailable' } })
      if (shape === 'content' && !String(req.headers['content-type']).startsWith('multipart/form-data')) return json(415, { error: { message: 'multipart/form-data required' } })
      if (shape === 'content' && (!['4', '8', '12'].includes(String(body.seconds)) || !['720x1280', '1280x720', '1024x1792', '1792x1024'].includes(String(body.size)))) return json(400, { error: { message: 'documented seconds and pixel size are required' } })
      const model = models.find((m) => m.id === body.model)
      if (!model) return json(400, { error: { message: 'unknown wire model id' } })
      if (model.frameOnly && (!Array.isArray(body.image_urls) || body.image_urls.length !== 1 || !/^(https?:\/\/|data:image\/)/.test(String(body.image_urls[0])))) return json(400, { error: { message: 'exactly one first frame is required' } })
      if (model.alwaysAudio && body.audio === false) return json(400, { error: { message: 'audio false is not supported' } })
      const id = `task-${tasks.size + 1}`
      tasks.set(id, model)
      if (fault === 'missing-task-id') return json(200, { status: 'submitted' })
      return json(200, shape === 'plural-url' ? { code: 200, data: [{ status: 'submitted', task_id: id }] } : shape === 'content' ? { id, status: 'queued' } : { task_id: id, status: 'processing' })
    }
    const id = pathname.split('/').at(-1)
    const task = tasks.get(id)
    const queryRoot = shape === 'plural-url' ? task?.queryPath ?? root : root
    if (req.method === 'GET' && task && pathname === `${queryRoot}/${id}`) {
      if (shape === 'content') return json(200, { id, status: 'completed', progress: 100 })
      return json(200, shape === 'plural-url'
        ? { code: 200, data: { id, status: 'completed', progress: 100, result: { videos: [{ url: [`${baseUrl}/asset.mp4`] }] } } }
        : { task_id: id, status: 'succeeded', video_url: `${baseUrl}/asset.mp4` })
    }
    if (shape === 'content' && pathname.endsWith('/content') && tasks.has(pathname.split('/').at(-2))) {
      if (fault === 'html') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end('<html>upstream unavailable</html>') }
      if (fault === 'json-error') return json(200, { error: { message: 'content unavailable' } })
      if (fault === 'wrong-mime') { res.writeHead(200, { 'Content-Type': 'image/png' }); return res.end(MP4) }
      // "Said nothing about the type" is not a wrong type: real relays that stream the file out of object storage leave it unset.
      if (fault === 'octet-stream') { res.writeHead(200, { 'Content-Type': 'application/octet-stream' }); return res.end(MP4) }
      if (fault === 'no-content-type') { res.writeHead(200); return res.end(MP4) }
      // ...and an unstated type must not let non-video bytes through: publication verifies the bytes.
      if (fault === 'octet-html') { res.writeHead(200, { 'Content-Type': 'application/octet-stream' }); return res.end('<html>upstream unavailable</html>') }
      if (fault === 'unlabelled-json') { res.writeHead(200); return res.end(JSON.stringify({ error: { message: 'content unavailable' } })) }
      if (fault === 'redirect') { res.writeHead(302, { Location: `${baseUrl.replace('127.0.0.1', 'localhost')}/asset.mp4` }); return res.end() }
      if (fault === 'oversize') { res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': String(2 * 1024 ** 3 + 1) }); return res.end(MP4) }
      if (fault === 'bad-bytes') { res.writeHead(200, { 'Content-Type': 'video/mp4' }); return res.end(MP4.subarray(0, 48)) }
      if (fault === 'trickle') {
        // Bytes keep arriving the whole time, just slower than the shortened vendor timeout the test sets.
        res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': String(MP4.length) })
        let sent = 0
        const step = Math.max(1, Math.ceil(MP4.length / 25))
        const timer = setInterval(() => {
          if (sent >= MP4.length) { clearInterval(timer); return res.end() }
          res.write(MP4.subarray(sent, sent + step)); sent += step
        }, 40)
        res.once('close', () => clearInterval(timer))
        return
      }
      if (fault === 'slow') {
        res.writeHead(200, { 'Content-Type': 'video/mp4' }); res.write(MP4.subarray(0, 16))
        return // Intentionally never finish; request timeout / cancellation owns termination.
      }
      res.writeHead(200, { 'Content-Type': 'video/mp4' }); return res.end(MP4)
    }
    return json(404, { error: { message: `unsupported protocol route ${pathname}` } })
  })
  server.on('connection', (socket) => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)) })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  baseUrl = `http://127.0.0.1:${server.address().port}`
  return { baseUrl, hits, tasks, mp4: MP4, close: async () => { for (const socket of sockets) socket.destroy(); await new Promise((resolve) => server.close(resolve)) } }
}
