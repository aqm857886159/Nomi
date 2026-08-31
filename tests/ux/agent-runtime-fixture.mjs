// Only the remote vendor is synthetic. Walks still use the real SDK, IPC, renderer and storage.
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import http from 'node:http'
import path from 'node:path'

export const FIXTURE_VENDOR = 'agent-runtime-loopback'
export const FIXTURE_TEXT_MODEL = 'agent-runtime-text'
export const FIXTURE_IMAGE_MODEL = 'agent-runtime-image'
export const FIXTURE_IMAGE_ALT_MODEL = 'agent-runtime-image-alt'
export const FIXTURE_VIDEO_MODEL = 'agent-runtime-video'
export const FIXTURE_VIDEO_ALT_MODEL = 'agent-runtime-video-alt'
// Keep the semantic walk on a shipped APIMart model identity.  Direct-key
// bootstrap intentionally rejects renderer/certification-owned model keys;
// this fixture must exercise that same curated contract rather than inventing
// a parallel provider model.
export const APIMART_IMAGE_MODEL = 'gpt-image-2'
export const FIXTURE_API_KEY = 'sk-agent-runtime-fixture'
export const FIXTURE_USAGE = Object.freeze({
  prompt_tokens: 11, completion_tokens: 7, total_tokens: 18,
  prompt_tokens_details: Object.freeze({ cached_tokens: 3 }),
})

const NOW = '2026-08-26T00:00:00.000Z'

/** Text-only matching helper: never copies image data URLs into expectation diagnostics. */
export function flattenRequestText(body) {
  return (Array.isArray(body?.messages) ? body.messages : []).flatMap((message) => {
    if (typeof message?.content === 'string') return [message.content]
    return (Array.isArray(message?.content) ? message.content : [])
      .filter((part) => part?.type === 'text' && typeof part.text === 'string')
      .map((part) => part.text)
  }).filter(Boolean).join('\n')
}

function imageMapping(taskKind, modelKey = FIXTURE_IMAGE_MODEL, vendorKey = FIXTURE_VENDOR) {
  return {
    id: `${vendorKey}-${modelKey}-${taskKind}`,
    vendorKey, modelKey, taskKind,
    name: `Fixture ${taskKind}`, enabled: true,
    create: {
      method: 'POST', path: '/v1/images/generations',
      headers: { Authorization: 'Bearer {{user_api_key}}', 'Content-Type': 'application/json' },
      body: {
        model: '{{model.modelKey}}', prompt: '{{request.prompt}}', size: '{{request.params.size}}',
        extra_body: {
          response_format: 'url',
          ...(taskKind === 'image_edit' ? { image: '{{request.params.image}}' } : {}),
        },
      },
      response_mapping: { task_id: 'data.0.task_id', image_url: 'data.0.url' },
      provider_meta_mapping: { task_id: 'data.0.task_id' },
      defaultParams: { size: '1024x1024' },
    },
    query: {
      method: 'GET', path: '/v1/tasks/{{providerMeta.task_id}}',
      headers: { Authorization: 'Bearer {{user_api_key}}' },
      response_mapping: {
        task_id: 'data.id', status: 'data.status', image_url: 'data.result.images.0.url.0',
        error_message: 'data.error.message',
      },
    },
    statusMapping: {
      queued: ['submitted', 'pending', 'queued'], running: ['processing', 'running'],
      succeeded: ['completed', 'succeeded', 'success'], failed: ['failed', 'cancelled', 'error'],
    },
    createdAt: NOW, updatedAt: NOW,
  }
}

/**
 * The production APIMart GPT Image 2 contract, copied as a data fixture so
 * the zero-cost Electron walk can keep the direct-key guard enabled.  Do not
 * loosen the production predicate for synthetic tests: if this shape drifts
 * from electron/catalog/apimartImages.ts, the focused contract assertions
 * below fail before a UI walk is attempted.
 */
function apimartImageMapping(taskKind) {
  const isEdit = taskKind === 'image_edit'
  return {
    id: `seed-apimart-gpt-image-2-${taskKind}`,
    vendorKey: 'apimart', modelKey: APIMART_IMAGE_MODEL, taskKind,
    name: `GPT Image 2 · ${isEdit ? '改图' : '文生图'}`, enabled: true,
    create: {
      method: 'POST', path: '/v1/images/generations',
      headers: { Authorization: 'Bearer {{user_api_key}}', 'Content-Type': 'application/json' },
      body: {
        model: '{{model.modelKey}}', prompt: '{{request.prompt}}',
        size: '{{request.params.size}}', resolution: '{{request.params.resolution}}',
        ...(isEdit ? { image_urls: '{{request.params.input_urls}}' } : {}),
      },
      response_mapping: { task_id: 'data.0.task_id' },
      provider_meta_mapping: { task_id: 'data.0.task_id' },
      paramMap: { rules: [
        { wire: 'size', from: 'aspect_ratio' },
        { wire: 'resolution', fromMany: ['resolution'], transform: 'toLowerCase' },
      ] },
    },
    query: {
      method: 'GET', path: '/v1/tasks/{{providerMeta.task_id}}',
      headers: { Authorization: 'Bearer {{user_api_key}}' },
      response_mapping: {
        task_id: 'data.id', status: 'data.status', image_url: 'data.result.images.0.url.0',
        error_message: 'data.error.message',
      },
    },
    statusMapping: {
      queued: ['submitted', 'pending', 'queued'], running: ['processing', 'running'],
      succeeded: ['completed', 'succeeded', 'success'], failed: ['failed', 'cancelled', 'error'],
    },
    createdAt: NOW, updatedAt: NOW,
  }
}

// The resident real-user walk must exercise the same catalog/HTTP path as a
// user-generated image-to-video task. Keep this mapping loopback-only: the
// response carries a certified MP4 URL so the renderer still runs the real
// task result materializer without creating a paid provider job.
function videoMapping(taskKind, modelKey = FIXTURE_VIDEO_MODEL) {
  return {
    id: `${modelKey}-${taskKind}`,
    vendorKey: FIXTURE_VENDOR, modelKey, taskKind,
    name: `Fixture ${taskKind}`, enabled: true,
    create: {
      method: 'POST', path: '/v1/videos',
      headers: { Authorization: 'Bearer {{user_api_key}}', 'Content-Type': 'application/json' },
      body: {
        model: '{{model.modelKey}}', prompt: '{{request.prompt}}',
        aspect_ratio: '{{request.params.aspect_ratio}}', resolution: '{{request.params.resolution}}',
        duration: '{{request.params.duration}}', image: '{{request.params.image}}',
      },
      response_mapping: { task_id: 'video_id', video_url: 'url' },
      provider_meta_mapping: { task_id: 'video_id' },
      defaultParams: { aspect_ratio: '16:9', resolution: '720p', duration: 5 },
    },
    createdAt: NOW, updatedAt: NOW,
  }
}

function modelCatalog(baseURL) {
  const common = { vendorKey: FIXTURE_VENDOR, enabled: true, createdAt: NOW, updatedAt: NOW }
  return {
    version: 8,
    vendors: [{
      key: FIXTURE_VENDOR, name: 'Agent Runtime Loopback', enabled: true, baseUrlHint: baseURL,
      authType: 'bearer', authHeader: null, authQueryParam: null, providerKind: 'openai-compatible',
      createdAt: NOW, updatedAt: NOW,
    }, {
      // Semantic generation uses the production APIMart adapter. Point its
      // catalog endpoint at the same zero-quota loopback so the UI walk tests
      // the real provider bootstrap without a paid network request.
      key: 'apimart', name: 'APIMart Loopback', enabled: true, baseUrlHint: baseURL,
      authType: 'bearer', authHeader: null, authQueryParam: null, providerKind: 'apimart',
      createdAt: NOW, updatedAt: NOW,
    }],
    models: [
      { ...common, modelKey: FIXTURE_TEXT_MODEL, labelZh: 'Fixture 文本', kind: 'text', meta: { supportsImageInput: true } },
      { ...common, modelKey: FIXTURE_IMAGE_MODEL, labelZh: 'Fixture 图片', kind: 'image', meta: { archetypeId: 'agnes-image' } },
      { ...common, vendorKey: 'apimart', modelKey: APIMART_IMAGE_MODEL, labelZh: 'GPT Image 2', kind: 'image', meta: { archetypeId: APIMART_IMAGE_MODEL }, pricing: { cost: 0.01, enabled: true, specCosts: [] } },
      { ...common, modelKey: FIXTURE_IMAGE_ALT_MODEL, labelZh: 'Fixture 图片备用', kind: 'image', meta: { archetypeId: 'agnes-image' } },
      { ...common, modelKey: FIXTURE_VIDEO_MODEL, labelZh: 'Fixture 视频', kind: 'video', meta: { archetypeId: 'agnes-video' } },
      { ...common, modelKey: FIXTURE_VIDEO_ALT_MODEL, labelZh: 'Fixture 视频备用', kind: 'video', meta: { archetypeId: 'agnes-video' } },
    ],
    mappings: [
      ...['text_to_image', 'image_edit'].flatMap((taskKind) => [imageMapping(taskKind), imageMapping(taskKind, FIXTURE_IMAGE_ALT_MODEL)]),
      ...['text_to_image', 'image_edit'].map((taskKind) => apimartImageMapping(taskKind)),
      ...['text_to_video', 'image_to_video'].flatMap((taskKind) => [videoMapping(taskKind), videoMapping(taskKind, FIXTURE_VIDEO_ALT_MODEL)]),
    ],
    apiKeysByVendor: {
      [FIXTURE_VENDOR]: { ...common, apiKey: FIXTURE_API_KEY, enc: 'plain' },
      apimart: { ...common, vendorKey: 'apimart', apiKey: FIXTURE_API_KEY, enc: 'plain' },
    },
  }
}

function validateReply(reply, allowHold = true) {
  if (reply?.type === 'text' && typeof reply.text === 'string') return
  if (allowHold && reply?.type === 'hold' && (reply.text === undefined || typeof reply.text === 'string')) return
  if (reply?.type === 'tool' && typeof reply.id === 'string' && reply.id
    && typeof reply.name === 'string' && reply.name && reply.args !== undefined) {
    if (JSON.stringify(reply.args) !== undefined) return
  }
  throw new TypeError('Expected a text/tool reply, or a hold with optional text')
}

function canWrite(response) {
  return !response.destroyed && !response.writableEnded
}

/**
 * Keep response observations useful for causal evidence without copying the
 * fixture's large data: URLs into every report.  Provider task/status fields
 * stay intact; binary-looking strings become a small deterministic marker.
 */
function responseEvidence(value, seen = new Set()) {
  if (typeof value === 'string') {
    if (value.startsWith('data:')) {
      const mediaType = value.slice(5, value.indexOf(';') > 0 ? value.indexOf(';') : value.length)
      return `[redacted data URL ${mediaType}; ${value.length} chars]`
    }
    if (value.length > 4096) return `[redacted long response string; ${value.length} chars]`
    return value
  }
  if (value === null || typeof value !== 'object') return value
  if (seen.has(value)) return '[redacted circular response value]'
  seen.add(value)
  try {
    if (Array.isArray(value)) return value.map((item) => responseEvidence(item, seen))
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, responseEvidence(item, seen)]))
  } finally {
    seen.delete(value)
  }
}

function jsonResponse(response, status, value, record) {
  if (!canWrite(response)) return
  if (record) {
    record.statusCode = status
    record.responseBody = responseEvidence(value)
  }
  response.writeHead(status, { 'Content-Type': 'application/json' })
  response.end(JSON.stringify(value))
}

function frame(state, delta, finishReason = null, usage) {
  return `data: ${JSON.stringify({
    id: state.id, object: 'chat.completion.chunk', created: 1, model: state.model,
    choices: usage ? [] : [{ index: 0, delta, finish_reason: finishReason }],
    ...(usage ? { usage } : {}),
  })}\n\n`
}

function beginStream(state) {
  if (state.started) return ''
  state.started = true
  state.response.writeHead(200, {
    'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive',
  })
  return frame(state, { role: 'assistant', content: '' })
}

function sendReply(state, reply) {
  if (!canWrite(state.response)) return
  if (state.record) {
    // Text transport is streamed rather than JSON.  Store a compact
    // observation envelope so request evidence has the same response seam as
    // image/video/task records without retaining the whole SSE wire.
    state.record.statusCode = 200
    state.record.responseBody = responseEvidence({
      stream: true,
      reply: reply.type === 'tool'
        ? { type: 'tool', id: reply.id, name: reply.name, args: reply.args }
        : { type: reply.type, text: reply.text },
      usage: FIXTURE_USAGE,
    })
  }
  let wire = beginStream(state)
  if (reply.type === 'hold') {
    state.response.write(wire + frame(state, { content: reply.text }))
    return
  }
  if (reply.type === 'text') wire += frame(state, { content: reply.text })
  else wire += frame(state, { tool_calls: [{
    index: 0, id: reply.id, type: 'function',
    function: { name: reply.name, arguments: JSON.stringify(reply.args) },
  }] })
  wire += frame(state, {}, reply.type === 'tool' ? 'tool_calls' : 'stop')
  wire += frame(state, {}, null, FIXTURE_USAGE)
  state.response.end(`${wire}data: [DONE]\n\n`)
}

/**
 * @typedef {{method:string, path:string, body:unknown, responseBody?:unknown, statusCode?:number, authorization:string, headers:object}} RequestRecord
 * @typedef {{type:'text', text:string}|{type:'tool', id:string, name:string, args:unknown}
 *   |{type:'hold', text?:string}} Reply
 *
 * Seed only a new, caller-isolated settings directory. Existing catalogs are never overwritten.
 * expectText consumes the first unconsumed matching expectation, exactly once. Matchers are sync.
 * Its received promise resolves on request arrival; a hold does not emit headers unless text is set.
 * release(text/tool) also works before arrival and is harmless after cancellation/close/completion.
 * close owns server connections, not caller directories. Call assertClean before closing a walk.
 */
export async function createAgentRuntimeFixture({ rootDir, settingsDir }) {
  if (!path.isAbsolute(rootDir) || !path.isAbsolute(settingsDir)) {
    throw new TypeError('Fixture rootDir and settingsDir must be absolute paths')
  }
  const imageBytes = await readFile(path.join(rootDir, 'resources/onboarding-demo/shot-4.jpg'))
  const imageURL = `data:image/jpeg;base64,${imageBytes.toString('base64')}`
  const videoBytes = await readFile(path.join(rootDir, 'electron/providerAdapter/__fixtures__/certification-media/valid.mp4'))
  const videoURL = `data:video/mp4;base64,${videoBytes.toString('base64')}`
  const requests = []
  const images = []
  const videos = []
  const taskQueries = []
  const unexpected = []
  const expectations = []
  const sockets = new Set()
  let closed = false
  let closing

  function rejectRequest(record, response, message) {
    if (!unexpected.includes(record)) unexpected.push(record)
    if (response.headersSent) response.destroy()
    else jsonResponse(response, 400, { error: { message } }, record)
  }

  async function handleRequest(request, response, record) {
    if (record.path === '/v1/chat/completions') requests.push(record)
    else if (record.path === '/v1/images/generations') images.push(record)
    else if (record.path === '/v1/videos' || record.path === '/v1/videos/generations') videos.push(record)
    // APIMart is an async create→poll transport. Handle its canonical task
    // query before parsing a request body (GET requests have none).
    if (request.method === 'GET' && record.path.startsWith('/v1/tasks/')) {
      const taskId = decodeURIComponent(record.path.slice('/v1/tasks/'.length))
      record.body = {}
      taskQueries.push(record)
      const isVideoTask = taskId.startsWith('fixture-video-')
      jsonResponse(response, 200, isVideoTask
        ? {
          code: 200,
          data: {
            id: taskId,
            status: 'completed',
            // APIMart's shipped mapping reads `data.result.videos.0.url.0`;
            // keep the fixture response in that documented array shape so a
            // resident production walk exercises the same extraction path.
            result: { videos: [{ id: `${taskId}-output`, url: [videoURL], file_name: 'fixture.mp4' }] },
          },
        }
        : {
          code: 200,
          data: { id: taskId, status: 'completed', result: { images: [{ url: [imageURL] }] } },
        }, record)
      return
    }
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    record.body = Buffer.concat(chunks).toString('utf8')
    try {
      record.body = JSON.parse(record.body || '{}')
    } catch {
      rejectRequest(record, response, 'Invalid JSON request body')
      return
    }
    if (request.method !== 'POST') {
      rejectRequest(record, response, `Unexpected route: ${request.method} ${record.path}`)
      return
    }
    if (record.path === '/v1/images/generations') {
      // Canonical certification uses the same generic image endpoint but a
      // deterministic verification prompt.  It must receive a synchronous
      // URL so the verifier can prove the contract; the real semantic fixture
      // request remains APIMart's async create→poll shape.
      const isCertificationProbe = typeof record.body?.prompt === 'string'
        && record.body.prompt.startsWith('Nomi adapter verification.')
      if (record.body?.model === APIMART_IMAGE_MODEL && !isCertificationProbe) {
      jsonResponse(response, 200, { code: 200, data: [{ status: 'submitted', task_id: `fixture-image-${images.length - 1}` }] }, record)
        return
      }
      jsonResponse(response, 200, { data: [{ url: imageURL }] }, record)
      return
    }
    if (record.path === '/v1/videos/generations') {
      // Canonical APIMart semantic video transport. The task is deliberately
      // zero-quota: the real adapter still submits, polls and materializes the
      // returned fixture MP4, while no external provider request is made.
      jsonResponse(response, 200, {
        code: 200,
        data: [{ status: 'submitted', task_id: `fixture-video-${videos.length - 1}` }],
      }, record)
      return
    }
    if (record.path === '/v1/videos') {
      jsonResponse(response, 200, { video_id: `fixture-video-${videos.length - 1}`, url: videoURL }, record)
      return
    }
    if (record.path !== '/v1/chat/completions') {
      rejectRequest(record, response, `Unexpected route: ${request.method} ${record.path}`)
      return
    }
    // The generic image certification contract verifies image_edit through a
    // non-streaming chat-completions request.  It is still a real probe, but it
    // must not consume a walk's conversational expectation or be mistaken for
    // a user turn.  Return the same loopback image asset in the documented
    // structured shape that the verifier extracts.
    const messageText = flattenRequestText(record.body)
    if (record.body?.model === APIMART_IMAGE_MODEL
      && messageText.includes('Preserve the blue reference square')) {
      jsonResponse(response, 200, { choices: [{ message: { images: [{ url: imageURL }] } }] }, record)
      return
    }
    if (record.body?.model === FIXTURE_TEXT_MODEL
      && messageText.includes('Nomi adapter verification. Reply with the single word ready.')) {
      const state = { response, record, started: false, model: record.body.model, id: `chatcmpl-fixture-cert-${requests.length}` }
      sendReply(state, { type: 'text', text: 'ready' })
      return
    }
    const expectation = expectations.find((entry) => !entry.consumed && entry.match(record.body, record))
    if (!expectation) {
      rejectRequest(record, response, 'Unexpected text request: no unconsumed expectation matched')
      return
    }
    expectation.consumed = true
    const state = { response, record, started: false, model: record.body?.model ?? FIXTURE_TEXT_MODEL, id: `chatcmpl-fixture-${requests.length}` }
    expectation.state = state
    response.once('close', () => { expectation.state = undefined })
    expectation.resolveReceived(record)
    const reply = expectation.releasedReply
      ?? (typeof expectation.reply === 'function' ? expectation.reply(record.body, record) : expectation.reply)
    validateReply(reply)
    if (reply.type !== 'hold' || reply.text !== undefined) sendReply(state, reply)
  }

  const server = http.createServer((request, response) => {
    const record = {
      method: String(request.method || 'GET').toUpperCase(), path: request.url ?? '', body: null,
      responseBody: undefined, statusCode: undefined,
      authorization: request.headers.authorization ?? '', headers: { ...request.headers },
    }
    // A peer may disappear while a held reply is being released; never emit an unhandled error.
    response.on('error', () => response.destroy())
    void handleRequest(request, response, record).catch((error) => {
      if (!closed && !request.aborted && !response.destroyed) {
        rejectRequest(record, response, `Fixture request failed: ${error.message}`)
      }
    })
  })
  server.on('connection', (socket) => {
    sockets.add(socket)
    socket.once('close', () => sockets.delete(socket))
  })

  function close() {
    if (closing) return closing
    closed = true
    closing = new Promise((resolve, reject) => {
      server.close((error) => error && error.code !== 'ERR_SERVER_NOT_RUNNING' ? reject(error) : resolve())
      for (const socket of sockets) socket.destroy()
    })
    return closing
  }

  try {
    await new Promise((resolve, reject) => {
      const onError = (error) => { server.off('listening', onListening); reject(error) }
      const onListening = () => { server.off('error', onError); resolve() }
      server.once('error', onError)
      server.once('listening', onListening)
      server.listen(0, '127.0.0.1')
    })
    const baseURL = `http://127.0.0.1:${server.address().port}`
    await mkdir(settingsDir, { recursive: true })
    await writeFile(path.join(settingsDir, 'model-catalog.json'), `${JSON.stringify(modelCatalog(baseURL), null, 2)}\n`, { flag: 'wx' })
    return {
      baseURL, requests, images, videos, taskQueries, unexpected, close,
    /** @param {{label:string, match?:(body:unknown, record:RequestRecord)=>boolean, reply:Reply|((body:unknown, record:RequestRecord)=>Reply)}} options */
      expectText({ label, match = () => true, reply }) {
        if (closed) throw new Error('Fixture is closed')
        if (typeof label !== 'string' || !label || typeof match !== 'function') {
          throw new TypeError('expectText needs a label and a synchronous matcher')
        }
        if (typeof reply !== 'function') validateReply(reply)
        let resolveReceived
        const received = new Promise((resolve) => { resolveReceived = resolve })
        const expectation = { label, match, reply, consumed: false, resolveReceived, releasedReply: undefined, state: undefined }
        expectations.push(expectation)
        return {
          received,
          release(actualReply) {
            if (closed || expectation.releasedReply || (expectation.consumed && !expectation.state)
              || (expectation.state && !canWrite(expectation.state.response))) return
            const nextReply = actualReply ?? reply
            validateReply(nextReply, false)
            expectation.releasedReply = nextReply
            if (expectation.state) sendReply(expectation.state, nextReply)
          },
        }
      },
      assertClean() {
        const unused = expectations.filter((entry) => !entry.consumed).map((entry) => entry.label)
        const problems = []
        if (unexpected.length) problems.push(`${unexpected.length} unexpected request(s): ${unexpected.map((record) => record.path).join(', ')}`)
        if (unused.length) problems.push(`Unconsumed expectations: ${unused.join(', ')}`)
        if (problems.length) throw new Error(problems.join('; '))
      },
    }
  } catch (error) {
    await close()
    throw error
  }
}
