#!/usr/bin/env node
import { runReleaseCoreCompare } from './_releaseCoreCompare.mjs'
// 夜跑清单按 *.walk.mjs 自动收这个文件，但它是发版前手动对比的演练，要 --target-root / --commit / --output：
// 不带参数就按「跳过」退出（125，夜跑汇总不算红），不拿夜跑去撞参数断言。
if (!process.argv.includes('--target-root')) {
  console.log('[release-core] 跳过：这是发版前手动对比的演练，需 --target-root / --commit / --output（见 docs/plan/2026-11-07-release-core-compare.md）')
  process.exit(125)
}
await runReleaseCoreCompare('rehearsal')
