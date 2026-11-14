// 批量演练的纯判据（2026-11-15）：挑哪些脚本、日志 → 一句原因。单独成文件：批量命令要遍历 tests/ux、跑 git，
// 单测只测这里的纯函数，不 import 那份会遍历目录的命令行（扫描型守卫识别器按 import 闭包判）。
import path from 'node:path'

import { PAID_WALKS_WITHOUT_OPEN_PAID_WALK } from './_paidRun.mjs'

/** 要演练的脚本：tests/ux 下所有 *.paid.mjs，去掉不走 openPaidWalk 的例外表（它们没有演练开关）。 */
export function rehearsalTargets(files, exceptions = PAID_WALKS_WITHOUT_OPEN_PAID_WALK) {
  const excluded = new Set(exceptions.map((entry) => path.basename(entry.file)))
  return files.filter((file) => file.endsWith('.paid.mjs') && !excluded.has(file)).sort()
}

/** 日志 → 一句原因：最后一句 [rehearsal]，没有就最后一句像错误的行。 */
export function reasonFromLog(text) {
  const lines = String(text).split('\n').map((line) => line.trim()).filter(Boolean)
  const tagged = lines.filter((line) => line.startsWith('[rehearsal]')).at(-1)
  if (tagged) return tagged.replace(/^\[rehearsal\]\s*/, '')
  const error = lines.filter((line) => /Error|拒跑|失败|不过|throw/i.test(line) && !line.startsWith('at ')).at(-1)
  return (error ?? lines.at(-1) ?? '没有输出').slice(0, 300)
}
