import process from 'node:process'
// An independent host process, with no Electron profile or credentials.
import Module from 'node:module'
import { require as load } from 'tsx/cjs/api'
const original = Module._load
Module._load = function (id, ...args) {
  if (id === 'electron') return { app: { getPath: () => process.argv[2], getName: () => 'Nomi' }, ipcMain: { on() {}, handle() {} } }
  return original.call(this, id, ...args)
}
const { createSubmissionIntent } = load('../../electron/productionRun/submissionIntent.ts', import.meta.url)
const intent = createSubmissionIntent({ root: process.argv[2], scope: ['model-trial', 'example', 'model'] })
const request = { vendor: 'example', model: 'model', kind: 'text_to_video', prompt: process.argv[3] || 'changed', params: { seed: 19 } }
try {
  const claimed = intent.claim(request)
  process.stdout.write(JSON.stringify({ owned: claimed.owned, receipt: intent.read() }))
} catch (error) {
  // Concurrent allocation is busy, never permission to dispatch another order.
  if (error.code !== 'run_lock_busy') throw error
  process.stdout.write(JSON.stringify({ owned: false, receipt: intent.read(), busy: true }))
}
