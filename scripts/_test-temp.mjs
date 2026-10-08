import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const owned = new Set()
let installed = false

function installExitCleanup() {
  if (installed) return
  installed = true
  process.once('exit', () => {
    for (const root of owned) fs.rmSync(root, { recursive: true, force: true })
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
  fs.rmSync(root, { recursive: true, force: true })
}
