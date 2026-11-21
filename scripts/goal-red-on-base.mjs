#!/usr/bin/env node
// 目标测试在「什么都不做」的版本上红不红——真的跑一遍，不靠任务书里写没写这句话。
//
//   node scripts/goal-red-on-base.mjs [--base <提交>] [--head <提交>] [--report-only] [--timeout-ms <毫秒>] -- <目标测试文件…>
//   node scripts/goal-red-on-base.mjs --changed            # 普查：这条分支改过的全部测试文件，只报不判
//
// 做法：在系统临时目录里摆出「修前的生产代码 + 这条分支的测试」——生产文件取合并基点的版本，
// 测试一侧的文件（测试、夹具、测试支撑）取这条分支的版本——然后跑点名的目标测试，逐条归类：
//   · 断言红：修前的代码走到了断言，结果不对。合格。
//   · 崩溃红：修前的生产代码自己抛了错，或等不到结果超时。合格（最好再补一条对结果的断言）。
//   · 加载红：测试一侧直接用了修前不存在的模块 / 符号（TypeError、找不到模块）。不合格：
//             这条测试区分不了「没修好」和「符号还没建」，它没有经过修前就存在的入口。
//   · 绿：修前也过。只有绿的文件证明不了这次修复。
// 一份文件：有加载红 → 不合格；没有任何红 → 不合格；其余合格。
//
// 缘起（2026-11-21 复盘）：原则「判据要能失败」11-17 起写进技能和派工检查，执行点只查任务书里有没有这句话；
// 之后「什么都不做是 TypeError 不是断言失败」仍由独立验收第一次发现，每次多付一轮。
//
// 拦不住的（照实写）：造不出「全部拦下」的版本；看不出断言停在中间状态；只认 vitest 车道的测试文件。
// 真实工作区一个字节都不碰；临时目录由仓库共用的 makeTempDir 发放和回收。
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { makeTempDir } from './_test-temp.mjs'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
/** 不含会被测试 import 的代码的大目录：不拷，链到真实仓库（只读）。 */
const LINKED_DIRS = ['docs', 'marketing', 'outputs', 'skills']
/** 一次跑的上限：目标测试是定向的几份文件，十分钟还没完就是挂住了。 */
const DEFAULT_TIMEOUT_MS = 10 * 60_000
/** 和 vitest.config.ts 的默认车道同一组后缀；.test.mts 等走别的跑法，这里明说未支持。 */
const VITEST_FILE = /\.test\.(?:ts|tsx|mjs)$/
const TEST_SIDE = [
  /\.(?:test|spec)\.[cm]?[jt]sx?$/,
  /\.node-test\.mjs$/,
  /(?:^|\/)tests?\//,
  /(?:^|\/)(?:testSupport|__fixtures__|__mocks__|fixtures)\//,
]

/** 测试一侧的文件：取分支版本；其余都算生产，取修前版本。 */
export function isTestSide(file) {
  const posix = file.replaceAll('\\', '/')
  return TEST_SIDE.some((re) => re.test(posix))
}

/**
 * 名字看不出来的测试辅助（…TestUtils、…TestHelpers、.testkit、以后的新叫法）：不猜名字，看谁在用它。
 * 改动文件里，有人引用、且引用它的全是测试一侧的文件（或同样只被测试用的辅助），就算测试一侧。
 * importersOf(file) 返回引用它的文件；没人引用的不算（配置、入口文件照旧算生产）。
 */
export function testOnlyHelpers(changedFiles, importersOf) {
  const helpers = new Set()
  const candidates = changedFiles.filter((file) => !isTestSide(file) && /\.[cm]?[jt]sx?$/.test(file))
  const importers = new Map(candidates.map((file) => [file, importersOf(file).filter((other) => other !== file)]))
  for (let grew = true; grew;) {
    grew = false
    for (const file of candidates) {
      const users = importers.get(file)
      if (helpers.has(file) || !users.length || !users.every((user) => isTestSide(user) || helpers.has(user))) continue
      helpers.add(file)
      grew = true
    }
  }
  return helpers
}

const ASSERTION = /^(?:AssertionError\b|TestingLibraryElementError\b|Error: expect\()|\bERR_ASSERTION\b/
const MODULE_MISSING = /Failed to resolve import|Cannot find module|ERR_MODULE_NOT_FOUND|does not provide an export named|Failed to load url/
const MISSING_SYMBOL = /^(?:TypeError|ReferenceError)\b/
const STACK_FRAME = /^\s*(?:at |❯ )(?:.*?\()?((?:file:\/\/)?[^()\s]+?):\d+:\d+\)?\s*$/

/** 失败信息里第一帧所在的文件（没有栈就返回空串）。 */
export function topFrameFile(message) {
  for (const line of String(message).split('\n').slice(1)) {
    const match = STACK_FRAME.exec(line)
    if (match) return match[1].startsWith('file://') ? fileURLToPath(match[1]) : match[1]
  }
  return ''
}

/**
 * 一条失败归哪一类。root 是临时副本的根，用来把栈里的绝对路径换成仓库相对路径再判是不是测试一侧。
 * 缺符号类错误只有第一帧落在测试一侧才算加载红；落在生产代码里的是修前代码自己的崩溃。
 */
export function classifyFailure(message, root = '') {
  const text = String(message).trimStart()
  if (ASSERTION.test(text)) return 'assertion'
  if (MODULE_MISSING.test(text)) return 'load'
  if (MISSING_SYMBOL.test(text)) {
    const frame = topFrameFile(text)
    const relative = root && frame.startsWith(root) ? path.relative(root, frame) : frame
    if (!frame || isTestSide(relative)) return 'load'
  }
  return 'crash'
}

/** 一份文件的结论。tests: [{ kind: 'assertion' | 'crash' | 'load' | 'green' | 'skipped' }]；suiteError 是没收集到任何用例时的整份错误。 */
export function fileVerdict({ tests, suiteError = '' }) {
  const count = (kind) => tests.filter((entry) => entry.kind === kind).length
  const counts = { assertion: count('assertion'), crash: count('crash'), load: count('load'), green: count('green'), skipped: count('skipped') }
  if (suiteError && tests.length === 0) return { ok: false, counts, reason: `整份文件在修前代码上加载不起来（${suiteError.split('\n', 1)[0].slice(0, 160)}）` }
  if (counts.load > 0) return { ok: false, counts, reason: `${counts.load} 条是加载红：直接用了修前不存在的模块或符号，改成经过修前就存在的入口来验结果` }
  if (counts.assertion + counts.crash === 0) return { ok: false, counts, reason: '修前代码上全绿：这份测试证明不了这次修复' }
  return { ok: true, counts, reason: counts.assertion === 0 ? '只有崩溃红，建议补一条对结果的断言' : '' }
}

/** 把 vitest JSON 报告转成 [{ file, tests, suiteError }]；file 是仓库相对路径。 */
export function readVitestReport(report, root) {
  const realRoot = fs.existsSync(root) ? fs.realpathSync(root) : root
  const relative = (name) => {
    for (const base of [realRoot, root]) if (name.startsWith(base + path.sep)) return path.relative(base, name).replaceAll('\\', '/')
    return name
  }
  return (report.testResults ?? []).map((suite) => ({
    file: relative(suite.name),
    suiteError: suite.status === 'failed' && (suite.assertionResults ?? []).length === 0 ? String(suite.message ?? '加载失败') : '',
    tests: (suite.assertionResults ?? []).map((entry) => ({
      name: entry.fullName ?? entry.title,
      kind: entry.status === 'passed' ? 'green' : entry.status === 'failed' ? classifyFailure((entry.failureMessages ?? []).join('\n'), realRoot) : 'skipped',
      message: (entry.failureMessages ?? []).join('\n').split('\n', 1)[0].slice(0, 200),
    })),
  }))
}

const git = (args, options = {}) => execFileSync('git', args, { cwd: REPO_ROOT, maxBuffer: 256 * 1024 * 1024, ...options })
const gitText = (args) => git(args, { encoding: 'utf8' }).trim()

/** 分支上哪些代码文件引用了这份文件（按「引用路径以它的文件名结尾」找；同名文件会算在一起，只会让结果偏向「算生产」）。 */
function importersAt(head, file) {
  const stem = path.posix.basename(file).replace(/\.[cm]?[jt]sx?$/, '')
  const escaped = stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  try {
    return gitText(['grep', '-l', '-E', `(from|import|require\\()[[:space:]]*\\(?['"][^'"]*/${escaped}(\\.[cm]?[jt]sx?)?['"]`, head, '--', '*.ts', '*.tsx', '*.mjs', '*.js', '*.mts', '*.cts'])
      .split('\n').filter(Boolean).map((line) => line.slice(line.indexOf(':') + 1))
  } catch (error) {
    if (error.status === 1) return [] // git grep 没找到任何引用
    throw error
  }
}

/** 修前生产代码 + 分支测试的副本。返回 { root, links }；links 要先拆再删目录。 */
function buildCopy({ base, head }) {
  const root = makeTempDir('nomi-goal-red-')
  const links = []
  const top = gitText(['ls-tree', '--name-only', base]).split('\n').filter(Boolean)
  const copied = top.filter((name) => !LINKED_DIRS.includes(name))
  const archive = git(['archive', '--format=tar', base, '--', ...copied])
  const untar = spawnSync('tar', ['-x', '-C', root], { input: archive, maxBuffer: 16 * 1024 * 1024 })
  if (untar.status !== 0) throw new Error(`解出修前代码失败：${untar.stderr}`)
  for (const name of [...LINKED_DIRS, 'node_modules']) {
    const source = path.join(REPO_ROOT, name)
    if (!fs.existsSync(source)) continue
    fs.symlinkSync(source, path.join(root, name), 'junction')
    links.push(path.join(root, name))
  }
  const changed = gitText(['diff', '--name-only', '--diff-filter=AMR', base, head]).split('\n').filter(Boolean)
  const helpers = testOnlyHelpers(changed, (file) => importersAt(head, file))
  const testSide = (file) => isTestSide(file) || helpers.has(file)
  const overlaid = changed.filter((file) => testSide(file) && !LINKED_DIRS.includes(file.split('/')[0]))
  for (const file of overlaid) {
    const target = path.join(root, file)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, git(['show', `${head}:${file}`]))
  }
  return { root, links, changed, overlaid, productionChanged: changed.filter((file) => !testSide(file)).length }
}

function removeCopy({ root, links }) {
  for (const link of links) { try { fs.unlinkSync(link) } catch { /* 已经没了 */ } }
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}

/** 整组结束：vitest 的 worker 和测试自己起的浏览器都在同一个进程组里（Windows 用 taskkill /T）。 */
function killTree(child) {
  try {
    if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'])
    else process.kill(-child.pid, 'SIGKILL')
  } catch { /* 已经退出 */ }
}

/** 在副本里跑 vitest；超过 timeoutMs 整组结束并返回 { timedOut: true }——挂住的测试不许把工具也挂住。 */
function runVitest(root, files, timeoutMs) {
  const output = path.join(root, '.goal-red-result.json')
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(REPO_ROOT, 'node_modules', 'vitest', 'vitest.mjs'), 'run', ...files, '--reporter=json', `--outputFile=${output}`], {
      cwd: root, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, NO_PROXY: '127.0.0.1,localhost', CI: '1' },
    })
    let tail = ''
    const keep = (chunk) => { tail = (tail + chunk).slice(-1500) }
    child.stdout.on('data', keep)
    child.stderr.on('data', keep)
    const timer = setTimeout(() => { killTree(child); resolve({ timedOut: true }) }, timeoutMs)
    child.on('error', (error) => { clearTimeout(timer); reject(error) })
    child.on('exit', (code) => {
      clearTimeout(timer)
      if (fs.existsSync(output)) resolve({ report: JSON.parse(fs.readFileSync(output, 'utf8')) })
      else reject(new Error(`vitest 没有产出报告（退出码 ${code}）：\n${tail}`))
    })
  })
}

export function parseArgs(argv) {
  const options = { base: '', head: 'HEAD', reportOnly: false, changed: false, timeoutMs: DEFAULT_TIMEOUT_MS, files: [] }
  const rest = [...argv]
  while (rest.length) {
    const arg = rest.shift()
    if (arg === '--') { options.files.push(...rest.splice(0)); break }
    if (arg === '--base') options.base = rest.shift() ?? ''
    else if (arg === '--head') options.head = rest.shift() ?? ''
    else if (arg === '--report-only') options.reportOnly = true
    else if (arg === '--changed') options.changed = true
    else if (arg === '--timeout-ms') options.timeoutMs = Number(rest.shift()) || DEFAULT_TIMEOUT_MS
    else options.files.push(arg)
  }
  return options
}

/** 跑一遍并返回逐文件结论；不打印、不设退出码，回放和测试都用它。 */
export async function evaluate({ base, head = 'HEAD', files = [], changed = false, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  const resolvedBase = base ? gitText(['rev-parse', base]) : gitText(['merge-base', 'origin/main', head])
  const resolvedHead = gitText(['rev-parse', head])
  const copy = buildCopy({ base: resolvedBase, head: resolvedHead })
  try {
    const targets = (changed ? copy.overlaid.filter((file) => VITEST_FILE.test(file)) : files).map((file) => file.replaceAll('\\', '/'))
    const unsupported = targets.filter((file) => !VITEST_FILE.test(file))
    const missing = targets.filter((file) => VITEST_FILE.test(file) && !fs.existsSync(path.join(copy.root, file)))
    const runnable = targets.filter((file) => !unsupported.includes(file) && !missing.includes(file))
    const run = runnable.length ? await runVitest(copy.root, runnable, timeoutMs) : { report: { testResults: [] } }
    const suites = run.timedOut ? [] : readVitestReport(run.report, copy.root)
    const results = runnable.map((file) => {
      if (run.timedOut) return { file, ok: false, counts: null, tests: [], reason: `超过 ${Math.round(timeoutMs / 1000)} 秒没跑完，已结束：把会挂住的测试拿出去单独跑（--timeout-ms 可调）` }
      const suite = suites.find((entry) => entry.file === file) ?? { tests: [], suiteError: 'vitest 没有跑到这份文件（不在测试车道里，或被配置排除）' }
      return { file, ...fileVerdict(suite), tests: suite.tests }
    })
    for (const file of unsupported) results.push({ file, ok: false, counts: null, tests: [], reason: '未支持：只认 vitest 车道的测试文件（node:test 的文件请另附修前红的输出）' })
    for (const file of missing) results.push({ file, ok: false, counts: null, tests: [], reason: '这份文件在分支上不存在' })
    return { base: resolvedBase, head: resolvedHead, results, productionChanged: copy.productionChanged }
  } finally {
    removeCopy(copy)
  }
}

export function formatResults({ base, head, results, productionChanged }) {
  const lines = [`修前 ${base.slice(0, 9)} 的生产代码（这条分支改了 ${productionChanged} 个生产文件，全部退回） + ${head.slice(0, 9)} 的测试：`]
  for (const entry of results) {
    const counts = entry.counts ? `断言红 ${entry.counts.assertion} · 崩溃红 ${entry.counts.crash} · 加载红 ${entry.counts.load} · 绿 ${entry.counts.green}` : '—'
    lines.push(`${entry.ok ? '合格  ' : '不合格'} ${entry.file}｜${counts}${entry.reason ? `｜${entry.reason}` : ''}`)
    for (const test of entry.tests.filter((item) => item.kind === 'load').slice(0, 5)) lines.push(`         加载红：${test.name} —— ${test.message}`)
  }
  return lines.join('\n')
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv)
  if (!options.changed && options.files.length === 0) {
    console.error('用法：node scripts/goal-red-on-base.mjs [--base <提交>] [--head <提交>] [--report-only] -- <目标测试文件…>｜--changed')
    return 2
  }
  const outcome = await evaluate(options)
  console.log(formatResults(outcome))
  if (outcome.results.length === 0) console.log('（这条分支没有改到 vitest 车道的测试文件）')
  const failed = outcome.results.some((entry) => !entry.ok)
  return failed && !options.reportOnly && !options.changed ? 1 : 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = await main()
