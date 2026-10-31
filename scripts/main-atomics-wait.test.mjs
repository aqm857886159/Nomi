import path from 'node:path'
import { ESLint } from 'eslint'
import { describe, expect, it } from 'vitest'

const eslint = new ESLint({ cwd: path.resolve(import.meta.dirname, '..') })
const hits = async (file, code) => (await eslint.lintText(code, { filePath: file }))[0].messages
  .filter((message) => message.ruleId === 'main-sync-wait/no-restricted-syntax' && message.message.includes('Atomics.wait'))

describe('main process synchronous wait uses ESLint core syntax restriction', () => {
  it.each(['electron/probe.ts', 'electron/quitTeardown.ts', 'electron/capabilityCore/host.ts', 'electron/update/installGate.ts', 'electron/probe.mts', 'electron/probe.mjs'])('%s cannot add a synchronous wait', async (file) => {
    expect(await hits(file, 'Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10)')).toHaveLength(1)
  })
  it.each([
    'Atomics["wait"](new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10)',
    'export const syncWait = Atomics.wait',
    'export const { wait } = Atomics',
    'Atomics?.wait?.(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10)',
  ])('direct/computed/alias access is rejected: %s', async (code) => {
    expect(await hits('electron/probe.ts', code)).toHaveLength(1)
  })
  it.each(['electron/probe.test.ts', 'electron/__tests__/probe.ts', 'src/probe.ts'])('%s is outside the main production restriction', async (file) => {
    expect(await hits(file, 'Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10)')).toHaveLength(0)
  })
  it('asynchronous wait remains available', async () => {
    expect(await hits('electron/probe.ts', 'Atomics.waitAsync(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10)')).toHaveLength(0)
  })
})
