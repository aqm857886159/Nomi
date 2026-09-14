// 钉住 2026-08-25 并行 `vitest run electron` 抓到的真 bug：3047 个测试全过却 exit 1，
// 「Vitest caught 1 unhandled error」EPIPE（errno -32, syscall write），栈指进 verifyMcp 的 send()。
//
// 机制（/tmp 探针实测过，不是推断）：写给子进程 stdin 的小包平时走同步快路——哪怕对端刚死也
// 静默成功；但并行负载下写入会落进 libuv 异步队列，完成时子进程已被收尸 → EPIPE 在 stdin 流上
// **异步** emit——send() 的 try/catch 只接得住同步抛错，流上没挂 'error' 监听就升级成进程级
// unhandled（真机上等于主进程 uncaughtException）。
//
// 真子进程没法从外面逼小包走异步路（mcpVerify.test.ts 的兄弟用例保持实连验证的本分），
// 所以这里用假 child 把那个时序变成必然：先收尸（测试本体照常以 handshake-failed 收尾），
// 排队写这时才完成并报 EPIPE。修复前它会让 vitest 报 unhandled error、整个 suite exit 1；
// 修复后 EPIPE 被源头接住，全程零 unhandled——这就是断言（vitest 对 unhandled 全局把关）。
import { EventEmitter } from 'node:events'
import { Writable } from 'node:stream'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { spawn } from 'node:child_process'

let homeDir = ''

const spawnHook = vi.hoisted(() => ({ impl: null as null | ((...args: unknown[]) => unknown) }))
vi.mock('node:child_process', () => ({
  spawn: (...args: unknown[]) => spawnHook.impl!(...args),
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

/** 假 child：唯一那笔 initialize 写入走「异步排队 → 对端先死 → EPIPE」的完成路径。 */
function fakeChildWithQueuedEpipe(): ReturnType<typeof spawn> {
  const child = new EventEmitter() as EventEmitter & {
    stdin: Writable
    stdout: EventEmitter
    stderr: EventEmitter
    kill: () => boolean
  }
  child.stdin = new Writable({
    write(_chunk, _encoding, callback) {
      setImmediate(() => {
        // 子进程先被收尸：verifyMcp 照常以 handshake-failed 收尾（和真实现场一样，测试本体是绿的）。
        child.emit('exit', 3, null)
        // 排队中的写这时才完成——EPIPE 经 Writable 机制在流上异步 emit 'error'。
        callback(Object.assign(new Error('write EPIPE'), { code: 'EPIPE', errno: -32, syscall: 'write' }))
      })
    },
  })
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.kill = () => true
  return child as unknown as ReturnType<typeof spawn>
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
  spawnHook.impl = null
  for (const r of roots.splice(0)) fs.rmSync(r, { recursive: true, force: true })
})

describe('capabilityCore/mcpVerify · stdin 流级错误', () => {
  it('排队写完成时子进程已死（EPIPE）→ handshake-failed，绝不升级成 unhandled error', async () => {
    let spawned = 0
    spawnHook.impl = () => {
      spawned += 1
      return fakeChildWithQueuedEpipe()
    }
    const res = await verifyMcp('claude')
    expect(spawned).toBe(1)
    expect(res.ok).toBe(false)
    expect(res.reason).toBe('handshake-failed')
    // EPIPE 的 'error' 在测试本体结束后才冒出来——有没有被接住由 vitest 的 unhandled 把关判定
    //（修复前：10/10 绿但 suite exit 1；修复后：exit 0）。给流一拍时间让它真的 emit 出来。
    await new Promise((resolve) => setTimeout(resolve, 20))
  })
})
