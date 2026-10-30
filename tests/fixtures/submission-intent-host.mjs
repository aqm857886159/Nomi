import fs from 'node:fs'
import process from 'node:process'
import { setTimeout as sleep } from 'node:timers/promises'
// An independent host process, with no Electron profile or credentials.
import Module from 'node:module'
import { require as load } from 'tsx/cjs/api'
const original = Module._load
Module._load = function (id, ...args) {
  if (id === 'electron') return { app: { getPath: () => process.argv[2], getName: () => 'Nomi' }, ipcMain: { on() {}, handle() {} } }
  return original.call(this, id, ...args)
}
const { createSubmissionIntent } = load('../../electron/productionRun/submissionIntent.ts', import.meta.url)

// argv[4], all optional:
//   scope         the identity to claim (the default is what the shared tests use)
//   newAttemptOf  claim an explicit new order
//   barrier       say "ready" and wait for "go", so two real processes claim at the same moment
//   waitBusyMs    keep trying while another process holds the lease
//   crashAfterOps die right after this many durable filesystem steps, the way a killed process does
//   countOps      report how many durable steps the claim took
const options = JSON.parse(process.argv[4] || '{}')
const scope = options.scope ?? ['model-trial', 'example', 'model']
const request = { vendor: scope[1], model: scope[2], kind: 'text_to_video', prompt: process.argv[3] || 'changed', params: { seed: 19 } }

let durableSteps = 0
if (options.crashAfterOps || options.countOps) {
  // Patched after the product code loaded, so only its own steps count, not the loader's. A step counts only if a
  // reader could see the difference: no fsync (a killed process leaves the page cache behind), no read-only open,
  // no mkdir of what exists, and nothing written into a temp file before the rename that publishes it.
  const tempFiles = new Set()
  for (const name of ['mkdirSync', 'openSync', 'writeSync', 'writeFileSync', 'renameSync', 'rmSync']) {
    const step = fs[name]
    fs[name] = function (...args) {
      const result = step.apply(this, args)
      if (name === 'openSync') {
        if (String(args[0]).endsWith('.tmp')) { tempFiles.add(result); return result }
        tempFiles.delete(result)
        if (!/[wa+]/.test(String(args[1] ?? 'r'))) return result
      }
      if ((name === 'writeSync' || name === 'writeFileSync') && tempFiles.has(args[0])) return result
      if (name === 'mkdirSync' && args[1]?.recursive && result === undefined) return result
      durableSteps += 1
      if (durableSteps === options.crashAfterOps) process.exit(137)
      return result
    }
  }
}

if (options.barrier) {
  await new Promise((resolve) => {
    process.once('message', resolve)
    process.send('ready')
  })
}

const intent = createSubmissionIntent({ root: process.argv[2], scope })
const deadline = Date.now() + (options.waitBusyMs ?? 0)
let out
for (;;) {
  try {
    const claimed = intent.claim(request, options.newAttemptOf)
    out = { owned: claimed.owned, receipt: intent.read(), ...(claimed.owned ? { jobId: claimed.job.jobId } : {}) }
    break
  } catch (error) {
    // Concurrent allocation is busy, never permission to dispatch another order.
    if (error.code !== 'run_lock_busy') throw error
    if (Date.now() >= deadline) { out = { owned: false, receipt: intent.read(), busy: true }; break }
    await sleep(20)
  }
}
if (options.countOps) out.durableSteps = durableSteps
fs.writeSync(1, JSON.stringify(out))
process.exit(0)
