import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { writeFileAtomicSync } from '../../scripts/lib/atomicFile.mjs'
import { ownerIsGone } from '../../scripts/_test-temp.mjs'

export const UI_IPC_VERSION = 2
const prefix = '.nomi-ui-ipc-p'
const stageName = /^\.nomi-ui-ipc-p([1-9]\d{0,9})-[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\.tmp$/

// The final name signals completeness to the peer. The stage identifies its writer even after SIGKILL.
export function writeUiIpcFile(target, content) {
  writeFileAtomicSync(target, content, {
    fsync: false,
    tmpCreate: file => path.join(path.dirname(file), `${prefix}${process.pid}-${randomUUID()}.tmp`),
  })
}

// Called once after taking the instance lock. PID reuse, uncertain liveness, or platforms
// without process.getuid (where ownership in a shared/custom dir cannot be verified) defer cleanup.
export function reclaimUiIpcFiles(dir) {
  if (typeof process.getuid !== 'function') return []
  const uid = process.getuid()
  if (!Number.isInteger(uid)) return []
  const reclaimed = []
  for (const name of fs.readdirSync(dir)) {
    const match = stageName.exec(name)
    if (!match || !ownerIsGone(Number(match[1]))) continue
    const file = path.join(dir, name)
    try {
      const stat = fs.lstatSync(file)
      if (stat.isFile() && stat.uid === uid) {
        fs.unlinkSync(file)
        reclaimed.push(name)
      }
    } catch { /* A disappearing or busy stage can be checked again at the next startup. */ }
  }
  return reclaimed
}
