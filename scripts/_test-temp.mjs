import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const owned = new Set()
// Windows 上 Electron 刚退出时，子进程还可能占着 user-data 里的文件（EBUSY / EPERM）；交给 Node 自带的重试，不手写等待。
const REMOVE_OPTIONS = Object.freeze({ recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
let installed = false

function installExitCleanup() {
  if (installed) return
  installed = true
  process.once('exit', () => {
    for (const root of owned) fs.rmSync(root, REMOVE_OPTIONS)
    owned.clear()
  })
}

export function registerTestTemp(root) {
  owned.add(root)
  installExitCleanup()
  return root
}

export function makeTempDir(prefix = 'nomi-test-') {
  return registerTestTemp(fs.mkdtempSync(path.join(os.tmpdir(), prefix)))
}

export async function makeTempDirAsync(prefix = 'nomi-test-') {
  return registerTestTemp(await fs.promises.mkdtemp(path.join(os.tmpdir(), prefix)))
}

export function cleanupTestTemp(root) {
  if (!root) return
  owned.delete(root)
  fs.rmSync(root, REMOVE_OPTIONS)
}
