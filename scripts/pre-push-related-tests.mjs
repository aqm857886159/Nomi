// 推送前：按改动文件挑「相关单测」跑（2026-10-09 #1148：改了 build-electron.mjs，electron-build.test.mjs 必红，推送前钩子只跑固定几条，CI 才红）。
//
// 选法（不自己写 import 图，只用现成的三样东西）：
//   1. 改动文件本身就是测试 → 跑它；
//   2. 同目录、同名的测试（foo.mjs ↔ foo.test.mjs / foo.node-test.mjs，Foo.tsx ↔ Foo.test.tsx）——文件名约定；
//   3. git grep：哪些测试文件里「按引号包起来的路径 / 模块名」提到了改动文件的主名（import './foo'、'build-electron.mjs'、
//      'scripts/build-electron.mjs'）——能看见 vitest 依赖图看不见的「按文本读被测文件 / 计算路径动态 import / 拷贝文件名清单」。
//
// 为什么不用 vitest 自带的 `vitest related`（2026-10-09 在本机 Windows 实测，写给下一个想接它的人）：
//   · 它先给全部约 2000 个测试文件做 vite 转换、建好依赖图再挑，与改了几个文件无关：`related scripts/build-electron.mjs` 空转 110–140 秒；
//   · 位置参数的文件名过滤在 related 模式下不提前缩小范围（`related x --run <某个测试文件>` 仍跑了 6 分钟、跑进无关的 tests/ux）；
//   · 而且它根本没选中 electron-build.test.mjs——那个测试用 pathToFileURL 动态 import、spawn 脚本，依赖图看不见。
//   所以 related 既超预算（60–90 秒）、又漏掉今天这个实证。它的传递依赖能力我们没有（上面三条只到「直接提到」这一跳）：
//   这是已知残留，CI 是裁判；哪天 vitest 的 related 能按范围提前缩小、或有持久化的依赖图缓存，再换。
//
// 总时间有硬上限（RELATED_BUDGET_MS）：超了就终止子进程（Windows 按 PID 杀进程树，见 pre-push-contracts.mjs 的 runNode），
// 不算红，如实说「相关单测没跑完，CI 会跑」并列出文件。真红（上限内测试失败）照常拦。
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

/** 触发：改动里有这些根目录下的源码（含测试）。纯文档、配置不触发。 */
export const SOURCE_FILE = /^(?:src|electron|evals|scripts|tests)\/.*\.(?:[cm]?[jt]sx?)$/
export const NODE_TEST_FILE = /\.node-test\.mjs$/
export const VITEST_TEST_FILE = /\.test\.[cm]?[jt]sx?$/

/** 推送前入口里这一项的名字（登记在 pre-push-contracts.mjs 的 known 清单里；结构测试盯着它不被删）。 */
export const RELATED_TESTS_GATE = Object.freeze({ name: 'test:related' })
/** 整个「相关单测」阶段的时间上限（毫秒）：vitest 与 node:test 两路并行，各自受它限制。 */
export const RELATED_BUDGET_MS = 75_000
/** 一次最多跑几个测试文件；超出的按优先级截掉并如实报「CI 会跑」。 */
export const MAX_RELATED_FILES = 40

/**
 * 整份跑不进 60–90 秒、所以不进「相关单测」的测试文件：文件 → 原因。它们仍在 CI（check:claude-hooks）里跑；
 * 它们里的快用例已拆到别的文件（见原因），在推送前由自己的门岗跑。
 */
export const SLOW_TEST_FILES = Object.freeze({
  'scripts/pre-push-contracts.node-test.mjs': '真入口 / tsc 探针 / 超时用例整份 > 90 秒；其中的契约 / 结构用例已拆到 scripts/pre-push-structure.node-test.mjs（推送前门岗 test:pre-push-structure）',
})

const REFERENCE_EXT = '(\\.[cm]?[jt]sx?)?'
const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** 文件主名：去掉目录、扩展名、以及 .test / .node-test 后缀。 */
export function stemOf(file) {
  return path.posix.basename(file).replace(/\.(?:node-)?test(?=\.)/, '').replace(/\.[cm]?[jt]sx?$/, '').replace(/\.json$/, '')
}

/** 在测试文件里「按引号 / 斜杠 + 主名 + 可选扩展名 + 引号」提到该文件的正则（git grep -E）。index 文件改按它所在目录名找。 */
export function referencePattern(file) {
  const stem = stemOf(file)
  const tail = `['"\`]`
  if (stem === 'index') {
    const parent = path.posix.basename(path.posix.dirname(file))
    return `[/'"\`]${escapeRegex(parent)}(/index${REFERENCE_EXT})?${tail}`
  }
  return `[/'"\`]${escapeRegex(stem)}${REFERENCE_EXT}${tail}`
}

function gitLines(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] })
    .split('\n').map((line) => line.trim()).filter(Boolean)
}

const isTestFile = (file) => NODE_TEST_FILE.test(file) || VITEST_TEST_FILE.test(file)

/**
 * 选相关单测。files = 改动路径（origin/main...HEAD）；exclude = 已经由别的门岗跑的测试文件（不重复）。
 * 返回 { vitest: [...], node: [...], skipped: [{ file, reason }], truncated: n }；没有源码改动 → 全空。
 * 仓库根下 git 命令失败时抛错（调用方当「算不出」处理，不当通过）。
 */
export function relatedTests(files, { root, exclude = new Set(), maxFiles = MAX_RELATED_FILES } = {}) {
  const empty = { vitest: [], node: [], skipped: [], truncated: 0 }
  const sources = files.filter((file) => SOURCE_FILE.test(file))
  if (sources.length === 0) return empty
  const tracked = new Set(gitLines(root, ['ls-files', '--', '*.test.ts', '*.test.tsx', '*.test.mjs', '*.test.js', '*.test.cjs', '*.node-test.mjs']).filter(isTestFile))
  const ordered = new Map() // file → 优先级（小者先）
  const add = (file, rank) => { if (tracked.has(file) && !ordered.has(file)) ordered.set(file, rank) }
  const changedDirs = new Set(sources.map((file) => path.posix.dirname(file)))

  for (const file of sources) {
    if (isTestFile(file)) add(file, 0)
    const dir = path.posix.dirname(file)
    const stem = stemOf(file)
    for (const test of tracked) {
      if (path.posix.dirname(test) === dir && stemOf(test) === stem && test !== file) add(test, 1)
    }
  }
  // 按文本提到：一次 git grep 带上所有改动文件的模式（-l 只要文件名）。没有命中时 git grep 退出码为 1 → 当空。
  const patterns = sources.filter((file) => !isTestFile(file)).map(referencePattern)
  if (patterns.length > 0) {
    let hits = []
    try {
      hits = gitLines(root, ['grep', '-l', '-E', ...patterns.flatMap((pattern) => ['-e', pattern]), '--', '*.test.ts', '*.test.tsx', '*.test.mjs', '*.test.js', '*.test.cjs', '*.node-test.mjs'])
    } catch (error) {
      if (error.status !== 1) throw error
    }
    for (const hit of hits.sort()) add(hit, changedDirs.has(path.posix.dirname(hit)) ? 2 : 3)
  }

  const skipped = []
  const picked = []
  for (const [file] of [...ordered.entries()].sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]))) {
    if (exclude.has(file)) continue
    if (file in SLOW_TEST_FILES) { skipped.push({ file, reason: SLOW_TEST_FILES[file] }); continue }
    if (!fs.existsSync(path.join(root, file))) continue // 改动里被删掉的测试
    picked.push(file)
  }
  const kept = picked.slice(0, maxFiles)
  return {
    vitest: kept.filter((file) => VITEST_TEST_FILE.test(file)),
    node: kept.filter((file) => NODE_TEST_FILE.test(file)),
    skipped,
    truncated: picked.length - kept.length,
  }
}

/** 选出来的测试 → 要起的子进程（node 的 argv）。vitest 车道外的文件，vitest 自己按配置的 include 过滤掉（--passWithNoTests 不当红）。 */
export function relatedRuns(selection) {
  const runs = []
  if (selection.vitest.length > 0) runs.push({ label: 'vitest', files: selection.vitest, argv: ['node_modules/vitest/vitest.mjs', 'run', '--reporter=dot', '--passWithNoTests', ...selection.vitest] })
  if (selection.node.length > 0) runs.push({ label: 'node:test', files: selection.node, argv: ['--test', ...selection.node] })
  return runs
}

/**
 * 跑相关单测，返回一道门岗结果 { name, status, output, ms, note }。run = runNode（由入口注入，避免循环 import）。
 * 超时（status 124）不算红：note 点名「没跑完，CI 会跑」和文件；有任何一路真红（非 124 的非零）就红。
 */
export async function runRelatedTests(selection, run, { budgetMs = RELATED_BUDGET_MS } = {}) {
  const started = Date.now()
  const runs = relatedRuns(selection)
  const notes = []
  if (runs.length === 0) {
    return { name: RELATED_TESTS_GATE.name, status: 0, output: '', ms: Date.now() - started, note: describeEmpty(selection) }
  }
  // NODE_TEST_CONTEXT 从子进程环境里删掉（runNode 把 undefined 当删除）：钩子若被包在外层 node --test 里，子进程里的 node --test 会因它而不真跑（假绿）
  const results = await Promise.all(runs.map(async (item) => ({ item, result: await run(item.argv, { NODE_TEST_CONTEXT: undefined }, { timeoutMs: budgetMs, name: `${RELATED_TESTS_GATE.name}(${item.label})` }) })))
  let status = 0
  let output = ''
  for (const { item, result } of results) {
    if (result.status === 124) {
      notes.push(`相关单测没跑完（${item.label}，超过 ${budgetMs / 1000} 秒上限），CI 会跑：${item.files.join('、')}`)
      continue
    }
    if (result.status !== 0) { status = result.status; output += `${result.output}\n` }
    else notes.push(`${item.label} ${item.files.length} 个文件通过`)
  }
  if (selection.truncated > 0) notes.push(`另有 ${selection.truncated} 个相关单测超出单次上限（${MAX_RELATED_FILES} 个）没挑进来，CI 会跑`)
  for (const item of selection.skipped) notes.push(`${item.file} 太慢没跑，CI 会跑（${item.reason}）`)
  return { name: RELATED_TESTS_GATE.name, status, output, ms: Date.now() - started, note: notes.join('；') }
}

function describeEmpty(selection) {
  const notes = ['没有找到相关单测（改动文件没有同名测试，也没有测试文件提到它）']
  for (const item of selection.skipped) notes.push(`${item.file} 太慢没跑，CI 会跑（${item.reason}）`)
  return notes.join('；')
}
