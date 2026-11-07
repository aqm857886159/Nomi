// 扫描型守卫登记核对（只跑这一道，几秒）：仓库里每个「遍历源码并对全集断言」的测试，都要在 scripts/pre-push-scan-guards.mjs 有去处。
// 为什么单拆出来：这条核对原先只活在 pre-push-structure.node-test.mjs 里（整份约 33 秒），而那道门只在改到钩子自己的输入时才跑——
// 「只新增一个会扫源码的测试文件」触发不了它，推送前全绿、CI 才红（2026-10-16 一天 6 个 PR：#1202 #1203 #1207 #1209 #1210 #1211）。
// 登记类核对必须由「新增 / 改动被登记对象（测试文件）」触发，不能只由核对自己的输入触发：触发条件在 pre-push-gate-inputs.mjs 的
// GATE_INPUTS['check:scan-guard-census'].match，结构测试仍照旧在 CI 里整份跑同一个函数（scanGuardCensusProblems），本机与 CI 同一份判据。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { gitPaths } from './lib/gitPaths.mjs'
import { TEST_FILE } from './lib/scanGuardDetect.mjs'
import { PRE_PUSH_GATES, SCAN_TESTS, gateEntryFiles } from './pre-push-contracts.mjs'
import { parseContractGates } from './pre-push-gate-table.mjs'
import { gateImplementation, scanGuardProblems } from './pre-push-scan-guards.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** 只有 has() 的惰性集合：gateImplFiles 要遍历全部 CI 门岗脚本的 import 闭包（本机约 8 秒），只有出现「间接扫描」的候选时才用得上，全绿时不算。 */
function lazySet(compute) {
  let value = null
  return { has: (file) => (value ??= compute()).has(file) }
}

/** 把仓库（或夹具根）整理成 scanGuardProblems 要的输入：被跟踪的测试、推送前已登记的测试、gates:contracts 各门的命令与实现闭包。 */
export function scanGuardCensusInputs(root, trackedFiles, packageJson) {
  const gateNames = parseContractGates(packageJson.scripts['gates:contracts']).gates
  const scriptTexts = gateNames.map((name) => packageJson.scripts[name]).filter(Boolean)
  return {
    root,
    testFiles: trackedFiles.filter((file) => TEST_FILE.test(file)),
    scanTests: new Set(SCAN_TESTS.flatMap((scan) => gateEntryFiles(scan.name))),
    gateScripts: scriptTexts.join('\n'),
    gateImplFiles: lazySet(() => gateImplementation(scriptTexts, root, (file) => fs.existsSync(path.join(root, file)))),
    prePushGates: new Set(PRE_PUSH_GATES.map((gate) => gate.name)),
  }
}

/** 真仓库上的核对结果（问题列表，空 = 通过）。 */
export function scanGuardCensusProblems(root = repoRoot) {
  const tracked = gitPaths(['ls-files'], { cwd: root })
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
  return scanGuardProblems(scanGuardCensusInputs(root, tracked, packageJson))
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const problems = scanGuardCensusProblems()
  if (problems.length > 0) {
    console.error(`扫描型守卫登记核对未通过（${problems.length} 处）：\n${problems.join('\n')}`)
    process.exit(1)
  }
  console.log('扫描型守卫登记核对通过')
}
