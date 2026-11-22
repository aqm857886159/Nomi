#!/usr/bin/env node
// 派工书检查（省 token 与方向检查在派工那一步的执行点）：协调会话发任务书前跑一遍。
//   node scripts/check-dispatch-brief.mjs <任务书.md>
// 基础七项：① 写了范围；② 写了不碰清单；③ 写了停点（做到哪就停）；④ 若是修补第 3 轮及以上，必须引用方向检查复盘文档；⑤ 讲到模型可见工具改动，必须引用模型可见工具必读清单；
// ⑥ 实现线任务书要有一行「删掉：选 / 不选，理由」（P5 三条路里的「删掉」，只写在规则里时会被跳过）；⑦ 删东西不许写成「全仓搜到就删」，范围按归属列文件。
// ⑧ 实现类和设计类要答「调用方：」一行（不改已有函数的行为，或改哪个函数 + 数法 + 文件数 + 后果表）。
// ⑨ 任务书点到的路径命中交接处表（docs/engineering/seams.json）里的某一处、且这一处 14 天内已经修过 ≥1 次（这一刀是第 2 次）：
//    要有一行「交接处：<名字>，读了 <全图路径>」或「交接处：<名字>，不算同一处：<理由>」；表外路径照旧。
// ⑩ 实现线和验收线的目标合同：做完只按「目标：」那句判，判据要能失败——写明目标测试在「什么都不做」「全部拦下」两个没做成的版本上都红
//    （全部拦下确无意义可写「全部拦下不适用：<理由>」，什么都不做不许豁免）；实现线自验另要设计卡 ★9 反例红绿（明确纯测试 / 文档 / 配置任务只免这一项）。
// 另查范围内存在文件的热点（复用原计数器；文件热点缺方向文档拦，目录 / 概念只提示）。
// 界面任务还须引用设计系统。声明用关键词判，热点只读 Git，不调模型；退出码 1 = 缺项（派工前补齐）。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { directionMessage, findHotspots, loadHistory, seamFixCommits } from './fix-churn.mjs'
import { loadSeams, SEAM_WINDOW_DAYS } from './fix-churn-units.mjs'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const CHECKS = [
  { key: '范围', re: /范围|scope|只(许)?改|仅改/i, hint: '写清改哪些文件 / 概念（范围）' },
  { key: '不碰清单', re: /不碰|禁触|不许碰|禁止碰|do not touch/i, hint: '写不碰清单（哪些文件、目录、私有资料不许动）' },
  { key: '停点', re: /停点|停下|就停|做到.{0,12}停|stop (at|when|after)/i, hint: '写停点（例如「样张出来就停」「卡住 3 次就停下报告」）' },
]
const ROUND = /第\s*([0-9]+|[一二三四五六七八九十]+)\s*轮|round\s*([0-9]+)/i
const CN = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 }
const REVIEW_REF = /Direction-Check|方向检查|类根因复盘|direction-check/i
const MODEL_FACING_TOOL_CHANGE = /模型可见工具|读动词|新动词|动词定义|VERB_DECLARATIONS|verbDeclarations|modelFacingTool|工具\s*schema|tool\s*schema/i
const MODEL_FACING_TOOL_CHECKLIST = /model-facing-tool-checklist\.md/i
// ⑥ 一行答案，形如「删掉：选。上游已下线…」或「删掉：不选，…」。
const DELETE_ANSWER = /^\s*[-*]?\s*\**删掉\**\s*[：:]\s*\S/m
// ⑧ 实现类和设计类要有一行「调用方：」：不改已有函数的行为，或写清改哪个函数 + 数法 + 文件数 + 后果表。
const CALLER_LINE = /^\s*[-*]?\s*\**调用方\**\s*[：:]\s*(\S.*)$/m
const CALLER_UNCHANGED = /^不改已有函数的行为/
const CALLER_HINT = '改已有函数的行为前要先数清谁在用、每一处改后会怎样；不改就写「调用方：不改已有函数的行为」，要改就写「调用方：改 <函数名>；数法 <能重跑的命令>；共 <N> 个文件；后果表 <路径或见下>」'
const PLACEHOLDER = /[<＜>＞]/
const TABLE_COLUMNS = [/调用方/, /靠它|依赖|靠什么/, /改后|后果|会怎样/]
// ⑦ 「搜到哪删到哪」：同名的东西可能属于别家供应商、共享表、录下来的数据和历史文档。
// 形状 = 先搜（grep / 全仓 / 搜到 / 所有出现）再对搜到的「逐处 / 都 / 就」删。核对用的「全仓 grep 指向已删文件」和点名文件里删条目都不算。
const WHOLE_REPO_DELETE = /(grep|全仓|整个仓库|搜到|所有出现)[^\n。]{0,40}(逐处|每一?处|全部|都|就)\s*(删|改或删)/i


// 豁免必须独占声明行，正文举例或「纯文档 + 代码」不算。
const CHECK_ONLY = /^\s*(?:#{1,6}\s*)?(?:[-*]\s*)?(?:(?:任务类型|类别|声明|范围)\s*[：:]\s*)?(?:纯|只改)(?:测试|文档|配置)(?:\s*[/、+与和]\s*(?:纯)?(?:测试|文档|配置))*[。；\s]*$/m
// ⑩ 目标合同。没做成的版本和「红」要在同一句里（句号或换行断句）。
const GOAL_LINE = /^[ \t]*[-*]?[ \t]*\**目标\**[ \t]*[：:][ \t]*\S/m
const DO_NOTHING = /什么(?:都|也)不做|不做任何(?:改动|事)/
const BLOCK_ALL = /全部(?:拦下|拦住|拒绝|挡住)|一律(?:拦|拒|挡)|全拦/
const BLOCK_ALL_NA = /^[ \t]*[-*]?[ \t]*\**全部拦下不适用\**[ \t]*[：:][ \t]*(\S.*)$/m
const COUNTEREXAMPLE = [/设计卡/, /★\s*9/, /每条/, /反例/, /改坏[^。\n]*红/, /还原[^。\n]*绿/, /日志[^。\n]*报告/]

function briefSection(text, name) {
  const lines = text.split(/\r?\n/)
  const matches = (line) => new RegExp(`^\\s*(?:#{1,6}\\s*)?(?:${name})(?:[：:（(\\s]|$)`, 'i').test(line)
  let start = lines.findIndex((line) => /^\s*#{1,6}\s/.test(line) && matches(line))
  if (start < 0) start = lines.findIndex(matches)
  if (start < 0) return ''
  const level = lines[start].match(/^\s*(#+)/)?.[1].length ?? 6
  const end = lines.findIndex((line, i) => i > start && /^#{1,6}\s/.test(line) && line.match(/^#+/)[0].length <= level)
  return lines.slice(start, end < 0 ? undefined : end).join('\n')
}

export function roundNumber(text) {
  const m = ROUND.exec(text)
  if (!m) return 0
  const raw = m[1] || m[2]
  return /^\d+$/.test(raw) ? Number(raw) : (CN[raw] ?? (raw.length === 2 && raw[0] === '十' ? 10 + (CN[raw[1]] ?? 0) : 0))
}

/** 实现线：文件名 I- 开头（协调派线命名），或正文自称实现线。 */
/** 设计线：文件名 D- 开头（协调派线命名），或正文第一行自称设计线（调研 / 验收线不算）。 */
export function isDesignBrief(text, file = '') {
  const first = text.split('\n', 1)[0]
  return /^D-/.test(path.basename(file)) || (/设计线/.test(first) && !/调研线|验收线/.test(first))
}

/** 有没有一张表：表头三列意思都在（调用方 / 靠它什么 / 改后会怎样），表头后至少一行有内容。 */
function hasConsequenceTable(text) {
  const lines = text.split(/\r?\n/)
  return lines.some((line, i) => {
    if (!/^\s*\|/.test(line) || !TABLE_COLUMNS.every((re) => re.test(line))) return false
    let j = i + 1
    if (/^\s*\|[\s:|-]+\|?\s*$/.test(lines[j] ?? '')) j += 1
    return /^\s*\|/.test(lines[j] ?? '') && /[^\s|]/.test(lines[j])
  })
}

/** 「调用方：」作答的缺项说明（空数组 = 通过）。 */
export function callerAnswerProblems(text) {
  const body = text.replace(/```[\s\S]*?```/g, '')
  const answer = CALLER_LINE.exec(body)?.[1].trim()
  const fix = `。${CALLER_HINT}`
  if (!answer) return [`缺「调用方：」作答${fix}`]
  if (CALLER_UNCHANGED.test(answer)) return []
  const field = (re) => { const v = re.exec(answer)?.[1]?.trim(); return v && !PLACEHOLDER.test(v) ? v : '' }
  const missing = []
  if (!field(/^改\s*([^；;]+)/)) missing.push('改哪个函数')
  if (!field(/数法\s*([^；;]+)/)) missing.push('数法（一条能重跑的命令）')
  if (!field(/共\s*(\d+)\s*个文件/)) missing.push('共几个文件')
  const table = field(/后果表\s*([^；;。]+)/)
  if (!table) missing.push('后果表（路径或「见下」）')
  else if (/^见下/.test(table) && !hasConsequenceTable(body)) missing.push('后果表本身（写了「见下」，但没有表头含「调用方」「靠它什么」「改后会怎样」三列、至少一行的表）')
  return missing.length ? [`「调用方：」作答不全，缺${missing.join('、')}${fix}`] : []
}

// ⑨ 交接处
const SEAM_LINE = /^\s*[-*]?\s*\**交接处\**\s*[：:]\s*(\S.*)$/gm
const SEAM_HINT = '任务书里加一行「交接处：<这一处的名字>，读了 <全图路径>」，或「交接处：<这一处的名字>，不算同一处：<理由>」；没有全图就先画（画完登记进 docs/engineering/seams.json）'

/** 任务书里点到的路径（反引号里带 / 的），取范围一节；没有范围一节就取全文。绝对路径剥到仓库内相对部分。 */
export function briefPaths(text) {
  const body = text.replace(/```[\s\S]*?```/g, '')
  const scope = briefSection(body, '范围|scope').split(/^\s*(?:不在范围|范围外)[：:]/m, 1)[0]
  const source = scope || body
  return [...new Set([...source.matchAll(/`([^`\s]+\/[^`\s]*)`/g)].map((m) => m[1].replace(/^\/.*?\/(electron|src|tests|scripts)\//, '$1/').replace(/\*+$/, '')))]
}

/** 「读了 <路径>」里的路径要在仓库里真实存在。 */
const mapExists = (root, raw) => {
  const rel = raw.replace(/^[`'"「（(]+|[`'"」）)，。；,.;]+$/g, '')
  return rel !== '' && !path.isAbsolute(rel) && !rel.split(/[\\/]/).includes('..') && fs.existsSync(path.join(root, rel))
}

/** ⑨ 交接处检查：返回缺项说明（空 = 通过）。seams / history 可注入（测试用），默认读仓库表与 ref 上近 14 天的历史。 */
export function seamProblems(text, { root = REPO_ROOT, ref = 'origin/main', seams, history, now = Date.now() } = {}) {
  const paths = briefPaths(text)
  const table = (seams ?? loadSeams(root)).filter((seam) => paths.some((p) => seam.patterns.some((prefix) => p.startsWith(prefix))))
  if (!table.length) return []
  const log = history ?? loadHistory(root, { ref, days: SEAM_WINDOW_DAYS })
  const lines = [...text.replace(/```[\s\S]*?```/g, '').matchAll(SEAM_LINE)].map((m) => m[1])
  const problems = []
  for (const seam of table) {
    const fixes = seamFixCommits(log, now, seam)
    if (fixes.length < seam.prior) continue
    const answered = lines.some((line) => (line.includes(seam.name) || line.includes(seam.id)) && (
      /不算同一处\s*[：:]\s*\S/.test(line) || [...line.matchAll(/读了\s*(\S+)/g)].some((m) => mapExists(root, m[1]))))
    if (answered) continue
    problems.push([
      `${seam.label}${seam.checked ? '' : '（这一行的路径范围没核过，可能误伤；确实不是同一处就写「不算同一处：<理由>」）'}近 ${SEAM_WINDOW_DAYS} 天已修过 ${fixes.length} 次，这一刀是第 ${fixes.length + 1} 次，先停下看它的全图，没有就先画：`,
      ...fixes.slice(0, 12).map((c) => `    ${c.sha.slice(0, 9)} ${c.subject.slice(0, 80)}`),
      ...(fixes.length > 12 ? [`    …另 ${fixes.length - 12} 个`] : []),
      `  全图：${seam.map ?? '还没有，先画'}`,
      `  ${SEAM_HINT}`,
    ].join('\n'))
  }
  return problems
}

export function isImplementationBrief(text, file = '') {
  return /^I-/.test(path.basename(file)) || /实现线/.test(text.split('\n', 1)[0])
}

/** 验收线：文件名 V- 开头（协调派线命名），或正文第一行自称验收线。 */
export function isAcceptanceBrief(text, file = '') {
  return /^V-/.test(path.basename(file)) || /验收线/.test(text.split('\n', 1)[0])
}

/** ⑩ 目标合同的缺项说明（空数组 = 通过）。 */
export function goalContractProblems(text, { implementation = false } = {}) {
  const body = text.replace(/```[\s\S]*?```/g, '')
  const saysRed = (version) => body.split(/[。\n]/).some((sentence) => version.test(sentence) && /红/.test(sentence))
  const blockAllNa = BLOCK_ALL_NA.exec(body)?.[1].trim()
  const missing = []
  if (!GOAL_LINE.test(body)) missing.push('以「目标：」开头的一行（依赖结果的一方要做成什么、做成时看见什么）')
  if (!saysRed(DO_NOTHING)) missing.push('「什么都不做」时目标测试必须红（这半句不能豁免）')
  if (!saysRed(BLOCK_ALL) && !(blockAllNa && !PLACEHOLDER.test(blockAllNa))) missing.push('「全部拦下」时目标测试必须红（确实没有意义就写一行「全部拦下不适用：<理由>」）')
  if (implementation && !CHECK_ONLY.test(text) && !COUNTEREXAMPLE.every((re) => re.test(briefSection(text, '自验')))) {
    missing.push('自验里「设计卡 ★9 每条反例改坏 → 红、还原 → 绿，日志进报告」（只有明确声明纯测试 / 纯文档 / 纯配置的任务免这一项）')
  }
  return missing.length ? [`缺目标合同（做完只按目标判，判据要能失败）：${missing.join('；')}`] : []
}

/** 返回缺项说明数组（空 = 通过）；热点只读 Git，提示写入 warnings。 */
export function checkDispatchBrief(text, { implementation = false, design = false, acceptance = false, root = REPO_ROOT, ref = 'origin/main', warnings = [], seamOptions = {} } = {}) {
  const problems = []
  for (const c of CHECKS) if (!c.re.test(text)) problems.push(`缺${c.key}：${c.hint}`)
  const n = roundNumber(text)
  if (n >= 3 && !REVIEW_REF.test(text)) problems.push(`这是第 ${n} 轮修补：同一处第 3 轮就停，改派类根因复盘（docs/engineering/direction-check-template.md），任务书里要引用复盘文档`)
  if (MODEL_FACING_TOOL_CHANGE.test(text) && !MODEL_FACING_TOOL_CHECKLIST.test(text)) problems.push('讲到模型可见工具改动：任务书必须引用 docs/engineering/model-facing-tool-checklist.md（先调研再动代码）')
  if (implementation && !DELETE_ANSWER.test(text)) problems.push('缺「删掉：」一行：先答这件事能不能直接删（选 / 不选，加一句理由），再写怎么修或怎么做（CLAUDE.md P5 三条路）')
  if (implementation || design) problems.push(...callerAnswerProblems(text))
  if (implementation || acceptance) problems.push(...goalContractProblems(text, { implementation }))
  const scope = briefSection(text, '范围|scope').split(/^\s*(?:不在范围|范围外)[：:]/m, 1)[0]
  // 流程批准不是界面拍板，明确排除的界面也不触发设计要求。
  const interfaceText = text.replace(/^\s*(?:不在范围|范围外)[：:][^\n]*/gm, '').replace(/[^。\n]*用户[^。\n]*拍板[^。\n]*/g, (sentence) => /界面|样张|拍板图/.test(sentence) ? sentence : '')
  const scopedPaths = [...new Set([...scope.matchAll(/`([^`\n]+)`/g)].map((m) => m[1]))]
  if ((/界面|样张|拍板/.test(interfaceText) || scopedPaths.some((file) => /^src\/.+\.tsx$/.test(file) && !/\.(test|spec)\.tsx$/.test(file))) && !/docs\/design\/nomi-design-system\.md(?:#[^\s`)]*)?/.test(text)) {
    problems.push('缺设计系统引用：范围含 src/ 下 .tsx 界面文件或正文提到界面 / 样张 / 拍板时，必须引用 docs/design/nomi-design-system.md（可带章节）')
  }
  const files = scopedPaths.filter((file) =>
    !path.isAbsolute(file) && !file.split(/[\\/]/).includes('..') && fs.existsSync(path.join(root, file)) && fs.statSync(path.join(root, file)).isFile())
  const hits = files.length ? findHotspots(root, files, { ref }) : []
  const fileHits = hits.filter((hit) => !hit.unit && hit.reasons.some((reason) => !reason.startsWith('目录 ')))
  const advisory = hits.filter((hit) => !fileHits.includes(hit))
  if (advisory.length) warnings.push(`仅提示（目录 / 概念热点，不拦）：\n${advisory.map((hit) => `${hit.path}：${hit.reasons.join('；')}`).join('\n')}`)
  if (fileHits.length && !/docs\/engineering\/direction-checks\/[^\s`#)]+\.md(?:#[^\s`)]*)?/.test(text)) {
    problems.push(`${directionMessage(fileHits)}\n先派独立方向检查，并在任务书引用 docs/engineering/direction-checks/ 下的方向检查文档`)
  }
  problems.push(...seamProblems(text, { root, ref, ...seamOptions }))
  // 「」引号里、代码块里的是举例（讲反面例子、测试样本），不是指令。
  const instructions = text.replace(/```[\s\S]*?```/g, '').replace(/「[^」\n]*」/g, '')
  const wide = WHOLE_REPO_DELETE.exec(instructions)
  if (wide) problems.push(`删除范围写成了「搜到就删」（${wide[0].slice(0, 40)}）：按归属列出只许改的文件，搜索只用来最后核对剩下什么`)
  return problems
}

function main() {
  const file = process.argv[2]
  if (!file || !fs.existsSync(file)) { console.error('用法：node scripts/check-dispatch-brief.mjs <任务书.md>'); return 2 }
  const text = fs.readFileSync(file, 'utf8')
  const warnings = []
  const problems = checkDispatchBrief(text, { implementation: isImplementationBrief(text, file), design: isDesignBrief(text, file), acceptance: isAcceptanceBrief(text, file), warnings })
  for (const warning of warnings) console.warn(warning)
  if (!problems.length) { console.log('派工书检查：范围、不碰清单、停点、删不删、调用方、删除范围齐全，第 3 轮复盘、模型可见工具清单、目标合同、热点方向检查与设计系统引用检查通过。'); return 0 }
  console.error(`派工书检查：${problems.length} 项缺失\n${problems.map((p) => `  · ${p}`).join('\n')}`)
  return 1
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main())
