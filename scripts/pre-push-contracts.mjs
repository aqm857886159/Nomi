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
import { execFileSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { resolvePullRequestBody } from './lib/prBody.mjs'
import { classifyValidationPolicy } from './validation-policy.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** 同时跑几个门岗：mjs-parse 自己就开 8 个子进程，再叠太多反而更慢。 */
export const CONCURRENCY = 3
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
  { name: 'check:tokens', when: (files) => files.some((file) => /^(?:src|electron)\/.*\.tsx?$|^tailwind\.config\.ts$|^scripts\/check-design-tokens/.test(file)) },
  { name: 'check:vocabularies', when: (files) => files.some((file) => /^(?:src|electron)\/.*\.tsx?$|^scripts\/check-vocabularies/.test(file)) },
  { name: 'check:controls', when: (files) => files.some((file) => /^src\/.*\.tsx$|^scripts\/(?:check-)?control-contract/.test(file)) },
])

const VITEST_ENTRY = 'node_modules/vitest/vitest.mjs'

/**
 * 不是 package.json 的 check 脚本、但「整库扫描型 / 规则红绿证明型」的单测与扫描：按改动路径挑出来跑（同样只跑几秒到十几秒的）。
 * argv 是 node 的参数；rerun 是失败时给人看的重跑命令。超过 15 秒的（如 vocabularies 的 38 秒单测套件）不在这里，
 * 它只在改到它自己的文件时由 gateCommands 带上（见 gateCommands）。
 */
export const SCAN_TESTS = Object.freeze([
  { name: 'test:temp-helper', argv: ['--test', 'scripts/check-test-temp-static.node-test.mjs'], rerun: 'node --test scripts/check-test-temp-static.node-test.mjs', when: (files) => files.some((file) => /^(?:scripts|tests)\//.test(file)) },
  { name: 'check:test-copy-literals', argv: ['scripts/check-test-copy-literals.mjs'], rerun: 'node scripts/check-test-copy-literals.mjs', when: (files) => files.some((file) => /^(?:src|electron|scripts|tests|evals|packages)\//.test(file)) },
  { name: 'test:control-contract', argv: [VITEST_ENTRY, 'run', 'scripts/check-control-contract.test.mjs'], rerun: 'node node_modules/vitest/vitest.mjs run scripts/check-control-contract.test.mjs', when: (files) => files.some((file) => /^scripts\/(?:check-)?control-contract/.test(file)) },
  { name: 'test:quit-lifecycle-guard', argv: [VITEST_ENTRY, 'run', 'electron/quitLifecycleGuard.test.ts'], rerun: 'node node_modules/vitest/vitest.mjs run electron/quitLifecycleGuard.test.ts', when: (files) => files.some((file) => /^electron\/|^eslint\.config\./.test(file)) },
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

function runNode(argv, env = {}) {
  return new Promise((resolve) => {
    const started = Date.now()
    const child = spawn(process.execPath, argv, { cwd: repoRoot, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    child.stdout.on('data', (chunk) => { output += chunk })
    child.stderr.on('data', (chunk) => { output += chunk })
    child.on('error', (error) => resolve({ status: 1, output: `${output}${error.message}`, ms: Date.now() - started }))
    child.on('close', (status) => resolve({ status: status ?? 1, output, ms: Date.now() - started }))
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

export async function main(argv = process.argv.slice(2), { stdinText = null } = {}) {
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
        last = await runNode(commandArgv)
        if (last.status !== 0) break
      }
      return { name: gate.name, status: last.status, output: last.output, ms: Date.now() - started }
    })
  }
  for (const scan of SCAN_TESTS) {
    if (selected.has(scan.name)) tasks.push(async () => ({ name: scan.name, ...(await runNode(scan.argv)) }))
  }
  if (selected.has(LINT_GATE.name)) {
    tasks.push(async () => ({ name: LINT_GATE.name, ...(await runNode([path.join(repoRoot, LINT_GATE.script)])) }))
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
        tasks.push(async () => ({ name, ...(await runNode([path.join(repoRoot, script), '--pr'], { NOMI_PR_BODY: pr.body })) }))
      }
    }
  }

  const started = Date.now()
  const results = await pool(tasks, CONCURRENCY)
  const { text, failed } = formatSummary(results)
  console.error(text)
  console.error(`[pre-push] 共 ${((Date.now() - started) / 1000).toFixed(1)}s；${SLOW_GATES_NOTE}`)
  return failed.length === 0 ? 0 : 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then((code) => { process.exitCode = code })
}
