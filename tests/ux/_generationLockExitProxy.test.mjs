import http from 'node:http'
import { expect, it } from 'vitest'
import { createGenerationLockExitProxy } from './_generationLockExitProxy.mjs'

it('forwards the same bytes, rejects a third concurrent image, drops only a forwarded reply and caps spend', async () => {
  const received = [], pending = []
  const server = http.createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk)
    received.push(Buffer.concat(chunks).toString())
    pending.push(() => res.writeHead(200, { 'content-type': 'application/json' }).end('{"data":[]}'))
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
  expect(source).toContain('maxImages: 14')
})
