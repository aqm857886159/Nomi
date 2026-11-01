import { makeTempDir } from './_test-temp.mjs'
// 走查网络闸（scripts/walkthrough-network-guard.cjs）先验它会红：每一层都拿一次真实的出门尝试去撞，必须被拦下、记账；
// 本机回环必须放行。起一个装了闸的 node 子进程（Chromium 那一层只在 Electron 主进程里有，这里验不到，由走查的 layers 检查兜）。
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

import { afterEach, describe, expect, it } from 'vitest'

const guard = path.join(path.dirname(fileURLToPath(import.meta.url)), 'walkthrough-network-guard.cjs')
const { scrubText } = createRequire(import.meta.url)('./walkthrough-url-shape.cjs')
const temps = []

function runGuarded(code, extraEnv = {}) {
  const dir = makeTempDir('nomi-net-guard-')
  temps.push(dir)
  const log = path.join(dir, 'net.jsonl')
  const result = spawnSync(process.execPath, ['-r', guard, '-e', code], {
    env: { ...process.env, NOMI_WALK_NET_LOG: log, HTTPS_PROXY: '', HTTP_PROXY: '', ALL_PROXY: '', https_proxy: '', http_proxy: '', all_proxy: '', ...extraEnv },
    encoding: 'utf8',
  })
  const entries = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line)) : []
  return { stdout: result.stdout, stderr: result.stderr, status: result.status, entries }
}

afterEach(() => {
  for (const dir of temps.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe('walkthrough network guard', () => {
  it('reports which layers it installed', () => {
    const { entries } = runGuarded('0')
    const loaded = entries.filter((entry) => entry.kind === 'guard-loaded')
    expect(loaded).toHaveLength(1)
    expect(loaded[0].layers).toEqual(expect.arrayContaining(['fetch', 'http', 'https', 'socket']))
  })

  it('NOMI_WALK_ALLOW_ORIGINS lets exactly the authorised provider through (paid real-model walks) and still blocks everything else', () => {
    const { entries } = runGuarded(`
      fetch('https://allowed.invalid/v1/chat/completions', { method: 'POST', body: '{}' }).catch(() => undefined)
        .then(() => fetch('https://other.invalid/v1/x')).catch(() => undefined)
    `, { NOMI_WALK_ALLOW_ORIGINS: 'https://allowed.invalid/v1', CI: '' })
    const blocked = entries.filter((entry) => entry.kind === 'blocked')
    expect(blocked.map((entry) => entry.host)).toEqual(['other.invalid'])
  })

  it('NOMI_WALK_HOLD_RESPONSE lets the request reach the provider and holds only its answer until released', () => {
    const dir = makeTempDir('nomi-net-guard-hold-')
    temps.push(dir)
    const releaseFile = path.join(dir, 'release')
    const { stdout, status, stderr, entries } = runGuarded(`
      const http = require('node:http')
      const fs = require('node:fs')
      const seen = []
      const server = http.createServer((request, response) => { seen.push(request.method + ' ' + request.url); response.end('{}') })
      server.listen(0, '127.0.0.1', async () => {
        const origin = 'http://127.0.0.1:' + server.address().port
        const free = await fetch(origin + '/v1/tasks/1', { method: 'GET' })
        const quick = await fetch(origin + '/v1/other', { method: 'POST' })
        let answered = false
        const held = fetch(origin + '/v1/images/generations', { method: 'POST', body: '{}' }).then((response) => { answered = true; return response.status })
        await new Promise((resolve) => setTimeout(resolve, 400))
        const receivedWhileHeld = seen.includes('POST /v1/images/generations')
        const answeredWhileHeld = answered
        fs.writeFileSync(${JSON.stringify(releaseFile)}, '')
        const status = await held
        const after = await fetch(origin + '/v1/images/generations', { method: 'POST', body: '{}' })
        server.close()
        console.log(JSON.stringify({ free: free.status, quick: quick.status, receivedWhileHeld, answeredWhileHeld, status, after: after.status, creates: seen.filter((line) => line.endsWith('/generations')).length }))
      })
    `, { NOMI_WALK_HOLD_RESPONSE: JSON.stringify({ method: 'POST', pathSuffix: '/images/generations', releaseFile }), CI: '' })
    expect(status, stderr).toBe(0)
    expect(JSON.parse(stdout)).toEqual({ free: 200, quick: 200, receivedWhileHeld: true, answeredWhileHeld: false, status: 200, after: 200, creates: 2 })
    expect(entries.filter((entry) => entry.kind === 'response-held').map((entry) => new URL(entry.url).pathname)).toEqual(['/v1/images/generations'])
  })

  it('NOMI_WALK_NET_BODIES=1 records the body of allowed public requests, scrubbed (no headers, no signed query, no key-shaped strings)', () => {
    const { entries } = runGuarded(`
      const form = new FormData()
      form.append('file', new Blob([new Uint8Array(4)], { type: 'image/png' }), 'first.png')
      fetch('https://allowed.invalid/v1/videos/generations', { method: 'POST', headers: { Authorization: 'Bearer sk-live-1234567890abcdef' },
        body: JSON.stringify({ image_urls: ['https://cdn.invalid/a.png?sig=SECRET&exp=1'], note: 'Bearer sk-live-1234567890abcdef' }) }).catch(() => undefined)
        .then(() => fetch('https://allowed.invalid/upload', { method: 'POST', body: form })).catch(() => undefined)
    `, { NOMI_WALK_ALLOW_ORIGINS: 'https://allowed.invalid', NOMI_WALK_NET_BODIES: '1', CI: '' })
    const recorded = entries.filter((entry) => entry.kind === 'allowed-request')
    expect(recorded).toHaveLength(2)
    expect(recorded[0]).toMatchObject({ method: 'POST', host: 'allowed.invalid', url: 'https://allowed.invalid/v1/videos/generations' })
    const text = recorded[0].body.text
    expect(JSON.parse(text).image_urls).toEqual(['https://cdn.invalid/a.png?<redacted>'])
    expect(JSON.stringify(entries)).not.toMatch(/SECRET|sk-live-1234567890abcdef/)
    expect(recorded[0]).not.toHaveProperty('headers')
    expect(recorded[1].body.form).toEqual([{ field: 'file', fileName: 'first.png', size: 4, type: 'image/png' }])
  })

  it('scrubs a signed URL whose path contains a space instead of truncating before the query', () => {
    const { entries } = runGuarded(`
      fetch('https://allowed.invalid/v1/videos/generations', { method: 'POST',
        body: JSON.stringify({ image_urls: ['https://cdn.invalid/first ref.png?sig=SECRET&exp=1'] }) }).catch(() => undefined)
    `, { NOMI_WALK_ALLOW_ORIGINS: 'https://allowed.invalid', NOMI_WALK_NET_BODIES: '1', CI: '' })
    const request = entries.find((entry) => entry.kind === 'allowed-request')
    expect(JSON.parse(request.body.text).image_urls).toEqual(['https://cdn.invalid/first ref.png?<redacted>'])
    expect(JSON.stringify(entries)).not.toContain('SECRET')
  })

  it('scrubs a signed URL before truncating an oversized JSON body and records truncated', () => {
    const { entries } = runGuarded(`
      fetch('https://allowed.invalid/v1/videos/generations', { method: 'POST',
        body: JSON.stringify({ image_urls: ['https://cdn.invalid/first ref.png?sig=SECRET&exp=1'], padding: 'x'.repeat(70000) }) }).catch(() => undefined)
    `, { NOMI_WALK_ALLOW_ORIGINS: 'https://allowed.invalid', NOMI_WALK_NET_BODIES: '1', CI: '' })
    const request = entries.find((entry) => entry.kind === 'allowed-request')
    expect(request.body.text).toContain('https://cdn.invalid/first ref.png?<redacted>')
    expect(request.body.text).not.toContain('SECRET')
    expect(request.body.truncated).toBe(true)
  })

  it('scrubs signed URLs in FormData string fields with and without spaces', () => {
    const { entries } = runGuarded(`
      const form = new FormData()
      form.append('withSpace', 'https://cdn.invalid/first ref.png?sig=SPACE_SECRET')
      form.append('withoutSpace', 'https://cdn.invalid/last.png?sig=PLAIN_SECRET')
      fetch('https://allowed.invalid/upload', { method: 'POST', body: form }).catch(() => undefined)
    `, { NOMI_WALK_ALLOW_ORIGINS: 'https://allowed.invalid', NOMI_WALK_NET_BODIES: '1', CI: '' })
    const request = entries.find((entry) => entry.kind === 'allowed-request')
    expect(request.body.form).toEqual([
      { field: 'withSpace', value: 'https://cdn.invalid/first ref.png?<redacted>' },
      { field: 'withoutSpace', value: 'https://cdn.invalid/last.png?<redacted>' },
    ])
    expect(JSON.stringify(entries)).not.toMatch(/SPACE_SECRET|PLAIN_SECRET/)
  })

  it('scrubs signed URLs embedded in plain text bodies', () => {
    const { entries } = runGuarded(`
      fetch('https://allowed.invalid/v1/text', { method: 'POST',
        body: 'before https://cdn.invalid/first ref.png?sig=SPACE_SECRET after https://cdn.invalid/last.png?sig=PLAIN_SECRET end' }).catch(() => undefined)
    `, { NOMI_WALK_ALLOW_ORIGINS: 'https://allowed.invalid', NOMI_WALK_NET_BODIES: '1', CI: '' })
    const request = entries.find((entry) => entry.kind === 'allowed-request')
    expect(request.body.text).toBe('before https://cdn.invalid/first ref.png?<redacted> after https://cdn.invalid/last.png?<redacted> end')
    expect(JSON.stringify(entries)).not.toMatch(/SPACE_SECRET|PLAIN_SECRET/)
  })

  it('scrubs a signed URL embedded in a JSON sentence value', () => {
    const { entries } = runGuarded(`
      fetch('https://allowed.invalid/v1/note', { method: 'POST',
        body: JSON.stringify({ note: 'before https://cdn.invalid/first ref.png?sig=SECRET after' }) }).catch(() => undefined)
    `, { NOMI_WALK_ALLOW_ORIGINS: 'https://allowed.invalid', NOMI_WALK_NET_BODIES: '1', CI: '' })
    const request = entries.find((entry) => entry.kind === 'allowed-request')
    expect(JSON.parse(request.body.text).note).toBe('before https://cdn.invalid/first ref.png?<redacted> after')
    expect(JSON.stringify(entries)).not.toContain('SECRET')
  })

  it('scrubs an oversized response string before a caller truncates it', () => {
    const text = JSON.stringify({ url: 'https://cdn.invalid/first ref.png?sig=SECRET' }) + 'x'.repeat(4096)
    const scrubbed = scrubText(text)
    expect(scrubbed).toContain('https://cdn.invalid/first ref.png?<redacted>')
    expect(scrubbed).not.toContain('SECRET')
  })

  it('without NOMI_WALK_NET_BODIES nothing about allowed requests is recorded (other walks unchanged)', () => {
    const { entries } = runGuarded(`
      fetch('https://allowed.invalid/v1/x', { method: 'POST', body: '{"a":1}' }).catch(() => undefined)
    `, { NOMI_WALK_ALLOW_ORIGINS: 'https://allowed.invalid', CI: '' })
    expect(entries.filter((entry) => entry.kind === 'allowed-request')).toEqual([])
  })

  it('NOMI_WALK_ALLOW_ORIGINS is ignored under CI (an inherited variable cannot open the public network there)', () => {
    const { entries } = runGuarded(`
      fetch('https://allowed.invalid/v1/chat/completions', { method: 'POST', body: '{}' }).catch(() => undefined)
    `, { NOMI_WALK_ALLOW_ORIGINS: 'https://allowed.invalid/v1', CI: 'true' })
    expect(entries.filter((entry) => entry.kind === 'blocked').map((entry) => entry.host)).toEqual(['allowed.invalid'])
  })

  it('"*.domain" lets the domain and its subdomains through, and nothing that merely looks like it', () => {
    const { entries } = runGuarded(`
      const urls = ['https://getapib.org/a', 'https://img.getapib.org/a.png', 'https://a.b.getapib.org/a.png',
        'https://getapib.org.evil.test/a', 'https://evilgetapib.org/a', 'https://getapib.org.evil.test/b']
      Promise.all(urls.map((url) => fetch(url).catch(() => undefined)))
    `, { NOMI_WALK_ALLOW_ORIGINS: '*.getapib.org', CI: '' })
    expect(entries.filter((entry) => entry.kind === 'blocked').map((entry) => entry.host).sort())
      .toEqual(['evilgetapib.org', 'getapib.org.evil.test', 'getapib.org.evil.test'])
  })

  it('"*.domain" also opens the connection layer for subdomains but not look-alikes', () => {
    const { entries } = runGuarded(`
      const net = require('node:net')
      for (const host of ['cdn.getapib.org', 'getapib.org.evil.test']) net.connect(443, host).on('error', () => undefined)
    `, { NOMI_WALK_ALLOW_ORIGINS: '*.getapib.org', CI: '' })
    expect(entries.filter((entry) => entry.kind === 'blocked' && entry.via === 'socket').map((entry) => entry.host)).toEqual(['getapib.org.evil.test'])
  })

  it('"*.domain" is ignored under CI too', () => {
    const { entries } = runGuarded(`fetch('https://img.getapib.org/a.png').catch(() => undefined)`, { NOMI_WALK_ALLOW_ORIGINS: '*.getapib.org', CI: 'true' })
    expect(entries.filter((entry) => entry.kind === 'blocked').map((entry) => entry.host)).toEqual(['img.getapib.org'])
  })

  it('an exact origin pins the port on every layer: another port is blocked and recorded (fetch, http, socket)', () => {
    const { entries } = runGuarded(`
      const net = require('node:net')
      const https = require('node:https')
      fetch('https://allowed.invalid:8443/ok').catch(() => undefined)
      fetch('https://allowed.invalid:9999/x').catch(() => undefined)
      fetch('https://allowed.invalid/default-443').catch(() => undefined)
      try { https.request({ hostname: 'allowed.invalid', port: 9999, path: '/x' }).on('error', () => undefined).destroy() } catch {}
      net.connect(8443, 'allowed.invalid').on('error', () => undefined)
      net.connect(9999, 'allowed.invalid').on('error', () => undefined)
    `, { NOMI_WALK_ALLOW_ORIGINS: 'https://allowed.invalid:8443', CI: '' })
    const blocked = entries.filter((entry) => entry.kind === 'blocked').map((entry) => `${entry.via} ${entry.url}`).sort()
    expect(blocked).toEqual([
      'fetch https://allowed.invalid/default-443',
      'fetch https://allowed.invalid:9999/x',
      'https.request https://allowed.invalid:9999/x',
      'socket tcp://allowed.invalid:9999',
    ].sort())
  })

  it('a default-port origin means 443 for https: socket on 443 passes, other ports are blocked', () => {
    const { entries } = runGuarded(`
      const net = require('node:net')
      net.connect(443, 'allowed.invalid').on('error', () => undefined)
      net.connect(9999, 'allowed.invalid').on('error', () => undefined)
    `, { NOMI_WALK_ALLOW_ORIGINS: 'https://allowed.invalid/v1', CI: '' })
    expect(entries.filter((entry) => entry.kind === 'blocked').map((entry) => entry.url)).toEqual(['tcp://allowed.invalid:9999'])
  })

  it('"*.domain" only opens the standard ports (443 / 80) on fetch and socket', () => {
    const { entries } = runGuarded(`
      const net = require('node:net')
      fetch('https://img.getapib.org/a').catch(() => undefined)
      fetch('https://img.getapib.org:8443/a').catch(() => undefined)
      net.connect(443, 'img.getapib.org').on('error', () => undefined)
      net.connect(8443, 'img.getapib.org').on('error', () => undefined)
    `, { NOMI_WALK_ALLOW_ORIGINS: '*.getapib.org', CI: '' })
    expect(entries.filter((entry) => entry.kind === 'blocked').map((entry) => entry.url).sort())
      .toEqual(['https://img.getapib.org:8443/a', 'tcp://img.getapib.org:8443'].sort())
  })

  it('blocks fetch to a public host and records who called it', () => {
    const { stdout, entries } = runGuarded(`
      function probeVendorModels() { return fetch('https://api.vendor.invalid/models?key=secret') }
      probeVendorModels().then(() => console.log('LEAKED'), (error) => console.log('REJECTED ' + error.message))
    `)
    expect(stdout).toContain('REJECTED')
    const blocked = entries.filter((entry) => entry.kind === 'blocked')
    expect(blocked).toHaveLength(1)
    expect(blocked[0]).toMatchObject({ via: 'fetch', host: 'api.vendor.invalid', url: 'https://api.vendor.invalid/models' })
    expect(blocked[0].stack).toContain('probeVendorModels')
  })

  it('a blocked fetch looks like a real connect refusal (cause on the connect phase), so the app can tell nothing was written', () => {
    const { stdout } = runGuarded(`
      fetch('https://api.vendor.invalid/v1/images', { method: 'POST', body: '{}' }).then(() => console.log('LEAKED'), (error) => {
        console.log('CAUSE ' + error.name + ' ' + (error.cause && error.cause.code) + ' ' + (error.cause && error.cause.syscall))
      })
    `)
    expect(stdout).toContain('CAUSE TypeError ECONNREFUSED connect')
  })

  it('blocks a raw socket that bypasses fetch and http', () => {
    const { stdout, entries } = runGuarded(`
      require('node:net').connect(443, 'api.vendor.invalid').on('error', (error) => console.log('SOCKET ' + error.code))
    `)
    expect(stdout).toContain('SOCKET ECONNREFUSED')
    expect(entries.filter((entry) => entry.kind === 'blocked')).toEqual([
      expect.objectContaining({ via: 'socket', host: 'api.vendor.invalid', url: 'tcp://api.vendor.invalid:443' }),
    ])
  })

  it('blocks http.request to a public host', () => {
    const { stdout, entries } = runGuarded(`
      try { require('node:http').request('http://api.vendor.invalid/v1/tasks') ; console.log('LEAKED') } catch (error) { console.log('THREW ' + error.message) }
    `)
    expect(stdout).toContain('THREW')
    expect(entries.filter((entry) => entry.kind === 'blocked')).toEqual([expect.objectContaining({ via: 'http.request', host: 'api.vendor.invalid' })])
  })

  it('lets loopback through untouched', () => {
    const { stdout, entries } = runGuarded(`
      const net = require('node:net')
      const server = net.createServer((socket) => socket.end('ok')).listen(0, '127.0.0.1', () => {
        net.connect(server.address().port, '127.0.0.1').on('data', (data) => { console.log('LOCAL ' + data); server.close() })
      })
    `)
    expect(stdout).toContain('LOCAL ok')
    expect(entries.filter((entry) => entry.kind === 'blocked')).toEqual([])
  })
})
