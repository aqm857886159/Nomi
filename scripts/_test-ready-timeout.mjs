// 测试专用：真实进程/真实SIGKILL，只有期限时钟由node:test控制。
// 启动耗时不是终止语义：先见到两个进程各自写出的PID并确认存活，再触发期限。
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { setTimeout as realSetTimeout } from 'node:timers'
import { fileURLToPath, pathToFileURL } from 'node:url'
import test from 'node:test'
import { makeTempDir } from './_test-temp.mjs'

const helperUrl = pathToFileURL(fileURLToPath(import.meta.url)).href
export const FIXTURE_TIMEOUT_MS = 1500

const alive = (pid) => {
  assert.ok(Number.isSafeInteger(pid) && pid > 0, `无效的夹具 PID: ${pid}`)
  try { process.kill(pid, 0); return true } catch (error) {
    if (error.code === 'ESRCH') return false
    throw error
  }
}
const waitFor = async (predicate, message, timeoutMs = 60_000) => {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    assert.ok(Date.now() < deadline, message)
    await new Promise((resolve) => realSetTimeout(resolve, 10))
  }
}

/** 只由生成的夹具调用；孙进程自己写PID，保证它已经执行到用户代码。 */
export function hangReadyTree(parentFile, descendantFile) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Number(process.env.NOMI_TEST_FIXTURE_START_DELAY_MS || 0))
  fs.writeFileSync(parentFile, String(process.pid))
  spawn(process.execPath, ['-e', `require('node:fs').writeFileSync(${JSON.stringify(descendantFile)}, String(process.pid)); setInterval(() => {}, 1000)`], { stdio: 'ignore' })
  test('hang', () => new Promise(() => setInterval(() => {}, 1000)))
}

/**
 * run(file, timeoutMs) 必须调用真实runner。mock.timers只控制已排队的期限；
 * 触发前恢复真实setTimeout，让生产的杀树/回收轮询使用真实时钟。
 * finally始终触发期限，防止就绪断言失败时留下仍在运行的runner。
 */
export async function readyTreeTimeout(t, run) {
  const dir = makeTempDir('nomi-ready-timeout-')
  const parentFile = path.join(dir, 'slow.pid')
  const descendantFile = path.join(dir, 'descendant.pid')
  const file = path.join(dir, 'slow.node-test.mjs')
  fs.writeFileSync(file, `import { hangReadyTree } from ${JSON.stringify(helperUrl)}\nhangReadyTree(${JSON.stringify(parentFile)}, ${JSON.stringify(descendantFile)})\n`)
  let pids = []
  t.after(() => {
    // 仅失败清理；正常路径在返回前已经断言全死。绝不按名字或猜测的进程组清理。
    for (const pid of pids) if (alive(pid)) process.kill(pid, 'SIGKILL')
  })
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let pending
  let result
  try {
    pending = run(file, FIXTURE_TIMEOUT_MS)
    try {
      await waitFor(() => fs.existsSync(parentFile) && fs.existsSync(descendantFile), '夹具未就绪：缺少子进程或孙进程PID')
      pids = [parentFile, descendantFile].map((f) => Number(fs.readFileSync(f, 'utf8')))
      assert.notEqual(pids[0], pids[1], '子孙PID必须不同')
      for (const pid of pids) assert.equal(alive(pid), true, `超时前进程 ${pid} 必须活着`)
    } finally {
      const testSetTimeout = globalThis.setTimeout
      globalThis.setTimeout = realSetTimeout
      try {
        t.mock.timers.tick(FIXTURE_TIMEOUT_MS)
        result = await pending
      } finally { globalThis.setTimeout = testSetTimeout }
    }
  } finally { t.mock.timers.reset() }
  // 真实runner应完成收尾；额外有界等待处理操作系统PID释放，随后每一个都必须断言。
  await waitFor(() => pids.every((pid) => !alive(pid)), '超时后子进程或孙进程仍存活', 3000)
  assert.equal(pids.length, 2, '不能空过存活检查')
  for (const pid of pids) assert.equal(alive(pid), false, `超时后进程 ${pid} 必须消失`)
  return { result, file }
}
