// Test-only counters at actual main-process IPC and atomic publication boundaries.
const fs = require('node:fs')
const { ipcMain } = require('electron')
const state = { saves: [], snapshots: [], queries: 0, errors: [] }
const handle = ipcMain.handle.bind(ipcMain)
ipcMain.handle = (channel, listener) => handle(channel, function (...args) {
  if (/projects:save/.test(channel)) state.saves.push({ at: Date.now(), channel })
  return listener.apply(this, args)
})
const rename = fs.renameSync
fs.renameSync = function (from, to, ...args) {
  if (/[\/](runtime-envelope|run)\.json$/.test(String(to))) state.snapshots.push({ at: Date.now(), file: String(to) })
  return rename.call(this, from, to, ...args)
}
globalThis.__generationIdleMain = state
globalThis.__startGenerationIdleProduction = (bundle, root) => require(bundle).startProductionIdleFixture(root)
