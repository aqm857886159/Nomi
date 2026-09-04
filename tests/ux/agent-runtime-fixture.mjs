// Only the remote vendor is synthetic. Walks still use the real SDK, IPC, renderer and storage.
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import http from 'node:http'
import path from 'node:path'

export const FIXTURE_VENDOR = 'agent-runtime-loopback'
export const FIXTURE_TEXT_MODEL = 'agent-runtime-text'
export const FIXTURE_IMAGE_MODEL = 'agent-runtime-image'
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

function imageMapping(taskKind) {
  return {
    id: `${FIXTURE_IMAGE_MODEL}-${taskKind}`,
    vendorKey: FIXTURE_VENDOR, modelKey: FIXTURE_IMAGE_MODEL, taskKind,
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
      response_mapping: { image_url: 'data.0.url' }, defaultParams: { size: '1024x1024' },
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
      authType: 'none', authHeader: null, authQueryParam: null, providerKind: 'openai-compatible',
      createdAt: NOW, updatedAt: NOW,
    }],
    models: [
      { ...common, modelKey: FIXTURE_TEXT_MODEL, labelZh: 'Fixture 文本', kind: 'text', published: true, meta: { supportsImageInput: true } },
      { ...common, modelKey: FIXTURE_IMAGE_MODEL, labelZh: 'Fixture 图片', kind: 'image', published: true, meta: { archetypeId: 'agnes-image' } },
    ],
    mappings: ['text_to_image', 'image_edit'].map(imageMapping),
    apiKeysByVendor: {
      [FIXTURE_VENDOR]: { ...common, apiKey: FIXTURE_API_KEY, enc: 'plain' },
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

function jsonResponse(response, status, value) {
  if (!canWrite(response)) return
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
 * @typedef {{path:string, body:unknown, authorization:string, headers:object}} RequestRecord
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
  const requests = []
  const images = []
  const unexpected = []
  const expectations = []
  const sockets = new Set()
  let closed = false
  let closing

  function rejectRequest(record, response, message) {
    if (!unexpected.includes(record)) unexpected.push(record)
    if (response.headersSent) response.destroy()
    else jsonResponse(response, 400, { error: { message } })
  }

  async function handleRequest(request, response, record) {
    if (record.path === '/v1/chat/completions') requests.push(record)
    else if (record.path === '/v1/images/generations') images.push(record)
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
      jsonResponse(response, 200, { data: [{ url: imageURL }] })
      return
    }
    if (record.path !== '/v1/chat/completions') {
      rejectRequest(record, response, `Unexpected route: ${request.method} ${record.path}`)
      return
    }
    const expectation = expectations.find((entry) => !entry.consumed && entry.match(record.body, record))
    if (!expectation) {
      rejectRequest(record, response, 'Unexpected text request: no unconsumed expectation matched')
      return
    }
    expectation.consumed = true
    const state = { response, started: false, model: record.body?.model ?? FIXTURE_TEXT_MODEL, id: `chatcmpl-fixture-${requests.length}` }
    expectation.state = state
    response.once('close', () => { expectation.state = undefined })
    expectation.resolveReceived(record)
    const reply = expectation.releasedReply ?? expectation.reply
    if (reply.type !== 'hold' || reply.text !== undefined) sendReply(state, reply)
  }

  const server = http.createServer((request, response) => {
    const record = {
      path: request.url ?? '', body: null,
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
      baseURL, requests, images, unexpected, close,
      /** @param {{label:string, match?:(body:unknown, record:RequestRecord)=>boolean, reply:Reply}} options */
      expectText({ label, match = () => true, reply }) {
        if (closed) throw new Error('Fixture is closed')
        if (typeof label !== 'string' || !label || typeof match !== 'function') {
          throw new TypeError('expectText needs a label and a synchronous matcher')
        }
        validateReply(reply)
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
