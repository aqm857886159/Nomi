// Test-only cold process for tests/system/quarantineKillInFlight.test.mjs：真文件系统、真隔离区写入代码。
// 写一项约 1.6MB 的隔离内容；phase=kill 时在那次大块写写到一半让自己被 SIGKILL（kill -9，不跑任何收尾）。
// phase=write 正常写一遍（强杀之后同一份内容再写，必须写出完整文件）。
import { Buffer } from 'node:buffer'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

const input = JSON.parse(process.argv[2])
const root = fs.realpathSync(input.root)
if (!root.startsWith(fs.realpathSync(os.tmpdir()) + path.sep)) throw new Error('fixture must stay inside the temporary root')

// stubborn-fs 在模块首次加载时按值捕获 fs.writeSync；必须在 import 隔离区代码之前挂上插桩。
if (input.phase === 'kill') {
  const realWriteSync = fs.writeSync.bind(fs)
  fs.writeSync = function patchedWriteSync(fd, data, offset, length, position) {
    const byteLength = typeof data === 'string'
      ? Buffer.byteLength(data, typeof length === 'string' ? length : 'utf8')
      : (typeof length === 'number' ? length : (data ? data.byteLength : 0))
    if (byteLength > 1_000_000) {
      const half = Math.max(1, Math.floor(byteLength / 2))
      if (typeof data === 'string') {
        realWriteSync(fd, data.slice(0, half), typeof offset === 'number' ? offset : null, typeof length === 'string' ? length : 'utf8')
      } else {
        realWriteSync(fd, data, typeof offset === 'number' ? offset : 0, half, position ?? null)
      }
      process.kill(process.pid, 'SIGKILL')
    }
    return realWriteSync(fd, data, offset, length, position)
  }
}

const { writeQuarantineItems } = await import('../../electron/projects/projectQuarantine.ts')
const item = { container: 'storyboardDesign', field: 'status', raw: { id: 'd1', title: '我的分镜', prompt: 'q'.repeat(1_600_000) } }

const out = writeQuarantineItems(root, [item])
process.stdout.write(`${JSON.stringify(out)}\n`)
