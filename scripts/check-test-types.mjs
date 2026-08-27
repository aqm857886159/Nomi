#!/usr/bin/env node
// 测试文件类型门岗（棘轮，基线只减不增）。
//
// 为什么需要这个门岗：`pnpm typecheck` 走 tsconfig.app.json + electron/tsconfig.json，
// 两份都 exclude 了 *.test.ts；而 vitest 用 esbuild 转译，**只删类型标注、从不核对**。
// 结果是 694 个测试文件的类型无人检查——写在测试里的类型级护栏（Required<T> 夹具 /
// Record<keyof T,…> 穷尽表 / satisfies / @ts-expect-error）全是装饰品，类型漂移不报红。
// 2026-08-25 实跑一次挖出真漂移：canvasEventReplay 的 Op 联合漏了 lock 变体（生成器和
// 处理分支都有它，只有类型没有）、DesktopBridge 桩用 `as never` 盖掉了 6 个必填口子。
//
// 为什么另起一份 tsconfig.test.json 而不是删那两处 exclude：electron 的测试会 import
// src/ 下的东西（违反它 rootDir: "."）且用 ESM 顶层 await（与 module: CommonJS 冲突），
// 直接删 exclude 会炸出 112 个纯配置形状错（TS6059/TS1378/TS1343），全是噪音。
//
// 棘轮语义：基线按「文件 → 错误数」记账。
//   · src/ 已清零 → 不在基线里 → 新增任何 src 测试类型错当场报红。
//   · electron/ 与 evals/ 有存量 → 记在基线里，只许变少不许变多，后续慢慢清零。
// 重记基线：node ./scripts/check-test-types.mjs --update-baseline
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const BASELINE_FILE = path.join(repoRoot, 'scripts/test-types-baseline.json')
const PROJECT = 'tsconfig.test.json'
const NATIVE_PROJECT = 'tests/agent-runtime/tsconfig.json'
const require = createRequire(import.meta.url)
const tscBin = require.resolve('typescript/bin/tsc')

function runTypecheck(project) {
  const result = spawnSync(process.execPath, [tscBin, '-p', project, '--noEmit', '--pretty', 'false'], {
    cwd: repoRoot,
    encoding: 'utf8',
  })
  if (result.error || result.signal || result.status === null) {
    console.error(`✖ 无法运行 tsc (${project})：${result.error?.message ?? result.signal ?? 'no exit status'}`)
    process.exit(1)
  }
  return result
}

// Native node:test suites use the same strict NodeNext boundary as production.
// They have no baseline: even --update-baseline must not admit a native error.
const native = runTypecheck(NATIVE_PROJECT)
if (native.status !== 0) {
  console.error(`✖ agent-runtime 测试类型门岗未通过（必须 0 错误）\n${native.stdout}${native.stderr}`)
  process.exit(1)
}
console.log('✅ agent-runtime 测试类型通过：0 个错误')
const tsc = runTypecheck(PROJECT)

// tsc 的错误行形如：src/a/b.test.ts(12,34): error TS2345: ...
// 续行（缩进的补充说明）不计数，只认带 file(line,col) 的那一行。
const ERROR_LINE = /^([^\s(][^(]*)\((\d+),(\d+)\): error (TS\d+): (.*)$/
const perFile = new Map()
const details = new Map()
const compilerErrors = []
for (const line of `${tsc.stdout}${tsc.stderr}`.split('\n')) {
  const m = ERROR_LINE.exec(line.trim())
  if (!m) {
    if (/error TS\d+:/.test(line)) compilerErrors.push(line)
    continue
  }
  const file = m[1].replace(/\\/g, '/')
  if (/\.json$/i.test(file)) {
    compilerErrors.push(line)
    continue
  }
  perFile.set(file, (perFile.get(file) ?? 0) + 1)
  if (!details.has(file)) details.set(file, [])
  details.get(file).push(`${file}:${m[2]}  ${m[4]}: ${m[5]}`)
}

// Missing/invalid projects and compiler/process failures are not zero type debt.
if (compilerErrors.length || (tsc.status !== 0 && perFile.size === 0)) {
  console.error(`✖ 测试类型编译失败（不能记为基线）\n${tsc.stdout}${tsc.stderr}`)
  process.exit(1)
}

const current = Object.fromEntries([...perFile.entries()].sort(([a], [b]) => a.localeCompare(b)))

if (process.argv.includes('--update-baseline')) {
  fs.writeFileSync(BASELINE_FILE, `${JSON.stringify(current, null, 2)}\n`)
  const total = Object.values(current).reduce((a, b) => a + b, 0)
  console.log(`✅ 已写入测试类型基线：${Object.keys(current).length} 个文件 / ${total} 个错误`)
  process.exit(0)
}

const baseline = fs.existsSync(BASELINE_FILE) ? JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8')) : {}

const regressions = []
for (const [file, count] of Object.entries(current)) {
  const allowed = Number.isFinite(baseline[file]) ? baseline[file] : 0
  if (count > allowed) regressions.push({ file, allowed, count })
}

if (regressions.length) {
  console.log('\n✖ 测试文件类型门岗未通过（棘轮只减不增）')
  for (const { file, allowed, count } of regressions) {
    console.log(`\n  ${file}：基线 ${allowed} → 现在 ${count}（新增 ${count - allowed} 处）`)
    for (const detail of (details.get(file) ?? []).slice(0, 8)) console.log(`    ${detail}`)
  }
  console.log('\n测试文件不被 `pnpm typecheck` 覆盖，只有这道门看得见它们的类型错。')
  console.log('→ 修掉上面的类型错；确属基线下降后的重记账才跑 --update-baseline。')
  process.exit(1)
}

const totalNow = Object.values(current).reduce((a, b) => a + b, 0)
const totalBase = Object.values(baseline).reduce((a, b) => a + b, 0)
const cleared = Object.keys(baseline).filter((file) => !current[file])
if (totalNow < totalBase) {
  console.log(`✅ 测试类型门岗通过：${totalNow} 个错（基线 ${totalBase}，少了 ${totalBase - totalNow} 个）`)
  if (cleared.length) console.log(`   已清零 ${cleared.length} 个文件 → 记得跑 --update-baseline 把棘轮拧紧`)
} else {
  console.log(`✅ 测试类型门岗通过：src/ 0 错；存量 ${totalNow} 个（electron/ + evals/，棘轮只减不增）`)
}
