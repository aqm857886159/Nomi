import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

export const WALK_INSTANCE_DIR = path.join(os.tmpdir(), 'nomi-walk-instances')

function ensureRegistryDir(registryDir) { fs.mkdirSync(registryDir, { recursive: true }) }

function isAlive(pid) {
  try { process.kill(pid, 0); return true } catch (error) { return error?.code === 'EPERM' }
}

export function registerWalkInstance({ pid, worktree, registryDir = WALK_INSTANCE_DIR, startedAt = new Date().toISOString() }) {
  if (!Number.isInteger(pid) || pid <= 0) throw new TypeError(`invalid walk instance pid: ${pid}`)
  if (typeof worktree !== 'string' || !worktree) throw new TypeError('walk instance worktree is required')
  ensureRegistryDir(registryDir)
  const file = path.join(registryDir, `${pid}-${randomUUID()}.json`)
  fs.writeFileSync(file, JSON.stringify({ pid, worktree: path.resolve(worktree), startedAt }) + '\n', 'utf8')
  let cleaned = false
  return { file, cleanup: () => { if (!cleaned) { cleaned = true; try { fs.rmSync(file, { force: true }) } catch {} } } }
}

/** Playwright's Electron test double may omit ChildProcess fields; real launches always expose pid/once. */
export function registerWalkProcess(processHandle, { allowUntrackedProcessForTest = false, name = 'walk', ...options } = {}) {
  if (!Number.isInteger(processHandle?.pid) || typeof processHandle?.once !== 'function') {
    if (allowUntrackedProcessForTest) return { file: null, cleanup: () => {} }
    throw new Error(`[${name}] Electron launch returned a process handle without pid/once; cannot register the walk instance`)
  }
  const registration = registerWalkInstance({ pid: processHandle.pid, ...options })
  processHandle.once('exit', registration.cleanup)
  return registration
}

export function readLiveWalkInstances({ worktree, registryDir = WALK_INSTANCE_DIR, isProcessAlive = isAlive } = {}) {
  if (typeof worktree !== 'string' || !worktree) throw new TypeError('walk instance worktree is required')
  ensureRegistryDir(registryDir)
  const target = path.resolve(worktree)
  const live = []
  for (const entry of fs.readdirSync(registryDir)) {
    if (!entry.endsWith('.json')) continue
    const file = path.join(registryDir, entry)
    let record
    try { record = JSON.parse(fs.readFileSync(file, 'utf8')) } catch { fs.rmSync(file, { force: true }); continue }
    if (path.resolve(record.worktree || '') !== target || !Number.isInteger(record.pid) || record.pid <= 0) continue
    if (isProcessAlive(record.pid)) live.push({ ...record, file })
    else fs.rmSync(file, { force: true })
  }
  return live
}
