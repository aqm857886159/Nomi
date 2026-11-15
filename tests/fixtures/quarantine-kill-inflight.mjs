// Test-only cold process for tests/system/quarantineKillInFlight.test.mjs：真文件系统、真隔离区写入代码。
// 写一项约 1.6MB 的隔离内容；phase=kill 时在那次大块写写到一半让自己被 SIGKILL（kill -9，不跑任何收尾）。
// phase=write 正常写一遍（强杀之后同一份内容再写，必须写出完整文件）。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

const input = JSON.parse(process.argv[2])
const root = fs.realpathSync(input.root)
if (!root.startsWith(fs.realpathSync(os.tmpdir()) + path.sep)) throw new Error('fixture must stay inside the temporary root')
const { writeQuarantineItems } = await import('../../electron/projects/projectQuarantine.ts')
const item = { container: 'storyboardDesign', field: 'status', raw: { id: 'd1', title: '我的分镜', prompt: 'q'.repeat(1_600_000) } }

if (input.phase === 'kill') {
  const realWriteFileSync = fs.writeFileSync
  fs.writeFileSync = function patchedWriteFileSync(target, data, ...rest) {
    if (data && data.length > 1_000_000) {
      realWriteFileSync.call(fs, target, data.slice(0, Math.floor(data.length / 2)), ...rest)
      process.kill(process.pid, 'SIGKILL')
    }
    return realWriteFileSync.call(fs, target, data, ...rest)
  }
}
const out = writeQuarantineItems(root, [item])
process.stdout.write(`${JSON.stringify(out)}\n`)
