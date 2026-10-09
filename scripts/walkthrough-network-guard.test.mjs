import { makeTempDir } from './_test-temp.mjs'
// 走查网络闸（scripts/walkthrough-network-guard.cjs）先验它会红：每一层都拿一次真实的出门尝试去撞，必须被拦下、记账；
// 本机回环必须放行。起一个装了闸的 node 子进程（Chromium 那一层只在 Electron 主进程里有，这里验不到，由走查的 layers 检查兜）。
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it } from 'vitest'

const guard = path.join(path.dirname(fileURLToPath(import.meta.url)), 'walkthrough-network-guard.cjs')
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

  it('NOMI_WALK_ALLOW_ORIGINS is ignored under CI (an inherited variable cannot open the public network there)', () => {
    const { entries } = runGuarded(`
      fetch('https://allowed.invalid/v1/chat/completions', { method: 'POST', body: '{}' }).catch(() => undefined)
    `, { NOMI_WALK_ALLOW_ORIGINS: 'https://allowed.invalid/v1', CI: 'true' })
    expect(entries.filter((entry) => entry.kind === 'blocked').map((entry) => entry.host)).toEqual(['allowed.invalid'])
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
