#!/usr/bin/env node
/**
 * 「后端错误原文不许漏到界面」门岗（2026-09-11）。
 *
 * 为什么要它：用户真机截图里 Agent 面板顶部飘出一行红色英文原文
 * 「The agent is opening a conversation. Try again after it opens.」——那是主进程的一句内部
 * 不变量断言，经三次转手成了产品文案。`check:i18n` 拦不住它，因为那条门岗在 electron/ 侧
 * **只扫中文**：写中文 throw 会红，写英文 throw 反而安全。于是规矩被教成了「换成英文就行」。
 *
 * 三条规则（R17：加规则先验它会红；R28：能让编译器拦的已经交给编译器了——
 * `LaneDesktopResult` 的失败分支叫 `diagnostic` 不叫 `message`，类型改完 tsc 会点名每个消费者。
 * 这里只补编译器看不见的那两半）：
 *
 *   ① 码表与文案一一对应（硬零）。`LANE_ERROR_CODES` 的每个码，两种语言都必须有一句话；
 *      多出来的孤儿文案同样报红。新增一个码却忘了写文案，当场红。
 *   ② `diagnostic` 不许进显示汇（硬零）。它只许流向 console / LaneCommandFailure 构造 /
 *      类型声明。出现在 JSX、setError、toast、alertDialog 里就是这次泄漏的形状。
 *   ③ lane 命令路径上的英文散句 throw（棘轮）。它们现在全部经 `laneErrorCodeOf` 落到兜底码、
 *      不再进界面，所以不是硬零；但每收一条基线就降一格，只减不增。
 *
 * 用法：
 *   node scripts/check-error-surface.mjs
 *   node scripts/check-error-surface.mjs --update-baseline   把规则③的存量重拍快照（只许变小）
 *
 * 基线按「文件 :: 原文」登记，不按行号——行号会被上方任何一处无关改动推走，那种基线每次
 * 都要重拍，重拍多了就没人看得出到底收没收债。
 */
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const BASELINE_FILE = path.join(repoRoot, 'scripts', 'error-surface-baseline.json')
const UPDATE = process.argv.includes('--update-baseline')

const rel = (file) => path.relative(repoRoot, file).split(path.sep).join('/')

function walk(root, accept) {
  const out = []
  if (!fs.existsSync(root)) return out
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const file = path.join(root, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.tmp') continue
      out.push(...walk(file, accept))
    } else if (entry.isFile() && accept(entry.name)) out.push(file)
  }
  return out
}

const failures = []
const isSource = (name) => /\.(ts|tsx|mts|cts)$/.test(name) && !/\.test\./.test(name)

// ── 规则① 码表 ↔ 文案 ──────────────────────────────────────────────────────────
const codesFile = path.join(repoRoot, 'electron', 'shared', 'agentLane', 'laneErrorCodes.ts')
const localeFile = path.join(repoRoot, 'src', 'i18n', 'locales', 'agentLaneError.ts')
const codesSource = fs.readFileSync(codesFile, 'utf8')
const localeSource = fs.readFileSync(localeFile, 'utf8')

const codeBlock = /export const LANE_ERROR_CODES = \[([\s\S]*?)\] as const/.exec(codesSource)
if (!codeBlock) failures.push(`${rel(codesFile)}: 找不到 LANE_ERROR_CODES 字面量数组——门岗读不到码表就等于没有门岗`)
const codes = codeBlock ? [...codeBlock[1].matchAll(/^\s*'([a-z][a-z0-9_]*)',$/gm)].map((m) => m[1]) : []

function localeKeys(exportName) {
  const block = new RegExp(`export const ${exportName} = \\{([\\s\\S]*?)\\n\\}`).exec(localeSource)
  return block ? [...block[1].matchAll(/^\s*([a-z][a-z0-9_]*):/gm)].map((m) => m[1]) : null
}
for (const [exportName, label] of [['zhAgentLaneError', 'zh-CN'], ['enAgentLaneError', 'en']]) {
  const keys = localeKeys(exportName)
  if (!keys) { failures.push(`${rel(localeFile)}: 找不到 ${exportName}`); continue }
  for (const code of codes) {
    if (!keys.includes(code)) failures.push(`${rel(localeFile)}: ${label} 缺 '${code}' 的文案——新增码必须同时写两种语言`)
  }
  for (const key of keys) {
    if (!codes.includes(key)) failures.push(`${rel(localeFile)}: ${label} 的 '${key}' 不在 LANE_ERROR_CODES 里（孤儿文案）`)
  }
}

// ── 规则② diagnostic 不许进显示汇 ──────────────────────────────────────────────
// 它只许出现在：类型/契约声明、构造 LaneCommandFailure、console 诊断。
const DIAGNOSTIC_ALLOWED = [
  /^src\/workbench\/ai\/lane\/laneCommandFailure\.ts$/,
  /^electron\/shared\/agentLane\/laneDesktopContracts\.ts$/,
  /^electron\/agentLane\/laneIpc\.ts$/,
]
const DISPLAY_SINKS = /\b(setError|toast|showInfoToast|showUndoToast|alertDialog|confirmDialog|report|reportFeedback)\s*\(/
// 只看**读得到 lane 结果**的那些文件。`diagnostic` 在仓库里还有别的、与桥无关的用法
// （迁移报告等），把它们一并卷进来只会逼人加豁免，那正是门岗失真的开始。
const TOUCHES_LANE = /LaneCommandResult|LaneDesktopResult|LaneCommandFailure|laneClient/
for (const file of [...walk(path.join(repoRoot, 'src'), isSource), ...walk(path.join(repoRoot, 'electron'), isSource)]) {
  const name = rel(file)
  if (DIAGNOSTIC_ALLOWED.some((allowed) => allowed.test(name))) continue
  const source = fs.readFileSync(file, 'utf8')
  if (!TOUCHES_LANE.test(source)) continue
  source.split('\n').forEach((line, index) => {
    if (!/\.diagnostic\b/.test(line)) return
    const construction = /new LaneCommandFailure\(/.test(line)
    const logging = /console\.(error|warn|log|debug|info)\(/.test(line)
    const display = DISPLAY_SINKS.test(line) || /\{\s*[a-zA-Z.]*\.diagnostic\s*\}/.test(line)
    if (display || (!construction && !logging)) {
      failures.push(`${name}:${index + 1}: \`diagnostic\` 是诊断串不是界面文案——按 code 取 t(laneErrorI18nKey(code))`)
    }
  })
}

// ── 规则③ lane 命令路径上的英文散句 throw（棘轮） ────────────────────────────────
// 只覆盖 **lane 命令路径**：这些文件抛出来的东西会被 laneIpc 的 catch 接住、变成一次命令失败，
// 因此每一条都该是码。工具实现（laneCodingTools / laneCanvasTools…）不在内——它们的英文散句
// 是写给**模型**看的 tool result，本来就不该翻译，把它们卷进来只会逼人加豁免。
const PROSE_FILES = [
  'electron/agentLane/laneIpc.ts',
  'electron/agentLane/laneCommandCodec.ts',
  'electron/agentLane/laneDesktopRuntime.ts',
  'electron/agentLane/laneDesktopInput.ts',
  'electron/agentLane/laneDesktopTasks.ts',
  'electron/agentLane/laneReceiptCommands.ts',
  'electron/agentLane/laneWorkspace.mts',
  'electron/agentLane/laneHost.mts',
  'electron/agentLane/laneSession.mts',
]
const THROW_RE = /new (?:[A-Za-z]*Error)\(\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1/g
const found = []
for (const name of PROSE_FILES) {
  const file = path.join(repoRoot, name)
  if (!fs.existsSync(file)) { failures.push(`${name}: 门岗登记的文件不在了——改名/删除时要同步这份清单`); continue }
  fs.readFileSync(file, 'utf8').split('\n').forEach((line, index) => {
    for (const match of line.matchAll(THROW_RE)) {
      const text = match[2]
      if (!/\s/.test(text)) continue // 机器码形状，正是我们要的
      if (!/[A-Za-z]/.test(text)) continue // 纯中文由 check:i18n 的 electron 基线管
      found.push(`${name} :: ${text}`)
    }
  })
}
found.sort()

const baseline = fs.existsSync(BASELINE_FILE)
  ? JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8'))
  : { count: Number.POSITIVE_INFINITY, entries: [] }

if (UPDATE) {
  if (found.length > baseline.entries.length) {
    console.error(`拒绝上调基线：现在 ${found.length} 条，基线 ${baseline.entries.length} 条。棘轮只减不增。`)
    process.exit(1)
  }
  fs.writeFileSync(BASELINE_FILE, `${JSON.stringify({ count: found.length, entries: found }, null, 2)}\n`)
  console.log(`error-surface 基线已更新：${found.length} 条`)
  process.exit(0)
}

const known = new Set(baseline.entries)
for (const entry of found) {
  if (!known.has(entry)) {
    failures.push(`${entry}: lane 命令路径上新增了一句英文散句 throw。改成 LANE_ERROR_CODES 里的码，并给两种语言写文案。`)
  }
}
if (found.length > baseline.entries.length) {
  failures.push(`lane 英文散句 throw 从 ${baseline.entries.length} 涨到 ${found.length}——棘轮只减不增。`)
}

if (failures.length) {
  console.error('check:error-surface 失败：\n')
  for (const failure of failures) console.error(`  ✗ ${failure}`)
  console.error(`\n为什么有这条门岗：docs/plan/2026-09-11-agent-error-surface.md`)
  process.exit(1)
}
console.log(`check:error-surface 通过（${codes.length} 个码 × 2 种语言；lane 英文散句存量 ${found.length}/${baseline.entries.length}）`)
