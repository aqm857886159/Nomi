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

function safeHeaders(headers) {
  return Object.fromEntries(Object.entries(headers).map(([key, value]) => [key, /authorization|api-key|cookie/i.test(key) ? '[REDACTED]' : value]))
}

export async function startFixtureServer({ repoRoot, fault = {} } = {}) {
  const requests = []
  const counters = new Map()
  let origin = ''
  const assets = {
    image: path.join(repoRoot, 'tests/ux/fixtures/test-upload.png'),
    video: path.join(repoRoot, 'marketing/assets/demo.mp4'),
    model3d: path.join(repoRoot, 'src/assets/x-bot.glb'),
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
      json(response, 200, { created: Date.now(), data: [{ url: `${origin}/assets/image.png` }] })
      return
    }

    if (request.method === 'POST' && url.pathname === '/v1/video/generations') {
      json(response, 200, { task_id: 'fixture-video-task', status: 'processing' })
      return
    }

    if (request.method === 'GET' && url.pathname === '/v1/video/generations/fixture-video-task') {
      json(response, 200, { task_id: 'fixture-video-task', status: 'succeeded', data: [{ url: `${origin}/assets/video.mp4` }] })
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

