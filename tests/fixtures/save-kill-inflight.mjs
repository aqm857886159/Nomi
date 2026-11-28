// Test-only cold process for tests/system/saveKillInFlight.test.mjs：真文件系统、真 fsync、真保存代码。
// 它保存一份约 1.6MB 的项目，每一版是「同一个 8 位版本号重复到固定长度」，所以任何截断 / 拼接都看得出来。
// 唯一的插桩：在第 `killSave` 次保存里，按 `killAt` 指定的时刻让自己被 SIGKILL（kill -9，不跑任何收尾）——
//   write:N   第 N 次「大块写」写到一半
//   rename    改名那一刻之前
// 时刻由代码自己卡准（不靠计时碰运气）；那个时刻在真实保存里不存在（比如只有两次大块写却要求第 3 次）就当没杀，
// 保存正常走完，盘上同样要是完整版。
import { Buffer } from 'node:buffer'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

const input = JSON.parse(process.argv[2])
const root = fs.realpathSync(input.root)
if (!root.startsWith(fs.realpathSync(os.tmpdir()) + path.sep)) throw new Error('fixture must stay inside the temporary root')

let currentSave = 0
let bigWrites = 0
const dieNow = () => process.kill(process.pid, 'SIGKILL')
const armed = () => currentSave === input.killSave
const [killKind, killNth] = String(input.killAt).split(':')
const openFds = new Map()

const isTargetTempPath = (filePath) => {
  const base = path.basename(String(filePath || ''))
  return base.startsWith('.project.') && base.endsWith('.tmp')
}

// stubborn-fs 在模块首次加载时按值捕获底层 fs 方法；必须在 import 保存代码之前挂上插桩。
const realOpen = fs.open.bind(fs)
const realOpenSync = fs.openSync.bind(fs)
const realClose = fs.close.bind(fs)
const realCloseSync = fs.closeSync.bind(fs)
const realWrite = fs.write.bind(fs)
const realWritev = fs.writev.bind(fs)
const realWriteSync = fs.writeSync.bind(fs)
const realWriteFileSync = fs.writeFileSync.bind(fs)
const realRename = fs.rename.bind(fs)
const realRenameSync = fs.renameSync.bind(fs)

fs.open = function patchedOpen(target, ...rest) {
  const cb = rest[rest.length - 1]
  if (typeof cb !== 'function') return realOpen(target, ...rest)
  return realOpen(target, ...rest.slice(0, -1), (err, fd) => {
    if (!err && typeof fd === 'number' && isTargetTempPath(target)) {
      openFds.set(fd, { path: String(target), written: 0, counted: false })
    }
    cb(err, fd)
  })
}
fs.openSync = function patchedOpenSync(target, ...rest) {
  const fd = realOpenSync(target, ...rest)
  if (isTargetTempPath(target)) {
    openFds.set(fd, { path: String(target), written: 0, counted: false })
  }
  return fd
}
fs.close = function patchedClose(fd, cb) {
  openFds.delete(fd)
  return realClose(fd, cb)
}
fs.closeSync = function patchedCloseSync(fd) {
  openFds.delete(fd)
  return realCloseSync(fd)
}
fs.write = function patchedWrite(fd, data, ...rest) {
  const tracked = openFds.get(fd)
  if (armed() && tracked) {
    const chunkBytes = typeof data === 'string'
      ? Buffer.byteLength(data, typeof rest[1] === 'string' ? rest[1] : 'utf8')
      : (typeof rest[1] === 'number' ? rest[1] : (data ? data.byteLength : 0))
    if (!tracked.counted && (chunkBytes > 1_000_000 || tracked.written + chunkBytes >= 800_000)) {
      tracked.counted = true
      bigWrites += 1
      if (killKind === 'write' && bigWrites === Number(killNth)) {
        if (Buffer.isBuffer(data) || ArrayBuffer.isView(data)) {
          const offset = typeof rest[0] === 'number' ? rest[0] : 0
          realWriteSync(fd, data, offset, Math.max(1, Math.floor(chunkBytes / 2)))
        }
        dieNow()
      }
    }
    tracked.written += chunkBytes
  }
  return realWrite(fd, data, ...rest)
}
fs.writev = function patchedWritev(fd, buffers, ...rest) {
  const tracked = openFds.get(fd)
  if (armed() && tracked && Array.isArray(buffers)) {
    const chunkBytes = buffers.reduce((sum, buf) => sum + (buf ? buf.byteLength : 0), 0)
    if (!tracked.counted && (chunkBytes > 1_000_000 || tracked.written + chunkBytes >= 800_000)) {
      tracked.counted = true
      bigWrites += 1
      if (killKind === 'write' && bigWrites === Number(killNth)) {
        if (buffers[0] && buffers[0].byteLength > 0) {
          realWriteSync(fd, buffers[0], 0, Math.max(1, Math.floor(buffers[0].byteLength / 2)))
        }
        dieNow()
      }
    }
    tracked.written += chunkBytes
  }
  return realWritev(fd, buffers, ...rest)
}
fs.writeSync = function patchedWriteSync(fd, data, offset, length, position) {
  const tracked = openFds.get(fd)
  const byteLength = typeof data === 'string'
    ? Buffer.byteLength(data, typeof length === 'string' ? length : 'utf8')
    : (typeof length === 'number' ? length : (data ? data.byteLength : 0))
  if (armed() && (tracked || byteLength > 1_000_000)) {
    if (!tracked || !tracked.counted) {
      if (tracked) tracked.counted = true
      bigWrites += 1
      if (killKind === 'write' && bigWrites === Number(killNth)) {
        const half = Math.max(1, Math.floor(byteLength / 2))
        if (Buffer.isBuffer(data) || ArrayBuffer.isView(data)) {
          realWriteSync(fd, data, typeof offset === 'number' ? offset : 0, half, position ?? null)
        }
        dieNow()
      }
    }
  }
  return realWriteSync(fd, data, offset, length, position)
}
fs.writeFileSync = function patchedWriteFileSync(target, data, ...rest) {
  if (armed() && data && data.length > 1_000_000) {
    bigWrites += 1
    if (killKind === 'write' && bigWrites === Number(killNth)) {
      realWriteFileSync(target, data.slice(0, Math.floor(data.length / 2)), ...rest)
      dieNow()
    }
  }
  return realWriteFileSync(target, data, ...rest)
}
fs.rename = function patchedRename(from, to, ...rest) {
  if (armed() && killKind === 'rename' && String(to).endsWith('project.json')) dieNow()
  return realRename(from, to, ...rest)
}
fs.renameSync = function patchedRenameSync(from, to) {
  if (armed() && killKind === 'rename' && String(to).endsWith('project.json')) dieNow()
  return realRenameSync(from, to)
}

const { createWorkspaceProject, saveWorkspaceProject } = await import('../../electron/workspace/workspaceRepository.ts')
const deps = { settingsRoot: path.join(root, 'settings'), defaultProjectsRoot: path.join(root, 'projects') }
const version = (n) => String(n).padStart(8, '0').repeat(input.repeat)

const created = createWorkspaceProject({ rootPath: path.join(deps.defaultProjectsRoot, 'project'), record: { name: 'kill', payload: { text: version(0) } } }, deps)
fs.writeFileSync(path.join(root, 'id.json'), JSON.stringify({ id: created.id }))
for (let n = 1; n <= input.killSave; n++) {
  currentSave = n
  process.stdout.write(`saving ${n}\n`)
  await saveWorkspaceProject(created.id, { payload: { text: version(n) } }, deps)
  process.stdout.write(`saved ${n}\n`)
}
