import { redact } from './_paidEnvKey.mjs'
import http from 'node:http'
import https from 'node:https'

/** Test-only fault boundary: forward bytes unchanged, reject concurrency, or discard one accepted reply. */
export async function createGenerationLockExitProxy({ target, imageModel, fakeDelayMs = 0, maxImages = 14 }) {
  const records = []
  let active = 0
  let dropNext = false
  let dropMatch = null
  let limit = 2
  const server = http.createServer(async (req, res) => {
    const parts = []
    for await (const part of req) parts.push(part)
    const body = Buffer.concat(parts)
    const media = req.method === 'POST' && /\/images\/generations/.test(req.url)
    let record
    if (media) {
      let parsed
      try { parsed = JSON.parse(body.toString()) } catch { res.writeHead(400).end(); return }
      if (parsed.model !== imageModel || records.filter(r => r.forwarded).length >= maxImages) { res.writeHead(403).end(); return }
      const references = parsed.image ?? parsed.images ?? parsed.image_urls
      record = { sequence: records.length + 1, model: parsed.model, prompt: redact(parsed.prompt), referenceCount: Array.isArray(references) ? references.length : references ? 1 : 0, forwarded: false, rejected: active >= limit, dropped: false }
      records.push(record)
      if (record.rejected) { res.writeHead(429, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: { message: 'concurrency limit exceeded; too many simultaneous requests' } })); return }
      active++
      record.forwarded = true
      record.dropped = dropNext || (dropMatch !== null && String(parsed.prompt).includes(dropMatch))
      if (record.dropped) { dropNext = false; dropMatch = null }
    }
    const origin = new URL(target)
    const upstream = (origin.protocol === 'https:' ? https : http).request(new URL(req.url, origin), { method: req.method, headers: { ...req.headers, host: origin.host } }, async response => {
      const chunks = []
      for await (const chunk of response) chunks.push(chunk)
      if (media && fakeDelayMs) await new Promise(resolve => setTimeout(resolve, fakeDelayMs))
      if (media) active--
      if (record?.dropped) { res.destroy(); return }
      res.writeHead(response.statusCode, response.headers)
      res.end(Buffer.concat(chunks))
    })
    upstream.on('error', () => { if (media) active--; res.destroy() })
    upstream.end(body)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  return { origin: `http://127.0.0.1:${server.address().port}`, records,
    setLimit(value) { limit = value }, dropNextReply() { dropNext = true }, dropNextReplyMatching(value) { dropMatch = value },
    async close() { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) },
  }
}
