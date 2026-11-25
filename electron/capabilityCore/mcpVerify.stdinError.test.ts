// 钉住 2026-08-25 并行 `vitest run electron` 抓到的真 bug：3047 个测试全过却 exit 1，
// 「Vitest caught 1 unhandled error」EPIPE（errno -32, syscall write）。
//
// 迁到官方 @modelcontextprotocol/client/stdio（StdioClientTransport）后，SDK 内部挂了
// `stdin.on('error', e => this.onerror?.(e))`，verifyMcp 侧挂 `probe.onerror` 收口。
// 这里用假 StdioClientTransport 把「对端先关 → 排队写随后异步上报 EPIPE」变成必然：
// verifyMcp 照常以 handshake-failed 收尾，异步 EPIPE 绝不升级成 unhandled error。
import { PassThrough } from 'node:stream'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let homeDir = ''

type FakeTransport = {
  stderr: PassThrough
  onclose?: () => void
  onerror?: (error: Error) => void
  onmessage?: (message: unknown) => void
  start: () => Promise<void>
  send: (message: unknown) => Promise<void>
  close: () => Promise<void>
}

const transportHook = vi.hoisted(() => ({ create: null as null | ((params: unknown) => FakeTransport) }))
vi.mock('@modelcontextprotocol/client/stdio', () => ({
  StdioClientTransport: class MockStdioClientTransport {
    constructor(params: unknown) {
      return transportHook.create!(params)
    }
  },
}))
vi.mock('electron', () => ({
  app: { getAppPath: () => '/fake/repo', getPath: () => homeDir, isPackaged: false },
}))
vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>()
  return { ...actual, default: { ...actual, homedir: () => homeDir }, homedir: () => homeDir }
})

import { verifyMcp } from './mcpVerify'
import { MCP_CONFIG_VERSION, MCP_CONFIG_VERSION_ENV } from './mcpConfig'
import { MCP_CLIENT_ENV, MCP_CLIENT_PROOF_ENV, ensureToken, signMcpClient } from './security'

const roots: string[] = []

/** 假传输：initialize 发送后先触发对端关闭，紧接着异步上报 stdin 排队写的 EPIPE。 */
function fakeTransportWithQueuedEpipe(): FakeTransport {
  const transport: FakeTransport = {
    stderr: new PassThrough(),
    async start() {},
    async send() {
      setImmediate(() => {
        transport.onclose?.()
        transport.onerror?.(Object.assign(new Error('write EPIPE'), { code: 'EPIPE', errno: -32, syscall: 'write' }))
      })
    },
    async close() {},
  }
  return transport
}

beforeEach(() => {
  homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-mcpverify-epipe-'))
  roots.push(homeDir)
  ensureToken()
  fs.writeFileSync(
    path.join(homeDir, '.claude.json'),
    JSON.stringify({
      mcpServers: {
        nomi: {
          command: process.execPath,
          args: [],
          env: {
            NOMI_MCP_STDIO: '1',
            NOMI_SETTINGS_DIR: homeDir,
            [MCP_CONFIG_VERSION_ENV]: MCP_CONFIG_VERSION,
            [MCP_CLIENT_ENV]: 'claude',
            [MCP_CLIENT_PROOF_ENV]: signMcpClient('claude')!,
          },
        },
      },
    }),
  )
})
afterEach(() => {
  transportHook.create = null
  for (const r of roots.splice(0)) fs.rmSync(r, { recursive: true, force: true })
})

describe('capabilityCore/mcpVerify · stdin 流级错误', () => {
  it('排队写完成时子进程已死（EPIPE）→ handshake-failed，绝不升级成 unhandled error', async () => {
    let created = 0
    transportHook.create = () => {
      created += 1
      return fakeTransportWithQueuedEpipe()
    }
    const res = await verifyMcp('claude')
    expect(created).toBe(1)
    expect(res.ok).toBe(false)
    expect(res.reason).toBe('handshake-failed')
    // EPIPE 的异步回调在测试本体结束后才冒出来——有没有被接住由 vitest 的 unhandled 把关判定。
    await new Promise((resolve) => setTimeout(resolve, 20))
  })
})
