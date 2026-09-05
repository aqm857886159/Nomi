#!/usr/bin/env node
// 门岗链完整性门岗（2026-08-26）。抓的是一类**没有任何报错的**失效：门岗从链里消失。
//
// 起因：package.json 的 "gates" 是一条几十节的 `&&` 长链。分支冲突十有八九落在这一行，
// 而解冲突时「取一边」就会**静默吞掉一个 check**——被吞的那个不会报错、不会警告，
// 它只是**再也不跑了**。2026-08-25 一晚上差点栽两次。
// 缺失的门岗和从未存在过的门岗，在 CI 输出里长得一模一样：都是一片绿。
//
// 规矩：package.json 里定义的每个 `check:*` 脚本，都必须能从 `gates` 链**传递可达**。
//
// 为什么必须传递解析、不能只做字面 substring 匹配：
//   check:site 自己内部就跑了 `build-marketing-sitemap.mjs --check` 和 `pnpm run check:handbook`，
//   所以 check:handbook / check:sitemap 事实上已被覆盖，只是**没有字面出现在 gates 那一行**。
//   一个朴素的字面检查会对着这两个精确地误报。而误报的下场是有人把门岗关掉——
//   那就正好重演了本门岗要防的那件事。所以宁可多写几十行解析，也不留假红。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** gates:contracts 的执行体；它的实参就是要跑的门岗清单（见 extractScriptRefs 的说明）。 */
const GATES_RUNNER = 'scripts/run-gates-contracts.mjs'

/**
 * 蓄意不入链的 check:*——**每条都必须写清楚为什么**。
 *
 * 这份名单是本门岗唯一的逃生口，所以它必须小、必须带理由。
 * 想往这里加一条时先问：它到底是「不该拦 push」，还是「我只是想让红变绿」？
 * 后者就别加——那是在拆自己刚装的门。
 */
const INTENTIONALLY_OUT_OF_CHAIN = new Map([
  [
    'check:handoff',
    // 交接体检是人工收货时按需跑的报告工具；它可选地启动全套件，不应阻塞每次 push。
    '手动交接体检工具（--with-tests 可启动全套件），不是每次 push 的正确性门岗',
  ],
  [
    'check:audit',
    // 这是**节奏提醒**不是正确性门岗：commit 攒够 25 个就提示该做周期审计（R14）。
    // 它按时间/计数报红，和这次改动对不对无关。放进 gates 会让「今天该审计了」
    // 变成「你不能 push」——门岗一旦开始拦无辜的人，人就会开始绕过门岗。
    '节奏提醒（R14 审计/评测周期），按 commit 数报红，与本次改动正确性无关；入链会无差别拦 push',
  ],
])

function readPackageJson() {
  const file = path.join(repoRoot, 'package.json')
  return { file, pkg: JSON.parse(fs.readFileSync(file, 'utf8')) }
}

/**
 * 从一条 shell 命令里取出它引用的所有 npm 脚本名。
 *
 * 认得三种写法：`pnpm run x` / `pnpm x` / `npm run x` / `yarn x`。
 * 不认得的写法宁可漏认（漏认 = 那个脚本没被算作已覆盖 = 报红），也不瞎认——
 * 本门岗的失败方向必须是「多报红」而不是「多报绿」：假红看得见，假绿看不见。
 */
function extractScriptRefs(command, knownScripts) {
  const refs = new Set()
  const pattern = /\b(?:pnpm|npm|yarn)\s+(?:run\s+)?([\w:-]+)/g
  for (const match of command.matchAll(pattern)) {
    const name = match[1]
    if (knownScripts.has(name)) refs.add(name)
  }
  // gates:contracts 的门岗清单自 2026-09-05 起是 runner 的**实参**（`node scripts/run-gates-contracts.mjs
  // --advisory=a,b check:x check:y …`），不再是 `pnpm run x && pnpm run y` 长链——理由见该文件头
  // （`&&` 早退把「违反 3 个门岗」变成 3 轮 CI）。这些裸名字仍然是「真的会被执行」的引用，
  // 必须算进可达集合，否则本门岗会把整条链判成「全都不跑」。
  //
  // 为什么只对这一个实现文件放开裸名匹配、不做成通用规则：通用地把任何命令里出现的 check:* 都
  // 当作「跑过了」，会在「只是提到名字」的命令上给出**假绿**——而本门岗的失败方向必须是假红。
  // 这里的判据很紧：命令必须真的调用 runner 的实现文件，而 runner 的语义就是「把实参逐个跑掉」。
  if (command.includes(GATES_RUNNER)) {
    for (const token of command.split(/[\s,]+/)) {
      const name = token.replace(/^--advisory=/, '')
      if (knownScripts.has(name)) refs.add(name)
    }
  }
  return refs
}

/**
 * 一条命令是否**直接**跑了某个 check 脚本的实现文件。
 *
 * 覆盖 check:sitemap 这种情形：gates 没提它，check:site 也没 `pnpm run` 它，
 * 但 check:site 里原地跑了同一个 `build-marketing-sitemap.mjs --check`——
 * 即同一份检查确实执行了，只是没走脚本名这条路。判据是「实现文件 + 关键 flag 都在」。
 */
function runsSameImplementation(command, targetCommand) {
  const scriptFile = targetCommand.match(/([\w./-]+\.(?:mjs|cjs|js|ts))/)?.[1]
  if (!scriptFile) return false
  if (!command.includes(scriptFile)) return false
  // 实现文件相同还不够：build-marketing-sitemap.mjs 带不带 --check 是两回事
  //（一个是生成、一个是校验）。目标命令里的 flag 必须也在。
  const flags = targetCommand.match(/\s(--[\w-]+)/g)?.map((f) => f.trim()) ?? []
  return flags.every((flag) => command.includes(flag))
}

/**
 * 从某个入口做传递闭包：链里的脚本、它们引用的脚本、再往下……全部展开。
 *
 * **导出**（2026-09-05）：可达性判据只能有一份。原先 scripts/agent-runtime-wiring.test.mjs
 * 里另抄了一份只认 `pnpm run x` 的正则闭包，gates:contracts 改成 runner 实参后它立刻
 * 把「typecheck 不可达」这种假红报了出来——两份判据必然漂移，正是 R14.1 要拦的。
 */
export function resolveReachable(scripts, entry) {
  const reachable = new Set()
  const knownScripts = new Set(Object.keys(scripts))
  const queue = [entry]
  while (queue.length > 0) {
    const name = queue.shift()
    if (reachable.has(name)) continue
    reachable.add(name)
    const command = scripts[name]
    if (!command) continue
    for (const ref of extractScriptRefs(command, knownScripts)) {
      if (!reachable.has(ref)) queue.push(ref)
    }
  }
  return reachable
}

/** 可达集合里所有命令拼起来——用于 runsSameImplementation 这条「同实现」旁路。 */
function collectReachableCommands(scripts, reachable) {
  return [...reachable].map((name) => scripts[name] ?? '').join('\n')
}

function main() {
  const { file, pkg } = readPackageJson()
  const scripts = pkg.scripts ?? {}

  if (!scripts.gates) {
    console.error('❌ package.json 里没有 "gates" 脚本——门岗链本身不见了。')
    process.exit(1)
  }

  const reachable = resolveReachable(scripts, 'gates')
  const reachableCommands = collectReachableCommands(scripts, reachable)

  const allChecks = Object.keys(scripts).filter((name) => name.startsWith('check:'))
  const missing = []
  const staleExclusions = []

  for (const name of allChecks) {
    if (reachable.has(name)) {
      // 已经在链里的，就不该同时还挂在豁免名单上——那说明名单过期了，
      // 留着会让下一个人以为「这条本来就不用跑」。
      if (INTENTIONALLY_OUT_OF_CHAIN.has(name)) staleExclusions.push(name)
      continue
    }
    if (INTENTIONALLY_OUT_OF_CHAIN.has(name)) continue
    // 最后一条旁路：脚本名没进链，但链里有命令跑了它同一份实现（含同样的 flag）。
    if (runsSameImplementation(reachableCommands, scripts[name])) continue
    missing.push(name)
  }

  if (staleExclusions.length > 0) {
    console.error('❌ 豁免名单过期：下面这些 check 已经在 gates 链里了，请把它们从 INTENTIONALLY_OUT_OF_CHAIN 删掉：')
    for (const name of staleExclusions) console.error(`   · ${name}`)
    console.error(`   → ${path.relative(repoRoot, fileURLToPath(import.meta.url))}`)
    process.exit(1)
  }

  if (missing.length > 0) {
    console.error(`❌ 有 ${missing.length} 个 check 脚本**不在 gates 链里**，等于定义了但从来不跑：`)
    for (const name of missing) {
      console.error(`   · ${name}  →  ${scripts[name]}`)
    }
    console.error('')
    console.error('  一个门岗从 gates 链里消失是**没有任何报错**的：它不会失败，它只是不再执行，')
    console.error('  CI 照样一片绿。最常见的来路是解 package.json 冲突时「取了一边」，静默吞掉一节。')
    console.error('')
    console.error(`  → 把它接回 ${path.relative(repoRoot, file)} 的 "gates" 链；`)
    console.error('  → 如果确实**蓄意**不入链，去 scripts/check-gates-chain.mjs 的')
    console.error('     INTENTIONALLY_OUT_OF_CHAIN 里登记，并写清楚为什么。')
    process.exit(1)
  }

  const excluded = [...INTENTIONALLY_OUT_OF_CHAIN.keys()]
  console.log(`✅ 门岗链完整：${allChecks.length} 个 check:* 全部可达（蓄意豁免 ${excluded.length} 个：${excluded.join('、') || '无'}）`)
}

// 被别的脚本/测试 import 时不执行 CLI（它们要的是上面的可达性判据，不是退出码）。
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
