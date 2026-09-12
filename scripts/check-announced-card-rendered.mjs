#!/usr/bin/env node
// 「声称有卡 ⇒ 必须画出点什么」门岗（2026-09-12）。
//
// ── 它拦的是哪一族 ──
//
// 2026-09-11 的真实会话：用户让 Agent 把一段素材劈成两半，模型回了一句「已生成剪辑预览，
// 请在确认卡中批准后写入时间线」，dock 上也写着「等你确认 1 条」——而槽里一张卡都没有。
// 用户先以为在加载，再以为 Nomi 坏了。
//
// 挖到底不是一个 bug，是一族：announce（宿主投影 / 工具结果 / 系统提示词里那句「此动作会向
// 用户确认」）与 render（介入槽）之间那几段链路，把三件不同的事塌缩成同一个返回值：
//
//   ① 真的没有要确认的东西               → 空，对；
//   ② 我读不到（通道抛了 / 能力核没装起来） → 也写成了空；
//   ③ 我知道有，但我画不出来（认不出形状）  → 也写成了空。
//
// ②③ 是失败。把失败写成空，用户那头只剩沉默。
//
// ── 判据（结构性，不看名字）──
//
// 扫 announce→render 这条链上那几个受检文件，数其中「收成空、而且一声不吭」的分支。
// 基线只减不增（棘轮）。加规则先验它会红（R17）：`--selftest` 用正反两组合成源码跑每条规则，
// 确认它抓得到自己的病、也不抓已经修好的写法、更不被讲述这个病的注释触发。
//
// ── 这道门拦不住什么，要说清楚 ──
//
// 它只看这几个受检文件里的形状。真正的不变量由两处更早的防线拿着（R28）：
//   · 类型：`projectV4Intervention` 的返回值不可空——lane 那条链上「announce 了却没画」
//     在编译期就不可能；
//   · 运行时断言：`assertAnnouncedCardRendered`（开发/测试抛，打包版出会说话的卡）。
// 本门岗补的是「有人在别处新长出一条静默分支」这一半——编译器和断言都看不见的那一半。
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const BASELINE_FILE = path.join(repoRoot, 'scripts', 'announced-card-rendered-baseline.json')
const UPDATE = process.argv.includes('--update-baseline')
const SELFTEST = process.argv.includes('--selftest')

/**
 * announce → render 这条链上的文件。路径变了要同步：找不到就报红，不静默通过
 * （一道扫不到东西的门岗比没有门岗更坏，它会让人以为这一族被看着）。
 */
const WATCHED = [
  // 宿主投影与它的两道通道
  'electron/capabilityCore/appIntegrationSpendConfirm.ts',
  'electron/productionRun/productionActionIpc.ts',
  'electron/productionRun/productionPendingSpend.ts',
  // 渲染层：读 → 投影 → 摆进槽
  'src/workbench/ai/v4/useAgentPanelSpendConfirm.ts',
  'src/workbench/ai/v4/agentPanelV4Intervention.ts',
  'src/workbench/ai/v4/agentPanelSpendCard.ts',
  'src/workbench/ai/v4/useAgentPanelV4Data.ts',
  'src/workbench/ai/ProjectAgentResidentShell.tsx',
]

/**
 * 判据里的那一半否定：catch 里只要把失败说出去了就不算这一族（渲会说话的卡 / 记下失败状态 /
 * 重新抛 / 把原因交给读通道）。这一族的病不是「catch 了」，是「catch 完假装没事」。
 */
const LOUD_MARKERS = /missingInterventionCard|traceMissingInterventionCard|setReadFailure|\bthrow\b|recordPendingSpendInstallFailure/

const COLLAPSES_TO_EMPTY = /\breturn\s*(?:\[\s*\]|undefined|null)\s*[;}]|\bset[A-Z]\w*\(\s*(?:undefined|null|\[\s*\])\s*\)/

const RULES = [
  {
    id: 'silent-catch',
    why: '`catch` 里收成空（return []/undefined/null 或 setX(空)）却一个字都不说 = 把「我读不到」说成「没有要确认的东西」。',
    kind: 'catch',
  },
  {
    id: 'optional-call-defaults-empty',
    why: '`something?.read(…) ?? []` = 通道不在时回空，「没装起来」和「没有」分不开。',
    kind: 'expression',
    pattern: /\?\.[A-Za-z_$][\w$]*\([^()]{0,200}\)\s*\?\?\s*(?:\[\s*\]|undefined|null)/g,
  },
]

/**
 * 去掉注释和字符串字面量再扫。
 *
 * 不做这一步，门岗就会抓到讲述这个病的那段注释——本门岗第一版就这么翻的车：修好的代码
 * 旁边写着「这里原来是 catch 回空数组」，门岗照样报红。一道会被自己的说明文字触发的门岗，
 * 只会教人不写说明。
 */
function stripCommentsAndStrings(source) {
  let out = ''
  let i = 0
  while (i < source.length) {
    const two = source.slice(i, i + 2)
    if (two === '//') {
      const end = source.indexOf('\n', i)
      const stop = end < 0 ? source.length : end
      out += ' '.repeat(stop - i)
      i = stop
    } else if (two === '/*') {
      const end = source.indexOf('*/', i + 2)
      const stop = end < 0 ? source.length : end + 2
      out += source.slice(i, stop).replace(/[^\n]/g, ' ')
      i = stop
    } else if (source[i] === '"' || source[i] === "'" || source[i] === '`') {
      const quote = source[i]
      let j = i + 1
      while (j < source.length && source[j] !== quote) j += source[j] === '\\' ? 2 : 1
      const stop = Math.min(j + 1, source.length)
      out += source.slice(i, stop).replace(/[^\n]/g, ' ')
      i = stop
    } else {
      out += source[i]
      i += 1
    }
  }
  return out
}

/** 从 `catch` 的 `{` 起做括号配对，取出整个块。 */
function catchBlocks(source) {
  const blocks = []
  for (const match of source.matchAll(/\bcatch\s*(?:\([^)]*\))?\s*\{/g)) {
    const start = source.indexOf('{', match.index)
    let depth = 0
    let end = -1
    for (let i = start; i < source.length; i += 1) {
      if (source[i] === '{') depth += 1
      else if (source[i] === '}') { depth -= 1; if (depth === 0) { end = i; break } }
    }
    if (end > 0) blocks.push({ index: start, text: source.slice(start, end + 1) })
  }
  return blocks
}

function lineOf(source, index) {
  return source.slice(0, index).split('\n').length
}

function scan(relative, raw) {
  const source = stripCommentsAndStrings(raw)
  const hits = []
  for (const rule of RULES) {
    if (rule.kind === 'catch') {
      for (const block of catchBlocks(source)) {
        if (!COLLAPSES_TO_EMPTY.test(block.text)) continue
        if (LOUD_MARKERS.test(block.text)) continue
        hits.push({ key: `${relative} :: ${rule.id}`, why: rule.why, line: lineOf(source, block.index), snippet: block.text.replace(/\s+/g, ' ').slice(0, 100) })
      }
      continue
    }
    rule.pattern.lastIndex = 0
    for (const match of source.matchAll(rule.pattern)) {
      hits.push({ key: `${relative} :: ${rule.id}`, why: rule.why, line: lineOf(source, match.index), snippet: match[0].replace(/\s+/g, ' ').slice(0, 100) })
    }
  }
  return hits
}

function read(relative) {
  const absolute = path.join(repoRoot, relative)
  if (!fs.existsSync(absolute)) {
    console.error(`✗ 确认卡渲染门岗：受检文件不存在：${relative}`)
    console.error('  → 文件被挪走或改名了。同步本门岗的 WATCHED，别让它静默失效。')
    process.exit(1)
  }
  return fs.readFileSync(absolute, 'utf8')
}

// ── R17：加规则先验它会红 ─────────────────────────────────────────────────────
if (SELFTEST) {
  const positives = {
    'silent-catch': 'async function f(){ try { return await g() } catch { return [] } }',
    'optional-call-defaults-empty': 'export function list(id){ return actions?.listPendingSpend(id) ?? [] }',
  }
  const negatives = {
    'silent-catch': 'async function f(){ try { return await g() } catch (e) { setReadFailure(reasonOf(e)); return undefined } }',
    'optional-call-defaults-empty': 'export function list(id){ if (!actions) throw new Error("x"); return actions.listPendingSpend(id) }',
  }
  const commentOnly = '// 原来这里是 catch { return [] } 以及 actions?.list(id) ?? []\nconst x = 1\n'
  let failed = false
  for (const rule of RULES) {
    const hit = (text) => scan('fixture.ts', text).filter((entry) => entry.key.endsWith(rule.id)).length
    if (!positives[rule.id] || hit(positives[rule.id]) === 0) {
      console.error(`✗ 自检：规则 ${rule.id} 抓不到自己的夹具——它是死规则`); failed = true
    }
    if (hit(negatives[rule.id]) > 0) {
      console.error(`✗ 自检：规则 ${rule.id} 抓到了已经修好的写法——它会教人别修`); failed = true
    }
    if (hit(commentOnly) > 0) {
      console.error(`✗ 自检：规则 ${rule.id} 被注释触发了——它会教人别写说明`); failed = true
    }
  }
  if (failed) process.exit(1)
  console.log(`✓ 确认卡渲染门岗自检通过：${RULES.length} 条规则各自抓得到、不误伤修好的写法、不被注释触发`)
  process.exit(0)
}

const found = []
for (const relative of WATCHED) found.push(...scan(relative, read(relative)))

const counts = new Map()
for (const hit of found) counts.set(hit.key, (counts.get(hit.key) ?? 0) + 1)

if (UPDATE) {
  const allowed = Object.fromEntries([...counts.entries()].sort(([a], [b]) => a.localeCompare(b)))
  fs.writeFileSync(BASELINE_FILE, `${JSON.stringify({
    _why: '「声称有卡却什么都没画」这一族的存量基线（棘轮：只减不增）。键是「文件 :: 规则」，值是条数。',
    _how_to_shrink: '把那条分支改成会说话的失败：主进程抛、渲染层渲 missingInterventionCard。不许靠加豁免清账。',
    allowed,
  }, null, 2)}\n`)
  console.log(`已重拍基线：${found.length} 条`)
  process.exit(0)
}

const baseline = JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8'))
const allowed = baseline.allowed ?? {}

let red = false
for (const [key, count] of [...counts.entries()].sort(([a], [b]) => a.localeCompare(b))) {
  const budget = allowed[key] ?? 0
  if (count > budget) {
    red = true
    console.error(`✗ 确认卡渲染门岗失败：${key} 有 ${count} 处「失败写成空、一声不吭」（基线 ${budget}）`)
    for (const hit of found.filter((entry) => entry.key === key)) {
      console.error(`    ${key.split(' :: ')[0]}:${hit.line}  ${hit.snippet}`)
      console.error(`      为什么它是这一族：${hit.why}`)
    }
  }
}
for (const [key, budget] of Object.entries(allowed)) {
  const count = counts.get(key) ?? 0
  if (count < budget) {
    red = true
    console.error(`↓ 存量减少：${key} 实测 ${count} < 基线 ${budget}，请跑 --update-baseline 收紧`)
  }
}

if (red) {
  console.error('  → 这一族的规矩：announce 说有一条在等用户，render 就必须画出点什么。')
  console.error('    读不到 → 主进程抛、渲染层渲 missingInterventionCard（会说话的卡）；')
  console.error('    认不出 → 让类型不可空，交给编译器拦（`projectV4Intervention` 已是这么做的）。')
  console.error('    「回个空数组先跑起来」是这一族的病因，不是它的解法。')
  process.exit(1)
}

console.log(`✓ 确认卡渲染门岗通过：${WATCHED.length} 个受检文件，${found.length} 处存量（基线内），无新增静默分支`)
