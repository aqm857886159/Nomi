// Test-only cold process for tests/system/saveKillInFlight.test.mjs：真文件系统、真 fsync、真保存代码。
// 它保存一份约 20MB 的项目，每一版是「同一个 8 位版本号重复到固定长度」，所以任何截断 / 拼接都看得出来。
// 唯一的插桩：在第 `killSave` 次保存里，按 `killAt` 指定的时刻让自己被 SIGKILL（kill -9，不跑任何收尾）——
//   write:N   第 N 次「大块写」写到一半
//   rename    改名那一刻之前
// 时刻由代码自己卡准（不靠计时碰运气）；那个时刻在真实保存里不存在（比如只有一次大块写却要求第 2 次）就当没杀，
// 保存正常走完，盘上同样要是完整版。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

const input = JSON.parse(process.argv[2])
const root = fs.realpathSync(input.root)
if (!root.startsWith(fs.realpathSync(os.tmpdir()) + path.sep)) throw new Error('fixture must stay inside the temporary root')
const { createWorkspaceProject, saveWorkspaceProject } = await import('../../electron/workspace/workspaceRepository.ts')
const deps = { settingsRoot: path.join(root, 'settings'), defaultProjectsRoot: path.join(root, 'projects') }
const version = (n) => String(n).padStart(8, '0').repeat(input.repeat)

let currentSave = 0
let bigWrites = 0
const dieNow = () => process.kill(process.pid, 'SIGKILL')
const armed = () => currentSave === input.killSave
const [killKind, killNth] = String(input.killAt).split(':')

const realWriteFileSync = fs.writeFileSync
fs.writeFileSync = function patchedWriteFileSync(target, data, ...rest) {
  if (armed() && data && data.length > 1_000_000) {
    bigWrites += 1
    if (killKind === 'write' && bigWrites === Number(killNth)) {
      realWriteFileSync.call(fs, target, data.slice(0, Math.floor(data.length / 2)), ...rest)
      dieNow()
    }
  }
  return realWriteFileSync.call(fs, target, data, ...rest)
}
const realRenameSync = fs.renameSync
fs.renameSync = function patchedRenameSync(from, to) {
  if (armed() && killKind === 'rename' && String(to).endsWith('project.json')) dieNow()
  return realRenameSync.call(fs, from, to)
}

const created = createWorkspaceProject({ rootPath: path.join(deps.defaultProjectsRoot, 'project'), record: { name: 'kill', payload: { text: version(0) } } }, deps)
fs.writeFileSync(path.join(root, 'id.json'), JSON.stringify({ id: created.id }))
for (let n = 1; n <= input.killSave; n++) {
  currentSave = n
  process.stdout.write(`saving ${n}\n`)
  await saveWorkspaceProject(created.id, { payload: { text: version(n) } }, deps)
  process.stdout.write(`saved ${n}\n`)
}
