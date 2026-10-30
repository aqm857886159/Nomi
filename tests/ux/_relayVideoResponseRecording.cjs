// Test-only mainRequire hook. It observes responses after the existing network guard.
const fs = require('node:fs')
const LIMIT = 64 * 1024
const STATE = Symbol.for('nomi.relay.response-recording')
function redactUrl(value) {
  if (Array.isArray(value)) return value.slice(0, 4).map(redactUrl)
  if (!value) return value
  if (typeof value !== 'string') return typeof value === 'object' ? {} : typeof value === 'number' ? 1 : true
  if (!/^https?:\/\//i.test(value)) return '[redacted-non-http-url]'
  const extension = new URL(value).pathname.match(/\.(mp4|webm|png|jpe?g|gif|webp|mp3|wav)$/i)?.[1].toLowerCase()
  return `https://media.example.test/recorded${extension ? `.${extension}` : ''}`
}
function projectResponse(value, ids = new Map(), depth = 0) {
  if (!value || typeof value !== 'object' || depth > 6) return undefined
  if (Array.isArray(value)) return value.slice(0, 4).map((item) => projectResponse(item, ids, depth + 1))
  const out = {}
  for (const [key, field] of Object.entries(value)) {
    if (['id', 'task_id', 'job_id'].includes(key) && (typeof field === 'string' || typeof field === 'number')) {
      if (!ids.has(String(field))) ids.set(String(field), `recorded-task-${ids.size + 1}`)
      out[key] = ids.get(String(field))
    } else if (key === 'status' && typeof field === 'string') {
      // A status is a protocol token; arbitrary text, credentials and paths are never persisted.
      out.status = /^[a-z_]{1,32}$/i.test(field) && !/^(?:sk|key|token|secret|bearer)_/i.test(field) ? field : '[redacted-status]'
    } else if (['code', 'progress'].includes(key) && typeof field === 'number' && Number.isFinite(field)) out[key] = field
    else if (['url', 'video_url', 'output_url', 'thumbnail_url', 'preview_url', 'download_url'].includes(key)) out[key] = redactUrl(field)
    else if (key === 'error') out.error = !field ? field : { present: true, ...(typeof field === 'object' && !Array.isArray(field) ? projectResponse(field, ids, depth + 1) : {}) }
    else if (['data', 'result', 'output', 'videos'].includes(key)) out[key] = projectResponse(field, ids, depth + 1)
  }
  return out
}
function stageOf(target) {
  const pathname = new URL(target).pathname
  if (/^\/v1\/videos?(?:\/generations)?$/.test(pathname)) return 'create'
  if (/^\/v1\/videos\/[^/]+\/content$/.test(pathname)) return 'result'
  if (/^\/v1\/(?:videos?(?:\/generations)?|tasks)\/[^/]+$/.test(pathname)) return 'query'
  return null
}
function install({ origin, file, modelKey, fetchImpl = globalThis.fetch }) {
  const tasks = new Set(), ids = new Map()
  const write = (entry) => {
    try { fs.appendFileSync(file, JSON.stringify({ schemaVersion: 1, ...entry }) + '\n', { mode: 0o600 }) }
    catch { state.failed = true } // A diagnostic write failure must not change the actual request.
  }
  const capture = async (response, stage) => {
    const mime = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()
    const base = { stage, httpStatus: response.status, mime: ['application/json', 'video/mp4'].includes(mime) ? mime : 'other' }
    if (mime !== 'application/json') { write({ ...base, kind: mime === 'video/mp4' ? 'binary-metadata' : 'unparsed' }); return }
    const reader = response.clone().body?.getReader()
    if (!reader) { write({ ...base, kind: 'empty' }); return }
    let bytes = 0; const chunks = []
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      bytes += value.length
      if (bytes > LIMIT) { void reader.cancel().catch(() => {}); write({ ...base, kind: 'oversize' }); return }
      chunks.push(Buffer.from(value))
    }
    try { write({ ...base, kind: 'json', response: projectResponse(JSON.parse(Buffer.concat(chunks).toString('utf8')), ids) }) }
    catch { write({ ...base, kind: 'unparsed' }) }
  }
  const wrapped = async (input, init) => {
    let target
    try { target = new URL(typeof input === 'string' || input instanceof URL ? input : input.url) } catch { return fetchImpl(input, init) }
    const stage = target.origin === origin ? stageOf(target) : null
    if (stage) {
      let body = {}
      try { body = typeof init?.body === 'string' ? JSON.parse(init.body) : {} } catch { /* No arbitrary request text is recorded. */ }
      const parameters = {}
      if (typeof body.duration === 'number' && Number.isFinite(body.duration)) parameters.duration = body.duration
      if (typeof body.resolution === 'string' && /^\d{3,4}p$/.test(body.resolution)) parameters.resolution = body.resolution
      if (typeof body.audio === 'boolean') parameters.audio = body.audio
      write({ kind: 'request', stage, method: ['GET', 'POST'].includes(String(init?.method || 'GET').toUpperCase()) ? String(init?.method || 'GET').toUpperCase() : 'OTHER', modelMatches: Boolean(modelKey && body.model === modelKey), parameters })
    }
    const response = await fetchImpl(input, init)
    if (stage) {
      const task = capture(response, stage).catch(() => { state.failed = true })
      tasks.add(task); void task.finally(() => tasks.delete(task))
    }
    return response
  }
  const state = { failed: false, async flush() { await Promise.all([...tasks]); return { failed: state.failed } } }
  return { wrapped, state }
}
module.exports = { projectResponse, install }
if (process.env.NOMI_RELAY_RECORD_FILE && process.env.NOMI_RELAY_RECORD_ORIGIN && !globalThis[STATE]) {
  const { wrapped, state } = install({ file: process.env.NOMI_RELAY_RECORD_FILE, origin: process.env.NOMI_RELAY_RECORD_ORIGIN, modelKey: process.env.NOMI_RELAY_RECORD_MODEL })
  globalThis.fetch = wrapped
  globalThis[STATE] = state
}
