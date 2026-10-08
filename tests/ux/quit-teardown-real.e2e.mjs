// Real Electron quit receipt for the single quit owner (electron/quitTeardown.ts).
//
// Contract: the owner budget starts at will-quit (3000ms). Built-in drains run serially
// background-lifecycle -> capability-core -> active-exports -> desktop-lane-ipc, every step
// leaves a `quit-step` receipt, and the owner ends the process with one `quit-exit` receipt.
//
// Why the limits are this tight (V-1125, 2026-10-08): the owner used to finish a successful
// teardown by calling app.quit() again. When the drains settle inside the will-quit dispatch,
// Electron is still "quitting" and swallows that call, so the process never exited. origin/main
// hid the same swallow behind a 3s force-exit timer, and a "did it exit within 5s" check passed
// on that backstop. So this test requires a completed (not deadline) exit well inside the budget.
import path from 'node:path'
import { launchNomiApp, repoRoot } from './_launchApp.mjs'

const OWNER_BUDGET_MS = 3000
const COMPLETED_EXIT_LIMIT_MS = 1500
const HARD_WAIT_MS = OWNER_BUDGET_MS + 2000
const BUILT_IN_ORDER = ['background-lifecycle', 'capability-core', 'active-exports', 'desktop-lane-ipc']

function receipts(lines, event) {
  return lines
    .filter((line) => line.includes(`[nomi:main] ${event} `))
    .map((line) => Object.fromEntries([...line.matchAll(/(\w+)=(\S+)/g)].map((match) => [match[1], match[2]])))
}

const launched = await launchNomiApp({
  name: 'quit-teardown-real',
  waitForWindow: true,
  settleMs: 1500,
  timeout: 60_000,
  // Never show a window on the machine running the test.
  mainRequire: [path.join(repoRoot, 'tests/ux/_offscreenWindows.cjs')],
})

const processHandle = launched.app.process()
const pid = processHandle?.pid
if (!pid) throw new Error('real Electron process did not expose its own PID')

const startedAt = Date.now()
const exited = new Promise((resolve) => {
  processHandle.once('exit', (code, signal) => resolve({ code, signal, elapsedMs: Date.now() - startedAt }))
})
try {
  await launched.app.evaluate(({ app }) => app.quit()).catch(() => undefined)
  const result = await Promise.race([
    exited,
    new Promise((resolve) => setTimeout(() => resolve({ timeout: true }), HARD_WAIT_MS)),
  ])
  const log = launched.mainLogTail()
  const failures = []
  if (result.timeout) failures.push(`process still alive ${HARD_WAIT_MS}ms after app.quit()`)
  else {
    if (result.code !== 0) failures.push(`exit code ${result.code} (signal ${result.signal})`)
    if (result.elapsedMs > COMPLETED_EXIT_LIMIT_MS) failures.push(`exit took ${result.elapsedMs}ms > ${COMPLETED_EXIT_LIMIT_MS}ms (deadline backstop, not a completed teardown)`)
  }
  const steps = receipts(log, 'quit-step')
  // Optional drains (watchdog, catalog) run beside the serial chain; the built-ins must keep their order.
  const order = steps.map((step) => step.step).filter((name) => BUILT_IN_ORDER.includes(name))
  if (order.join(',') !== BUILT_IN_ORDER.join(',')) failures.push(`drain order ${JSON.stringify(order)} != ${JSON.stringify(BUILT_IN_ORDER)}`)
  const slow = steps.filter((step) => step.outcome !== 'done')
  if (slow.length) failures.push(`drains not done: ${JSON.stringify(slow)}`)
  const exits = receipts(log, 'quit-exit')
  if (exits.length !== 1 || exits[0].reason !== 'completed' || exits[0].code !== '0') failures.push(`exit receipt ${JSON.stringify(exits)} != one completed code=0`)
  if (failures.length) {
    throw new Error(`real Electron quit broke the owner contract (OWN_PID ${pid}):\n- ${failures.join('\n- ')}\n${log.join('\n')}`)
  }
  console.log(`REAL_ELECTRON_QUIT ${JSON.stringify({ pid, ...result, steps: steps.map((step) => `${step.step}:${step.ms}ms`), exit: exits[0] })}`)
} finally {
  // Only the process this test started, by its own PID.
  if (processHandle.exitCode === null && processHandle.signalCode === null) {
    try { process.kill(pid) } catch { /* already gone */ }
  }
  await launched.close().catch(() => undefined)
}
