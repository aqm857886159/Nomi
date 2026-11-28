// Preload in the two real CLI processes. Only the Electron launch is substituted.
import fs from 'node:fs'
import path from 'node:path'
import { registerHooks } from 'node:module'

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === './_launchApp.mjs' && context.parentURL?.endsWith('/ui-driver.mjs')) {
      return { url: import.meta.url, shortCircuit: true }
    }
    return nextResolve(specifier, context)
  },
})

export async function launchNomiApp() {
  return {
    app: { process: () => process, on() {} },
    win: { on() {}, async waitForLoadState() {}, async waitForTimeout() {} },
    async close() {},
  }
}
export function exitIfWalkSkipped(error) { throw error }

const dir = process.env.NOMI_UI_DIR
const jsonFiles = ['req.json', 'res.json', 'state.json']
const write = fs.writeFileSync
function recordFirstVisible(name, bytes) {
  const snapshot = path.join(dir, 'first-' + name)
  try {
    write(snapshot, bytes, { flag: 'wx' })
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error
  }
}
// Force a read between open/truncate and write. The reader sees no partial JSON
// when the writer stages elsewhere. This schedule needs only one small message.
fs.writeFileSync = function (file, data, ...options) {
  if (typeof file === 'string' && path.dirname(file) === dir && jsonFiles.includes(path.basename(file))) {
    write(file, '', ...options)
    recordFirstVisible(path.basename(file), fs.readFileSync(file))
  }
  return write(file, data, ...options)
}

const rename = fs.renameSync
fs.renameSync = function (source, target) {
  if (path.dirname(target) !== dir || !jsonFiles.includes(path.basename(target))) return rename(source, target)
  if (process.env.NOMI_TEST_CRASH_AT_STATE === '1') process.kill(process.pid, 'SIGKILL')
  // Record only the first visible inode bytes so a later rename cannot mask an earlier partial write.
  recordFirstVisible(path.basename(target), fs.readFileSync(source))
  return rename(source, target)
}
