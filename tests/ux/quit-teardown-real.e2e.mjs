import { launchNomiApp } from './_launchApp.mjs'

const TIMEOUT_MS = 5000
const launched = await launchNomiApp({
  name: 'v-quitsafe-real-quit',
  waitForWindow: true,
  settleMs: 200,
  timeout: 60_000,
})

const processHandle = launched.app.process()
const pid = processHandle?.pid
if (!pid) throw new Error('real Electron process did not expose its own PID')

const exited = new Promise((resolve) => {
  processHandle.once('exit', (code, signal) => resolve({ code, signal }))
})
try {
  await launched.app.evaluate(({ app }) => app.quit()).catch(() => undefined)
  const result = await Promise.race([
    exited,
    new Promise((resolve) => setTimeout(() => resolve({ timeout: true }), TIMEOUT_MS)),
  ])
  if (result.timeout) {
    throw new Error(`real Electron did not exit within ${TIMEOUT_MS}ms (OWN_PID ${pid})\n${launched.mainLogTail().join('\n')}`)
  }
  console.log(`REAL_ELECTRON_QUIT ${JSON.stringify({ pid, ...result })}`)
} finally {
  if (processHandle && !processHandle.killed && processHandle.exitCode === null) processHandle.kill()
  await launched.close().catch(() => undefined)
}
