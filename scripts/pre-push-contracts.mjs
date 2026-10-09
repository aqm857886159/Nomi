#!/usr/bin/env node
// pre-push 钩子的唯一入口（2026-10-08）：推送前自动跑「按改动范围选出的本机 Contracts 门岗」，一次跑完、一次列出全部失败项。
//
// 为什么要它（10-08 晚一小时实据）：#1129 / #1131 / #1114 / #1094 在 CI 的 Contracts 上白耗了好几轮（每轮约 40 分钟），
// 撞的全是本机几秒就能跑完的门岗——filesize、prior-art、self-written、test-waits、boundary-owners、mjs-parse、
// ipc-sender-binding、pr-judgement、lint。子 agent 的自述是「任务书没写要跑哪些」。靠任务书写是最弱的补法，
// 所以改成推送时自动跑：门岗清单与命令来自 package.json 的 gates:contracts（只此一份，不另抄命令），本文件只存「哪些快、
// 在哪些改动下才需要跑」。
//
// 三条边界（写死，别靠猜）：
//   · 没有绕过开关，也没有任何让门岗集合变小的参数：入口只认 --list，以及 git 钩子传入的 <remote名> <url> 两个位置参数
//     （不改变门岗集合），其余参数（含空值）一律报错退出。
//   · 只有作为钩子被调用（分发器设的 NOMI_GIT_HOOK_DISPATCH=pre-push 标记 + 收到 <remote名> <url>，缺一不可）才读 stdin 的 ref 行；手动跑（无参数）不读 stdin、按「推当前 HEAD」检查——
//     子 agent 的 shell 里 stdin 是永不关闭的管道，读它会一直挂（2026-10-09 挂了 600–1700 秒）。
//   · 取不到 origin/main = 全部门岗都跑（宁可多跑，不拿算不出来当通过）。
//   · 超过 60 秒的门岗不放进推送前（见 SLOW_GATES），它们仍在 CI 的 Contracts 里；清单和理由写在下面。
//
// 用法（钩子自动调；手动重跑同一套）：
//   node scripts/pre-push-contracts.mjs [--list]          手动跑；正文用 NOMI_PR_BODY / NOMI_PR_BODY_FILE，都没给则 gh 现取（有超时）
//   node scripts/pre-push-contracts.mjs <remote名> <url>   钩子调用（git 通过 stdin 传 ref 行）
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { resolvePullRequestBody } from './lib/prBody.mjs'
import { touchesGateInputs } from './pre-push-gate-inputs.mjs'
import { CI_ONLY, PARTIAL_LOCAL } from './pre-push-gate-table.mjs'
import { classifyValidationPolicy } from './validation-policy.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** 同时跑几个门岗：mjs-parse 自己就开 8 个子进程，再叠太多反而更慢。 */
export const CONCURRENCY = Math.min(6, Math.max(3, os.availableParallelism() - 2))
/** 失败时回放每个门岗输出的最后几行——够定位，不灌屏。 */
export const FAILURE_TAIL_LINES = 25

const CODE_FILE = /^(?:src|electron|evals|scripts|tests)\/.*\.(?:[cm]?[jt]sx?)$/
const SCRIPT_FILE = /^(?:scripts|tests|evals)\/.*\.(?:mjs|cjs)$/

/**
 * 放进推送前的门岗。name 必须是 package.json gates:contracts 里的 check，命令取它的 package.json 脚本（见 gateCommands）。
 * when: 什么改动才需要跑（null = 总跑）。选的依据是「这道门看哪片地」：
 *   filesize / self-written / prior-art / boundary-owners 看的是登记表与全仓体积，改什么都可能碰到 → 总跑；
 *   test-waits / mjs-parse / ipc-sender-binding 只看代码，且各自只看一片地 → 该片地没动就不跑。
 */
export const PRE_PUSH_GATES = Object.freeze([
  { name: 'check:filesize', when: null },
  { name: 'check:self-written', when: null },
  { name: 'check:boundary-owners', when: null },
  { name: 'check:test-waits', when: (files) => files.some((file) => CODE_FILE.test(file)) },
  { name: 'check:mjs-parse', when: (files) => files.some((file) => SCRIPT_FILE.test(file)) },
  { name: 'check:ipc-sender-binding', when: (files) => files.some((file) => file.startsWith('electron/')) },
  // 2026-10-09 加：10-09 上午 #1133 / #1135 / #1128 / #1137 推送前全绿、CI Contracts 各红好几处，全是下面这几道（本机 Windows 实测 7–13 秒）
  { name: 'check:tokens', when: (files) => touchesGateInputs('check:tokens', files) },
  { name: 'check:vocabularies', when: (files) => touchesGateInputs('check:vocabularies', files) },
  { name: 'check:controls', when: (files) => touchesGateInputs('check:controls', files) },
  { name: 'check:store-lifetime', when: (files) => touchesGateInputs('check:store-lifetime', files) },
  { name: 'check:icon-semantics', when: (files) => touchesGateInputs('check:icon-semantics', files) },
  { name: 'check:error-surface', when: (files) => touchesGateInputs('check:error-surface', files) },
  { name: 'check:heavy-path', when: (files) => touchesGateInputs('check:heavy-path', files) },
  { name: 'check:builtin-vendor-literals', when: (files) => touchesGateInputs('check:builtin-vendor-literals', files) },
  { name: 'check:read-path-writes', when: (files) => touchesGateInputs('check:read-path-writes', files) },
  { name: 'check:batch-machines', when: (files) => touchesGateInputs('check:batch-machines', files) },
  { name: 'check:capability-lifecycle', when: (files) => touchesGateInputs('check:capability-lifecycle', files) },
  { name: 'check:no-default-overwrite', when: (files) => touchesGateInputs('check:no-default-overwrite', files) },
  { name: 'check:main-console', when: (files) => touchesGateInputs('check:main-console', files) },
  { name: 'check:asset-evidence', when: (files) => touchesGateInputs('check:asset-evidence', files) },
  { name: 'check:media-import-owner', when: (files) => touchesGateInputs('check:media-import-owner', files) },
  { name: 'check:dangling-tokens', when: (files) => touchesGateInputs('check:dangling-tokens', files) },
  { name: 'check:dangling-tailwind', when: (files) => touchesGateInputs('check:dangling-tailwind', files) },
  { name: 'check:walkthroughs', when: (files) => touchesGateInputs('check:walkthroughs', files) },
  // 全仓登记一致性类的小门岗（本机 Windows 实测每项 1–5 秒、main 上是绿的）：它们看的是登记表 / 文档 / 工作流 / 清单，几乎任何改动都可能碰到 → 总跑（和 filesize / self-written 同一口径）
  { name: 'check:gates-chain', when: null },
  { name: 'check:desktop-rc-workflow', when: null },
  { name: 'check:cla-workflow', when: null },
  { name: 'check:workflow-script-refs', when: null },
  { name: 'check:workflow-protected-writes', when: null },
  { name: 'check:packaged-flags', when: null },
  { name: 'check:icons', when: null },
  { name: 'check:platform-archetypes', when: null },
  { name: 'check:model-certification-coverage', when: null },
  { name: 'check:symlinks', when: null },
  { name: 'check:supply-chain-pins', when: null },
  { name: 'check:escape-ledger', when: null },
  { name: 'check:adoption-bridge', when: null },
  { name: 'check:skill-ipc-coverage', when: null },
  { name: 'check:skills-format', when: null },
  { name: 'check:run-task-grant', when: null },
  { name: 'check:announced-card', when: null },
  { name: 'check:canvas-gesture-determinism', when: null },
  { name: 'check:vitest-fair-share', when: null },
  { name: 'check:agents-sync', when: null },
  { name: 'check:rule-aliases', when: null },
  { name: 'check:push-bypass', when: null },
  { name: 'check:mockup-contracts', when: null },
  { name: 'check:feel', when: null },
  { name: 'check:full-walk-catalog', when: null },
  { name: 'check:real-media-fixture', when: null },
  { name: 'check:framework-boundary', when: null },
  { name: 'check:tikhub-search', when: null },
  { name: 'check:nul-bytes', when: null },
  { name: 'check:git-path-quoting', when: null },
  { name: 'check:model-availability', when: null },
  { name: 'check:model-identity', when: null },
  { name: 'check:outbound-policy', when: null },
])

const VITEST_ENTRY = 'node_modules/vitest/vitest.mjs'

/**
 * 不是 package.json 的 check 脚本、但「整库扫描型 / 规则红绿证明型」的单测与扫描：按改动路径挑出来跑（同样只跑几秒到十几秒的）。
 * argv 是 node 的参数；rerun 是失败时给人看的重跑命令。超过 15 秒的（如 vocabularies 的 38 秒单测套件）不在这里，
 * 它只在改到它自己的文件时由 gateCommands 带上（见 gateCommands）。
 */
export const SCAN_TESTS = Object.freeze([
  // 设计实验室的纯 node 结构检查（#1145 在 CI 才撞到 mirrors 行号越界）；完整的 check:design-lab（tsc + 像素比对 + python 锁）留在 CI
  { name: 'check:design-lab-mirrors', argv: ['scripts/check-design-lab.mjs', '--mirrors-only'], rerun: 'node scripts/check-design-lab.mjs --mirrors-only', when: (files) => touchesGateInputs('check:design-lab-mirrors', files) },
  // 整库类型检查（10-09 #1137 合 main 后 3 处 TS2345，推送前不跑 typecheck）：增量模式复用 node_modules/.cache/nomi-typecheck 的缓存，首次约 100 秒、之后约 30 秒；最慢，排在任务队列最前
  { name: 'typecheck', argv: ['scripts/typecheck.mjs', '--incremental'], rerun: 'node scripts/typecheck.mjs --incremental', when: (files) => touchesGateInputs('typecheck', files) },
  { name: 'test:temp-helper', argv: ['--test', 'scripts/check-test-temp-static.node-test.mjs'], rerun: 'node --test scripts/check-test-temp-static.node-test.mjs', when: (files) => touchesGateInputs('test:temp-helper', files) },
  { name: 'check:test-copy-literals', argv: ['scripts/check-test-copy-literals.mjs'], rerun: 'node scripts/check-test-copy-literals.mjs', when: (files) => touchesGateInputs('check:test-copy-literals', files) },
  { name: 'test:control-contract', argv: [VITEST_ENTRY, 'run', 'scripts/check-control-contract.test.mjs'], rerun: 'node node_modules/vitest/vitest.mjs run scripts/check-control-contract.test.mjs', when: (files) => touchesGateInputs('test:control-contract', files) },
  { name: 'test:quit-lifecycle-guard', argv: [VITEST_ENTRY, 'run', 'electron/quitLifecycleGuard.test.ts'], rerun: 'node node_modules/vitest/vitest.mjs run electron/quitLifecycleGuard.test.ts', when: (files) => touchesGateInputs('test:quit-lifecycle-guard', files) },
])

/** 正文类（需要 PR 正文）：prior-art 与 pr-judgement，正文取不到时只说「今天没查成」（CI 侧仍然 fail-closed）。 */
export const BODY_GATES = Object.freeze(['check:prior-art', 'check:pr-judgement'])

/** 改动文件的 eslint 子集（警告数不得比 base 多、错误一律拦）；脚本是 scripts/lint-changed.mjs，不在 package.json 里。 */
export const LINT_GATE = Object.freeze({ name: 'lint:changed', script: 'scripts/lint-changed.mjs', when: (files) => files.some((file) => /\.(?:tsx?|jsx?|[cm]js)$/.test(file)) })

/**
 * 没放进推送前的 Contracts 门岗及原因（只写在这里一处，报告与 --list 都读它）：
 *   · 整库类（typecheck、全量 lint:ci 的总警告数、check:i18n、check:walkthroughs 等）单项就超过 60 秒；
 *   · 需要 gh / 网络 / 浏览器 / 构建产物的（check:site、check:e2e-launch、check:package-budget 等）；
 *   · 自己的单测套件：只在改到该门岗自己的文件时才跑（见 gateCommands），不是每次都跑。
 */
export const SLOW_GATES_NOTE = '其余 Contracts 门岗仍在 CI 的 gates:contracts 里跑（整库类 > 60 秒，或要网络 / 浏览器 / 构建产物）'

/** 解析 package.json 里某个脚本，返回要跑的 node 命令（拆成 argv 数组）列表。改到门岗自己的文件时连它的单测一起跑。 */
export function gateCommands(scriptText, changedFiles) {
  const segments = String(scriptText).split(/\s+&&\s+/).map((segment) => segment.trim()).filter(Boolean)
  const check = segments[segments.length - 1]
  const tests = segments.slice(0, -1)
  const referenced = (segment) => (segment.match(/\.\/[^\s]+/g) ?? []).map((ref) => ref.replace(/^\.\//, ''))
  const changed = new Set(changedFiles)
  const commands = []
  for (const segment of tests) if (referenced(segment).some((file) => changed.has(file))) commands.push(segment)
  commands.push(check)
  return commands.map((command) => {
    const argv = command.split(/\s+/)
    if (argv[0] !== 'node') throw new Error(`推送前门岗只认 node 命令，遇到：${command}（要纳入就在 PRE_PUSH_GATES 里换成 node 脚本）`)
    return argv.slice(1)
  })
}

/** git push 钩子的 stdin：每行 `<local ref> <local sha> <remote ref> <remote sha>`。 */
export function parsePushRefs(text) {
  return String(text || '').split('\n').map((line) => line.trim().split(/\s+/)).filter((parts) => parts.length >= 4)
    .map(([localRef, localSha, remoteRef, remoteSha]) => ({ localRef, localSha, remoteRef, remoteSha }))
}

const ZERO_SHA = /^0+$/

/** 唯一的豁免规则（协调会话 2026-10-08 定）：tag 指向的提交已在 origin/main、CI 跑过，推 tag 不带进新内容。 */
export const TAG_IN_MAIN_NOTICE = 'tag 指向已在 origin/main 的提交，不带新内容，跳过门岗'
const isTagRef = (ref) => ref.remoteRef.startsWith('refs/tags/')

/**
 * 这次推送要不要判。依据是「远端 ref + 本地 SHA」，不看 localRef 的写法（`HEAD:refs/heads/x` 的 localRef 就是 HEAD）：
 *   · 本地 SHA 为零 = 删除 → 跳过（没有新内容）；
 *   · 具名豁免 TAG_IN_MAIN：只对 refs/tags/*，且本地 SHA 已是 origin/main 的祖先（inMain(sha)）→ 跳过并打印 TAG_IN_MAIN_NOTICE；
 *   · 其余所有非零更新（分支、非 tag 的 ref、不在 main 的 tag）→ 都要判，且 SHA 必须等于当前工作树 HEAD——
 *     门岗跑的是工作树，不一致就阻断（fail-closed），哪怕那个 SHA 在 main 上。
 * 没有任何 ref 行（手动重跑）= 判当前 HEAD。返回 { check, reason?, blocked?, notices? }。
 */
export function pushDecision(refs, headSha, inMain = () => false) {
  const live = refs.filter((ref) => !ZERO_SHA.test(ref.localSha))
  if (refs.length > 0 && live.length === 0) return { check: false, reason: '这次只是删除远端 ref，没有新提交' }
  const exempt = live.filter((ref) => isTagRef(ref) && inMain(ref.localSha))
  const toCheck = live.filter((ref) => !exempt.includes(ref))
  if (refs.length > 0 && toCheck.length === 0) return { check: false, reason: TAG_IN_MAIN_NOTICE }
  const elsewhere = toCheck.filter((ref) => ref.localSha !== headSha)
  if (elsewhere.length > 0) {
    return { check: true, blocked: `要推的 ${elsewhere.map((ref) => `${ref.localRef}（${ref.localSha.slice(0, 12)}）`).join('、')} 不是当前工作树的 HEAD（${headSha.slice(0, 12)}），门岗跑的是工作树、查不到要推的东西——先 checkout 要推的提交再推` }
  }
  return { check: true }
}

/** 选出本次要跑的门岗名（含 lint:changed）。files = 改动路径；null = 算不出改动 → 全跑。 */
export function selectGates(files) {
  if (files === null) return [...PRE_PUSH_GATES.map((gate) => gate.name), ...SCAN_TESTS.map((scan) => scan.name), LINT_GATE.name]
  // 纯文档改动：只跑「总跑」的登记类门岗（它们也管 docs 里的登记表），代码类不跑
  const policy = classifyValidationPolicy(files.map((file) => ({ path: file, status: 'M' })))
  const docsOnly = !policy.failClosed && policy.reason === 'docs_only'
  const picked = PRE_PUSH_GATES.filter((gate) => gate.when === null || (!docsOnly && gate.when(files))).map((gate) => gate.name)
  if (!docsOnly) picked.push(...SCAN_TESTS.filter((scan) => scan.when(files)).map((scan) => scan.name))
  if (!docsOnly && LINT_GATE.when(files)) picked.push(LINT_GATE.name)
  return picked
}

function git(args, cwd = repoRoot) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] })
}

/** origin/main...HEAD 的改动路径（-z，非 ASCII 路径不被转义）；取不到 = null。 */
export function changedFiles() {
  try {
    const base = git(['merge-base', 'HEAD', 'origin/main']).trim()
    return git(['diff', '-z', '--name-only', '--no-renames', base, 'HEAD']).split('\0').filter(Boolean)
  } catch {
    return null
  }
}

/** 单道门岗的硬超时（冷缓存首次 typecheck 约 100 秒是最长的一项）；超时终止子进程、打印门名和耗时、该门按红处理。 */
export const GATE_TIMEOUT_MS = 240_000
/** 整个钩子的硬超时：超过就终止所有仍在跑的子进程、点名它们、返回非零，不会无限挂住。 */
export const HOOK_TIMEOUT_MS = 600_000

/** 仍在跑的子进程：{ child → { name, started } }，给整体超时点名并终止用。 */
const running = new Map()

function killTree(child) {
  try {
    if (process.platform === 'win32' && child.pid) spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
    else child.kill('SIGKILL')
  } catch { /* 已经退出 */ }
}

export function runNode(argv, env = {}, { timeoutMs = GATE_TIMEOUT_MS, name = argv.join(' ') } = {}) {
  return new Promise((resolve) => {
    const started = Date.now()
    const child = spawn(process.execPath, argv, { cwd: repoRoot, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] })
    running.set(child, { name, started })
    let output = ''
    let settled = false
    const finish = (result) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      running.delete(child)
      resolve(result)
    }
    const timer = setTimeout(() => {
      killTree(child)
      finish({ status: 124, output: `${output}
[pre-push] 超时：${name} 跑了 ${((Date.now() - started) / 1000).toFixed(1)} 秒仍未结束（上限 ${timeoutMs / 1000} 秒），已终止`, ms: Date.now() - started })
    }, timeoutMs)
    child.stdout.on('data', (chunk) => { output += chunk })
    child.stderr.on('data', (chunk) => { output += chunk })
    child.on('error', (error) => finish({ status: 1, output: `${output}${error.message}`, ms: Date.now() - started }))
    child.on('close', (status) => finish({ status: status ?? 1, output, ms: Date.now() - started }))
  })
}

/** 简单并发池：按顺序启动，最多 limit 个同时跑。 */
async function pool(tasks, limit) {
  const results = new Array(tasks.length)
  let next = 0
  const worker = async () => {
    while (next < tasks.length) {
      const index = next++
      results[index] = await tasks[index]()
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker))
  return results
}

/** 跑完所有任务，但整体最多 deadlineMs：到点就终止仍在跑的子进程并点名。返回 { results, timedOut, stillRunning }。 */
export async function runWithDeadline(tasks, limit, deadlineMs) {
  let timer
  const deadline = new Promise((resolve) => {
    timer = setTimeout(() => {
      const stillRunning = [...running.values()].map((entry) => `${entry.name}（${((Date.now() - entry.started) / 1000).toFixed(0)}s）`)
      for (const child of [...running.keys()]) killTree(child)
      resolve({ results: [], timedOut: true, stillRunning })
    }, deadlineMs)
  })
  const finished = pool(tasks, limit).then((results) => ({ results, timedOut: false, stillRunning: [] }))
  const outcome = await Promise.race([finished, deadline])
  clearTimeout(timer)
  return outcome
}

const tail = (text, lines) => String(text).trimEnd().split('\n').slice(-lines).join('\n')

/** 单道门岗的重跑命令（不走钩子入口：钩子不接受缩小门岗集合的参数）。 */
export const rerunCommand = (name) => {
  if (name === LINT_GATE.name) return `node ${LINT_GATE.script}`
  const scan = SCAN_TESTS.find((item) => item.name === name)
  return scan ? scan.rerun : `pnpm run ${name}`
}

export function formatSummary(results) {
  const failed = results.filter((result) => result.status !== 0)
  const out = []
  for (const result of results) out.push(`[pre-push] ${result.status === 0 ? '✅' : '✖'} ${result.name}（${(result.ms / 1000).toFixed(1)}s）${result.note ? ` ${result.note}` : ''}`)
  if (failed.length === 0) return { text: out.join('\n'), failed }
  out.push('')
  for (const result of failed) out.push(`──── ✖ ${result.name} ────`, tail(result.output, FAILURE_TAIL_LINES), '')
  out.push(`[pre-push] BLOCKED：${failed.length} 项没过：${failed.map((result) => result.name).join('、')}`)
  out.push('先在本机改好（这些都是几秒到几十秒的事），别推出去换一轮 40 分钟的 CI。单独重跑失败的那道：')
  for (const result of failed) out.push(`  ${rerunCommand(result.name)}`)
  return { text: out.join('\n'), failed }
}

export async function main(argv = process.argv.slice(2), { stdinText = null, hookTimeoutMs = HOOK_TIMEOUT_MS } = {}) {
  const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'))
  const known = [...PRE_PUSH_GATES.map((gate) => gate.name), ...SCAN_TESTS.map((scan) => scan.name), LINT_GATE.name, ...BODY_GATES]
  // 入口只认 --list；任何别的参数（含空值）一律报错——推送钩子不能有让门岗集合变小的开关（P1）
  // 钩子形态 = 恰好两个位置参数 <remote名> <url>（git githooks 文档的 pre-push 约定），它们不影响门岗集合
  const shaped = argv.length === 2 && argv.every((arg) => arg !== '' && !arg.startsWith('-'))
  // 光有两个参数不算钩子（谁都能伪造）：必须同时见到分发器设的内部标记，才读 stdin、才走 ref 判定；否则一律按当前 HEAD 检查、不读 stdin
  const hooked = shaped && process.env.NOMI_GIT_HOOK_DISPATCH === 'pre-push'
  const bad = shaped ? [] : argv.filter((arg) => arg !== '--list')
  if (bad.length > 0) {
    console.error(`[pre-push] 不接受参数：${bad.map((arg) => JSON.stringify(arg)).join('、')}（只有 --list，或 git 钩子传入的 <remote名> <url>；要单独重跑某道门岗请直接 pnpm run check:xxx）`)
    return 2
  }
  if (argv.includes('--list')) {
    console.log(`推送前门岗：${known.join('、')}\n${SLOW_GATES_NOTE}`)
    return 0
  }
  const headSha = git(['rev-parse', 'HEAD']).trim()
  // 只有真作为钩子被调用才读 stdin；手动跑不读（stdin 可能是永不关闭的管道）
  if (!hooked) stdinText = ''
  if (stdinText === null && !process.stdin.isTTY) {
    try { stdinText = fs.readFileSync(0, 'utf8') } catch { stdinText = '' }
  }
  const inMain = (sha) => { try { git(['merge-base', '--is-ancestor', sha, 'origin/main']); return true } catch { return false } }
  const decision = pushDecision(parsePushRefs(stdinText), headSha, inMain)
  if (!decision.check) {
    console.error(`[pre-push] 跳过：${decision.reason}`)
    return 0
  }
  if (decision.blocked) {
    console.error(`[pre-push] BLOCKED：${decision.blocked}`)
    return 1
  }

  const files = changedFiles()
  if (files === null) console.error('[pre-push] 算不出 origin/main...HEAD 的改动（本地没有 origin/main？）——全部门岗都跑')
  const selected = new Set([...selectGates(files), ...BODY_GATES])
  const changed = files ?? []
  console.error(`[pre-push] 改动 ${files === null ? '（未知）' : `${files.length} 个文件`}，跑：${[...selected].join('、')}`)

  const tasks = []
  for (const gate of PRE_PUSH_GATES) {
    if (!selected.has(gate.name)) continue
    const script = pkg.scripts?.[gate.name]
    if (!script) { console.error(`[pre-push] package.json 里没有 ${gate.name}——门岗清单与 package.json 漂了`); return 2 }
    tasks.push(async () => {
      const started = Date.now()
      let last = { status: 0, output: '' }
      for (const commandArgv of gateCommands(script, changed)) {
        last = await runNode(commandArgv, {}, { name: gate.name })
        if (last.status !== 0) break
      }
      return { name: gate.name, status: last.status, output: last.output, ms: Date.now() - started }
    })
  }
  for (const scan of SCAN_TESTS) {
    if (!selected.has(scan.name)) continue
    const task = async () => ({ name: scan.name, ...(await runNode(scan.argv, {}, { name: scan.name })) })
    if (scan.name === 'typecheck') tasks.unshift(task)
    else tasks.push(task)
  }
  if (selected.has(LINT_GATE.name)) {
    tasks.push(async () => ({ name: LINT_GATE.name, ...(await runNode([path.join(repoRoot, LINT_GATE.script)], {}, { name: LINT_GATE.name })) }))
  }
  // 正文类：正文一次取好（本机优先 gh pr view，没有 PR 就读 .tmp-pr-body.md 草稿），两道门岗用同一份
  const bodyGates = BODY_GATES.filter((name) => selected.has(name))
  if (bodyGates.length) {
    const pr = resolvePullRequestBody({ cwd: repoRoot, argv: [...process.argv, '--pr'] })
    if (!pr.available && (pr.required || !hooked)) {
      // 指定了来源却读不了 / gh 超时，或手动重跑却拿不到正文：明确报错退出，不能当「查过了」
      console.error(`[pre-push] BLOCKED：取不到 PR 正文：${pr.reason}。手动跑请给 NOMI_PR_BODY 或 NOMI_PR_BODY_FILE，或先写好 .tmp-pr-body.md`)
      return 1
    }
    if (!pr.available) {
      console.error(`[pre-push] 正文类门岗跳过：${pr.reason}；CI 侧仍会查`)
    } else {
      console.error(`[pre-push] PR 正文取自 ${pr.source}`)
      for (const name of bodyGates) {
        const script = name === 'check:prior-art' ? 'scripts/check-prior-art.mjs' : 'scripts/check-pr-judgement.mjs'
        tasks.push(async () => ({ name, ...(await runNode([path.join(repoRoot, script), '--pr'], { NOMI_PR_BODY: pr.body }, { name })) }))
      }
    }
  }

  const started = Date.now()
  const outcome = await runWithDeadline(tasks, CONCURRENCY, hookTimeoutMs)
  if (outcome.timedOut) {
    console.error(`[pre-push] BLOCKED：整个钩子超过 ${hookTimeoutMs / 1000} 秒仍未结束，已终止。仍在跑：${outcome.stillRunning.join('、') || '（无）'}`)
    return 1
  }
  const results = outcome.results
  const { text, failed } = formatSummary(results)
  console.error(text)
  const ciOnlyCount = CI_ONLY.reduce((total, group) => total + group.gates.length, 0)
  const partial = Object.entries(PARTIAL_LOCAL).map(([gate, { by }]) => `${gate}（本机只跑了 ${by}）`).join('、')
  console.error(`[pre-push] 共 ${((Date.now() - started) / 1000).toFixed(1)}s；${SLOW_GATES_NOTE}`)
  console.error(`[pre-push] 只在 CI 跑的门共 ${ciOnlyCount} 道（名单与理由：scripts/pre-push-gate-table.mjs）；完整版只在 CI、本机只跑了一部分的：${partial}。推送前钩子是加速器，CI 才是最终裁判。`)
  return failed.length === 0 ? 0 : 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then((code) => { process.exitCode = code })
}
