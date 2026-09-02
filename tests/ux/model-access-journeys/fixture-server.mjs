import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' }

function json(response, status, body) {
  response.writeHead(status, JSON_HEADERS)
  response.end(JSON.stringify(body))
}

function wavBuffer() {
  const sampleRate = 8000
  const samples = 800
  const data = Buffer.alloc(samples * 2)
  for (let index = 0; index < samples; index += 1) data.writeInt16LE(Math.round(Math.sin(index / 8) * 6000), index * 2)
  const header = Buffer.alloc(44)
  header.write('RIFF', 0); header.writeUInt32LE(36 + data.length, 4); header.write('WAVEfmt ', 8)
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22)
  header.writeUInt32LE(sampleRate, 24); header.writeUInt32LE(sampleRate * 2, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34)
  header.write('data', 36); header.writeUInt32LE(data.length, 40)
  return Buffer.concat([header, data])
}

async function requestBody(request) {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  return Buffer.concat(chunks)
}

/**
 * Smallest spec-correct GLB (one untextured triangle, ~700B). Why not reuse
 * src/assets/x-bot.glb (1.8MB): 3D results are delivered as inline data: URLs
 * (same SSRF reasoning as image/video below), and a multi-MB base64 blob is the
 * exact shape that already blew the certification media path once (see the
 * video-asset comment) — the certification harness re-reads the data URL every
 * poll. A hand-built minimal GLB stays tiny, passes the strict GLB structure
 * validator (electron/assets/model3dValidation.ts walks header/chunks/accessors),
 * and still renders a real mesh in the node's three.js viewer.
 */
function minimalGlbBuffer() {
  const gltf = {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36 }],
    buffers: [{ byteLength: 36 }],
  }
  let jsonChunk = Buffer.from(JSON.stringify(gltf), 'utf8')
  jsonChunk = Buffer.concat([jsonChunk, Buffer.alloc((4 - (jsonChunk.length % 4)) % 4, 0x20)])
  const bin = Buffer.alloc(36)
  ;[0, 0, 0, 1, 0, 0, 0, 1, 0].forEach((value, index) => bin.writeFloatLE(value, index * 4))
  const header = Buffer.alloc(12)
  header.write('glTF', 0, 'ascii'); header.writeUInt32LE(2, 4); header.writeUInt32LE(12 + 8 + jsonChunk.length + 8 + bin.length, 8)
  const jsonHeader = Buffer.alloc(8)
  jsonHeader.writeUInt32LE(jsonChunk.length, 0); jsonHeader.writeUInt32LE(0x4e4f534a, 4) // 'JSON'
  const binHeader = Buffer.alloc(8)
  binHeader.writeUInt32LE(bin.length, 0); binHeader.writeUInt32LE(0x004e4942, 4) // 'BIN\0'
  return Buffer.concat([header, jsonHeader, jsonChunk, binHeader, bin])
}

function safeHeaders(headers) {
  return Object.fromEntries(Object.entries(headers).map(([key, value]) => [key, /authorization|api-key|cookie/i.test(key) ? '[REDACTED]' : value]))
}

export async function startFixtureServer({ repoRoot, fault = {} } = {}) {
  const requests = []
  const counters = new Map()
  let origin = ''
  const assets = {
    image: path.join(repoRoot, 'tests/ux/fixtures/test-upload.png'),
    // Small (~21KB) 320x240 2s clip, not marketing/assets/demo.mp4 (3.4MB): results
    // are delivered as inline data: URLs (see below), and a multi-MB base64 video
    // blows the stack ("Maximum call stack size exceeded") in the certification
    // media path — the model then never certifies and stays unselectable. A small
    // clip keeps the data URL well under that limit. (Product note filed
    // separately: large data: video URLs should degrade, not overflow.)
    video: path.join(repoRoot, 'tests/ux/fixtures/fixture-video.mp4'),
    model3d: path.join(repoRoot, 'src/assets/x-bot.glb'),
  }
  // Generation results are delivered as inline `data:` URLs, not loopback
  // `${origin}/assets/*` links. Reason (probed 2026-09-01): the renderer can load
  // a 127.0.0.1 URL into <img>/<video>, but the main-process result localizer
  // (electron/runtime.ts localizeTaskAsset → importRemoteAsset → hardenedFetch)
  // refuses to *download* a private/loopback host for any non-ComfyUI vendor
  // (SSRF defense — correct production behavior). importRemoteAsset short-circuits
  // `data:` URLs via parseDataUrl before hardenedFetch, so a data URL localizes
  // inline with no network fetch — the same shape real vendors use when they
  // return b64_json. The `/assets/*` routes stay for the certification/adapter
  // path, which explicitly allow-lists the vendor origin.
  const MIME = { image: 'image/png', video: 'video/mp4', model3d: 'model/gltf-binary' }
  const dataUrlCache = new Map()
  const dataUrl = (kind) => {
    if (!dataUrlCache.has(kind)) {
      const base64 = fs.readFileSync(assets[kind]).toString('base64')
      dataUrlCache.set(kind, `data:${MIME[kind]};base64,${base64}`)
    }
    return dataUrlCache.get(kind)
  }

  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url || '/', origin)
    const body = await requestBody(request)
    const key = `${request.method} ${url.pathname}`
    counters.set(key, (counters.get(key) || 0) + 1)
    requests.push({
      at: new Date().toISOString(), method: request.method, path: url.pathname, query: Object.fromEntries(url.searchParams),
      headers: safeHeaders(request.headers), body: body.toString('utf8').slice(0, 12_000),
    })

    const injected = fault[url.pathname] || fault[key]
    if (injected) {
      if (injected.delayMs) await new Promise((resolve) => setTimeout(resolve, injected.delayMs))
      if (!injected.times || counters.get(key) <= injected.times) {
        if (injected.raw !== undefined) {
          response.writeHead(injected.status || 200, { 'content-type': injected.contentType || 'text/plain' })
          response.end(injected.raw)
          return
        }
        json(response, injected.status || 500, injected.body || { error: { message: injected.message || 'fixture injected failure' } })
        return
      }
    }

    if (request.method === 'GET' && ['/models', '/v1/models'].includes(url.pathname)) {
      json(response, 200, { data: [
        { id: 'fixture-text-chat' },
        { id: 'fixture-image-gen' },
        { id: 'fixture-video-gen' },
        { id: 'fixture-audio-tts' },
        { id: 'fixture-meshy-3d' },
      ] })
      return
    }

    if (request.method === 'POST' && url.pathname.endsWith('/chat/completions')) {
      let parsed = {}
      try { parsed = JSON.parse(body.toString('utf8')) } catch {}
      if (parsed.stream) {
        response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
        response.write(`data: ${JSON.stringify({ id: 'fixture-chat', choices: [{ delta: { content: 'fixture ' } }] })}\n\n`)
        response.write(`data: ${JSON.stringify({ id: 'fixture-chat', choices: [{ delta: { content: 'text' }, finish_reason: 'stop' }] })}\n\n`)
        response.end('data: [DONE]\n\n')
      } else {
        json(response, 200, { id: 'fixture-chat', choices: [{ message: { role: 'assistant', content: 'fixture text' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 2 } })
      }
      return
    }

    if (request.method === 'POST' && url.pathname.endsWith('/responses')) {
      json(response, 200, { id: 'fixture-response', status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'fixture response text' }] }] })
      return
    }

    if (request.method === 'POST' && url.pathname.endsWith('/v1/messages')) {
      json(response, 200, { id: 'fixture-anthropic', type: 'message', role: 'assistant', content: [{ type: 'text', text: 'fixture anthropic text' }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 2 } })
      return
    }

    if (request.method === 'POST' && /\/v1\/images\/(generations|edits)$/.test(url.pathname)) {
      json(response, 200, { created: Date.now(), data: [{ url: dataUrl('image') }] })
      return
    }

    if (request.method === 'POST' && url.pathname === '/v1/video/generations') {
      json(response, 200, { task_id: 'fixture-video-task', status: 'processing' })
      return
    }

    if (request.method === 'GET' && url.pathname === '/v1/video/generations/fixture-video-task') {
      json(response, 200, { task_id: 'fixture-video-task', status: 'succeeded', data: [{ url: dataUrl('video') }] })
      return
    }

    // ── RunningHub-style direct 3D endpoints (J11 executed leg / J14 3D leg) ──
    // The relay deliberately has no generic 3D wire (electron/catalog/catalogCommit.ts:540
    // “OpenAI 兼容面上根本没有 3D 生成端点”), so 3D roundtrips must ride a direct
    // declarative-http vendor. Shape mirrors electron/catalog/runninghub3d.ts (probed
    // real-API contract recorded there): submit POST /{endpoint} → flat {taskId,status};
    // poll POST /query {taskId} → flat {taskId,status,results:[{fileUrl,fileType}]}.
    if (request.method === 'POST' && /^\/(meshy6|hunyuan3d-v3\.1|hitem3d-v21)\/(text|image)-to-3d$/.test(url.pathname)) {
      json(response, 200, { taskId: 'fixture-3d-task', status: 'QUEUED' })
      return
    }
    if (request.method === 'POST' && url.pathname === '/query') {
      json(response, 200, {
        taskId: 'fixture-3d-task',
        status: 'SUCCESS',
        results: [{ fileUrl: `data:model/gltf-binary;base64,${minimalGlbBuffer().toString('base64')}`, fileType: 'glb' }],
      })
      return
    }

    if (request.method === 'POST' && url.pathname === '/v1/audio/speech') {
      const wav = wavBuffer()
      response.writeHead(200, { 'content-type': 'audio/wav', 'content-length': wav.length })
      response.end(wav)
      return
    }

    if (request.method === 'GET' && url.pathname === '/assets/image.png') {
      response.writeHead(200, { 'content-type': 'image/png' }); fs.createReadStream(assets.image).pipe(response); return
    }
    if (request.method === 'GET' && url.pathname === '/assets/video.mp4') {
      response.writeHead(200, { 'content-type': 'video/mp4' }); fs.createReadStream(assets.video).pipe(response); return
    }
    if (request.method === 'GET' && url.pathname === '/assets/model.glb') {
      response.writeHead(200, { 'content-type': 'model/gltf-binary' }); fs.createReadStream(assets.model3d).pipe(response); return
    }
    if (request.method === 'GET' && url.pathname === '/assets/audio.wav') {
      const wav = wavBuffer(); response.writeHead(200, { 'content-type': 'audio/wav', 'content-length': wav.length }); response.end(wav); return
    }
    json(response, 404, { error: { message: `fixture route not found: ${request.method} ${url.pathname}` } })
  })

  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  origin = `http://127.0.0.1:${address.port}`
  return {
    origin,
    requests,
    counters,
    close: () => new Promise((resolve) => server.close(resolve)),
  }
}
