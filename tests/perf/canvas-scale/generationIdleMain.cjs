/* global module */
// Test-only counters at actual main-process IPC and atomic publication boundaries.
const fs = module.require('node:fs')
const { ipcMain } = module.require('electron')
const path = module.require('node:path')
const state = { saves: [], snapshots: [], queries: 0, errors: [] }
const handle = ipcMain.handle.bind(ipcMain)
ipcMain.handle = (channel, listener) => handle(channel, function (...args) {
  if (/projects:save/.test(channel)) state.saves.push({ at: Date.now(), channel })
  return listener.apply(this, args)
})
const rename = fs.renameSync
fs.renameSync = function (from, to, ...args) {
  if (['runtime-envelope.json', 'run.json'].includes(path.basename(String(to)))) state.snapshots.push({ at: Date.now(), file: String(to) })
  return rename.call(this, from, to, ...args)
}
globalThis.__generationIdleMain = state
globalThis.__startGenerationIdleProduction = (bundle, root) => module.require(bundle).startProductionIdleFixture(root)
