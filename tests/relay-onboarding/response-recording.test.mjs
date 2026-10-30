import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import { createRequire } from 'node:module'
import { expect, it } from 'vitest'
import { makeTempDir } from '../../scripts/_test-temp.mjs'
const { projectResponse, install } = createRequire(import.meta.url)('../ux/_relayVideoResponseRecording.cjs')
it('records only contract facts, never arbitrary content, credentials, real IDs or signed/local URLs', () => {
  const projected = projectResponse({ id: 'private-id', status: 'completed', prompt: 'private prompt', headers: { Authorization: 'Bearer private-key' }, data: { task_id: 'private-id', status: 'in_progress', result: { videos: [{ url: ['https://private.example/file?key=private-key'] }] } }, error: { message: '/Users/private/movie.mp4 private prompt' } })
  expect(projected).toMatchObject({ id: 'recorded-task-1', status: 'completed', data: { task_id: 'recorded-task-1' }, error: { present: true } })
  expect(JSON.stringify(projected)).not.toMatch(/private|Authorization|Users|key=/)
  expect(projectResponse({ status: 'sk_secret', error: 'secret text' })).toEqual({ status: '[redacted-status]', error: { present: true } })
})
it('observes true HTTP JSON and binary metadata without changing bodies or submitting another request', async () => {
  const root = makeTempDir('relay-recording-'), file = path.join(root, 'responses.jsonl')
  const hits = []
  const server = http.createServer((req, res) => {
    hits.push(req.method)
    if (req.url.endsWith('/content')) { res.writeHead(200, { 'Content-Type': 'video/mp4' }); res.end(Buffer.from([0, 1, 2, 3])); return }
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ id: 'real-task', status: 'queued', prompt: 'not-for-disk' }))
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${server.address().port}`
  const { wrapped, state } = install({ origin, file, modelKey: 'authorized' })
  try {
    expect(await (await wrapped(`${origin}/v1/videos`, { method: 'POST', body: JSON.stringify({ model: 'authorized', duration: 1, resolution: '360p', audio: false, prompt: 'not-for-disk' }) })).json()).toMatchObject({ id: 'real-task' })
    expect(Buffer.from(await (await wrapped(`${origin}/v1/videos/real-task/content`)).arrayBuffer())).toEqual(Buffer.from([0, 1, 2, 3]))
    expect(await state.flush()).toEqual({ failed: false })
    const entries = fs.readFileSync(file, 'utf8').trim().split('\n').map(JSON.parse)
    expect(entries).toHaveLength(4)
    expect(entries).toContainEqual(expect.objectContaining({ kind: 'request', modelMatches: true, parameters: { duration: 1, resolution: '360p', audio: false } }))
    expect(entries).toContainEqual(expect.objectContaining({ stage: 'create', response: { id: 'recorded-task-1', status: 'queued' } }))
    expect(entries).toContainEqual(expect.objectContaining({ stage: 'result', kind: 'binary-metadata' }))
    expect(fs.readFileSync(file, 'utf8')).not.toMatch(/real-task|not-for-disk/)
    expect(hits).toEqual(['POST', 'GET'])
    const broken = install({ origin, file: path.join(root, 'missing', 'responses.jsonl') })
    expect(await (await broken.wrapped(`${origin}/v1/videos`, { method: 'POST' })).json()).toMatchObject({ id: 'real-task' })
    expect(await broken.state.flush()).toEqual({ failed: true })
    expect(hits).toEqual(['POST', 'GET', 'POST'])
  } finally { await new Promise((resolve) => server.close(resolve)); fs.rmSync(root, { recursive: true, force: true }) }
})

it('caps JSON recording and never writes HTML or malformed JSON response text', async () => {
  const root = makeTempDir('relay-recording-bad-'), file = path.join(root, 'responses.jsonl')
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': req.url.endsWith('/html') ? 'text/html' : 'application/json' })
    res.end(req.url.endsWith('/large') ? JSON.stringify({ prompt: 'private-content'.repeat(10000) }) : '<html>private-content</html>')
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${server.address().port}`
  const { wrapped, state } = install({ origin, file })
  try {
    for (const tail of ['large', 'html', 'invalid']) expect((await (await wrapped(`${origin}/v1/videos/${tail}`)).text()).length).toBeGreaterThan(0)
    expect(await state.flush()).toEqual({ failed: false })
    const text = fs.readFileSync(file, 'utf8'), entries = text.trim().split('\n').map(JSON.parse)
    expect(entries.filter((entry) => entry.kind === 'oversize')).toHaveLength(1)
    expect(entries.filter((entry) => entry.kind === 'unparsed')).toHaveLength(2)
    expect(text).not.toContain('private-content')
    const other = install({ origin: 'https://different.example.test', file })
    const before = text
    await (await other.wrapped(`${origin}/v1/videos/invalid`)).text()
    await other.state.flush()
    expect(fs.readFileSync(file, 'utf8')).toBe(before)
  } finally { await new Promise((resolve) => server.close(resolve)); fs.rmSync(root, { recursive: true, force: true }) }
})
