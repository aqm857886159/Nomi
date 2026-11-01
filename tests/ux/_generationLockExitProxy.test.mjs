import http from 'node:http'
import { expect, it } from 'vitest'
import { createGenerationLockExitProxy } from './_generationLockExitProxy.mjs'

it('forwards the same bytes, rejects a third concurrent image, drops only a forwarded reply and caps spend', async () => {
  const received = [], pending = []
  const server = http.createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk)
    received.push(Buffer.concat(chunks).toString())
    pending.push(() => res.writeHead(200, { 'content-type': 'application/json' }).end('{"data":[{"task_id":"fixture-task"}]}'))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const proxy = await createGenerationLockExitProxy({ target: `http://127.0.0.1:${server.address().port}`, imageModel: 'fake-image', maxImages: 3 })
  const body = '{"model":"fake-image","prompt":"fixture","images":["local-reference"]}'
  const post = () => fetch(`${proxy.origin}/v1/images/generations`, { method: 'POST', body, headers: { 'content-type': 'application/json' } })
  try {
    const first = post(), second = post()
    await expect.poll(() => received.length).toBe(2)
    expect((await post()).status).toBe(429)
    pending.splice(0).forEach(reply => reply())
    expect((await first).status).toBe(200); expect((await second).status).toBe(200)
    expect(received).toEqual([body, body])
    expect(proxy.records[0].referenceCount).toBe(1)
    proxy.dropNextReply()
    const dropped = post().then(() => false, () => true)
    await expect.poll(() => received.length).toBe(3)
    pending.splice(0).forEach(reply => reply())
    expect(await dropped).toBe(true)
    expect(proxy.records.at(-1).dropped).toBe(true)
    expect((await post()).status).toBe(403)
    expect(received).toHaveLength(3)
  } finally { await proxy.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) }
})

it('the paid entry requires a green four-stage rehearsal before opening any paid session', async () => {
  const { readFile } = await import('node:fs/promises')
  const source = await readFile(new URL('./generation-lock-exit-real.paid.mjs', import.meta.url), 'utf8')
  expect(source.indexOf("assert.equal(rehearsal.status, 'passed'")).toBeLessThan(source.indexOf('const paid = await openPaidWalk('))
  expect(source).toContain("['storyboard', 'canvas', 'list', 'restart']")
  expect(source).toContain('maxImages: 13')
  expect(source).toContain('reservedPriceProbe: 1')
})

it('changes the cap per stage and targets a shot reply without discarding its preceding asset reply', async () => {
  const server = http.createServer(async (req, res) => { for await (const part of req) void part; res.writeHead(200).end('{"data":[{"task_id":"fixture-task"}]}') })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const proxy = await createGenerationLockExitProxy({ target: `http://127.0.0.1:${server.address().port}`, imageModel: 'fake-image' })
  const post = prompt => fetch(`${proxy.origin}/v1/images/generations`, { method: 'POST', body: JSON.stringify({ model: 'fake-image', prompt }) })
  try {
    proxy.setLimit(1); proxy.dropNextReplyMatching('shot')
    expect((await post('asset')).status).toBe(200)
    expect(await post('shot').then(() => false, () => true)).toBe(true)
    expect(proxy.records.map(r => r.dropped)).toEqual([false, true])
    expect((await post('shot after release')).status).toBe(200)
  } finally { await proxy.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) }
})


it('does not discard a provider refusal or pretend it was an accepted paid task', async () => {
  const server = http.createServer(async (req, res) => { for await (const part of req) void part; res.writeHead(429).end('{"error":"fixture quota"}') })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const proxy = await createGenerationLockExitProxy({ target: `http://127.0.0.1:${server.address().port}`, imageModel: 'fake-image' })
  try {
    proxy.dropNextReply()
    const response = await fetch(`${proxy.origin}/v1/images/generations`, { method: 'POST', body: '{"model":"fake-image","prompt":"fixture"}' })
    expect(response.status).toBe(429)
    expect(await response.text()).toBe('{"error":"fixture quota"}')
    expect(proxy.records[0]).toMatchObject({ forwarded: true, upstreamStatus: 429, dropped: false })
    expect(proxy.records[0].providerTaskId).toBeUndefined()
  } finally { await proxy.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) }
})

it.each(['gzip', 'br', 'deflate'])('preserves %s receipt bytes and can discard a genuinely accepted compressed reply', async encoding => {
  const zlib = await import('node:zlib')
  const encode = { gzip: zlib.gzipSync, br: zlib.brotliCompressSync, deflate: zlib.deflateSync }[encoding]
  const payload = '{"data":[{"task_id":"compressed-task"}]}'
  const server = http.createServer(async (req, res) => { for await (const part of req) void part; res.writeHead(200, { 'content-encoding': encoding }); res.end(encode(payload)) })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const proxy = await createGenerationLockExitProxy({ target: `http://127.0.0.1:${server.address().port}`, imageModel: 'fake-image' })
  const post = () => fetch(`${proxy.origin}/v1/images/generations`, { method: 'POST', body: '{"model":"fake-image","prompt":"fixture"}' })
  try {
    expect(await (await post()).text()).toBe(payload)
    proxy.dropNextReply()
    expect(await post().then(() => false, () => true)).toBe(true)
    expect(proxy.records.map(record => record.providerTaskId)).toEqual(['compressed-task', 'compressed-task'])
    expect(proxy.records[1].dropped).toBe(true)
  } finally { await proxy.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) }
})
