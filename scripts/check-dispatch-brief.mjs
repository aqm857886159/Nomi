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
// ⑪ 11-22 起从协调本机私有脚本搬进来的通用规则（不读计划表 / 决定账本 / 创作者动作图的那些），见 orchestrationProblems：
//    不许叫子线本机跑全量（放行写「本机全量：<理由>」）；实现线要写量到它的走查、推送前快检、eslint、正文判据；
//    出图要写「同类产品：」；方向复盘 / 碰热点的「同类产品：」不许写不适用；界面验收要真点；起真窗要提 verify-nomi；
//    登记自写要提先查别人；照板做界面要写对照表；本机回环要写 NO_PROXY 与改道；Claude 子线要写临时文件去处与独立工作树。
//    报错文字直接写「补哪一句」；「证据目录」由任务书自己写，检查只认句式不认路径。
// 另查范围内存在文件的热点（复用原计数器；文件热点缺方向文档拦，目录 / 概念只提示）。
// 界面任务还须引用设计系统。声明用关键词判，热点只读 Git，不调模型；退出码 1 = 缺项（派工前补齐）。
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { directionMessage, findHotspots, loadHistory, seamFixCommits } from './fix-churn.mjs'
import { loadSeams, SEAM_WINDOW_DAYS } from './fix-churn-units.mjs'

const loadModule = createRequire(import.meta.url)
let capabilityIndexCache
const capabilityIndexMod = () => (capabilityIndexCache ??= loadModule('./build-capability-index.mjs'))

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

// ⑪ 通用规则（原协调本机 brief-check.mjs，不读私有数据的部分）。
// 11-22 加：任务书不许叫子线在本机跑全量（全量单测 / gates:contracts / 设计实验室 / 整套门岗）。这些 CI 每次都跑，
// 本机再跑一遍要排重命令锁：11-22 GPT-6 线 126 分钟、弹窗外壳线 167 分钟，大头都在这（和 R11「推送前只跑快检，完整门岗交 CI」矛盾）。
// 子线只跑定向测试、eslint、推送前快检；全量看 CI。真要本机跑，写一行「本机全量：<为什么 CI 替不了>」。
const FULL_RUN = /(`pnpm (run )?test`|全量\s*`?pnpm (run )?test|gates:contracts|check:design-lab|gates:design-lab|gates:full|`pnpm run gates`)/
const NOT_LOCAL = /CI|不跑|不要跑|别跑|不在本机|不用跑/
const LOCAL_FULL_LINE = /^本机全量：\S/m
// 原第 4 条（要实现线本机先跑 gates:contracts / 设计实验室 / 全量测试）已删：要保住的是「别让验收白做」，现在推送后 CI 和独立验收并行，CI 红了修完只复验增量。这里不再要求任何东西。

// 否定说法不算提到：「不起窗口」「不改界面」「不截图」「别碰拍板图」这类写在不碰清单 / 声明里的句子，
// 正说明这份任务书不做那件事，不该触发「要起真窗 / 要引设计系统」这类要求。
// 来由：11-22 协调派只读线时，「不起窗口」「不改界面」各触发一次误报，只能改措辞绕开；搬进仓库后每条线都会撞上。
export function withoutNegatedMentions(text) {
  return String(text).replace(/(?:不|别|无需|不用|不必|没有|不要)(?:要|去|会)?(?:改|碰|动|起|开|拍|出|做|跑)?(?:真窗|真\s?App|起窗口?|窗口|界面|样张|拍板图?|截图|真点)/g, '')
}

/**
 * 派工通用规则：返回缺项说明（空数组 = 通过）。
 * name = 任务书文件名（I- / L- 开头算建造线、V- 开头算验收线）；hotspot = 范围内命中了文件热点（要方向检查的地方）。
 */
export function orchestrationProblems(text, { name = '', hotspot = false } = {}) {
  const problems = []
  const lines = text.split(/\r?\n/)
  const baseName = name.replace(/\.md$/, '')
  const isBuildLine = /^[IL]-/.test(baseName)
  const isAcceptance = /^V-/.test(baseName)
  const touchesProduct = /(^|[\s`（(])(src|electron)\//m.test(text)
  const touchesCode = /(^|[\s`（(])(src|electron|tests|scripts)\//m.test(text)
  const configOnly = /^声明：纯(配置|文档|测试)/m.test(text)

  // 不许叫子线本机跑全量
  if (!LOCAL_FULL_LINE.test(text)) {
    for (const [i, line] of lines.entries()) {
      if (FULL_RUN.test(line) && !NOT_LOCAL.test(line)) {
        problems.push(`第 ${i + 1} 行要子线本机跑全量（CI 会跑，本机跑要排锁）：${line.trim().slice(0, 120)}。改成「定向测试 + eslint + 推送前快检，全量看 CI」；确实 CI 替不了就加一行「本机全量：<理由>」`)
      }
    }
  }
  // 4b 改产品界面结构的实现线，要先找出「量到它的走查」并在本机跑（走查 CI 不跑）。
  // 来由：2026-11-14 窄窗外壳 PR 把 Skill 钮的文字包进一个 span，线上才跑的一条走查用「子元素 == ['svg']」量这颗钮，推上去才红。
  if (isBuildLine && touchesProduct && !configOnly && !text.includes('量到它的走查')) {
    problems.push('改产品代码的实现线要写明：改了哪些带 data-* 标记的元素，就在 tests/ux 里按标记找出「量到它的走查」（walk 和 .test.mjs 两种文件都算），全部在本机跑一遍；任务书里补一句含「量到它的走查」的话')
  }
  // 4d 要交 PR 正文草稿的实现线，必须自己先跑一遍正文判据（来由：2026-11-14 发送前核输入那条线交回的正文缺 5 节，协调补了三轮）。
  if (isBuildLine && /\.tmp-pr-body\.md/.test(text) && !text.includes('check-pr-judgement')) {
    problems.push('这份任务书要线交 PR 正文草稿，缺一句让它自己先跑正文判据：NOMI_PR_BODY="$(cat .tmp-pr-body.md)" NOMI_PR_JUDGEMENT_STAGE=merge node scripts/check-pr-judgement.mjs --pr（除「独立验收」几条外要清零，输出贴进报告）')
  }
  // （原 4g「新加扫描守卫要登记进推送前扫描名单」11-21 删：按写法扫描只算提示；登记核对由 4h 的推送前快检整套覆盖。）
  // 4h 实现线交回前自己把推送前快检整套跑一遍（来由：2026-11-17 一晚上三条线的推送各被拦一次，都是推送前快检里有、线自己没跑的）。
  if (isBuildLine && touchesProduct && !configOnly && !text.includes('pre-push-contracts')) {
    problems.push('实现线任务书缺一句：提交后、交回前跑一遍推送前快检 `env NOMI_PR_BODY_FILE=.tmp-pr-body.md node scripts/pre-push-contracts.mjs`（约 2 分钟，走锁），红的修完再交')
  }
  // 4f 改代码的实现线，交回前要对自己改过的文件跑代码检查，新增警告为 0（来由：2026-11-14 修补线留了没用到的变量，推送前才红）。
  if (isBuildLine && touchesCode && !/^声明：纯(配置|文档)/m.test(text) && !/eslint/.test(text)) {
    problems.push('改代码的实现线，交回前要对自己改过的文件跑代码检查，任务书里补一句：npx eslint $(git diff --name-only origin/main...HEAD -- "*.ts" "*.tsx" "*.mjs")，新增警告为 0')
  }
  // 4g（原编号沿用）给已开 PR 做修补的实现线，交的是并进完整正文之后的正文，并自己跑过正文判据（来由：2026-11-14 参数面板修补线只交增补，被挡）。
  if (isBuildLine && /正文增补|body-addendum/.test(text) && !text.includes('check-pr-judgement')) {
    problems.push('这份任务书让线交 PR 正文增补，要改成：把增补并进现有完整正文（gh pr view <号> --json body 取）存成 .tmp-pr-body.md，自己跑 NOMI_PR_BODY="$(cat .tmp-pr-body.md)" NOMI_PR_JUDGEMENT_STAGE=merge node scripts/check-pr-judgement.mjs --pr，除「独立验收」几条外清零')
  }
  // 5 出图 / 调研界面的任务书，必须写明同类产品由谁打开（来由：2026-11-14 设计流程数据分析，线打不开登录后的同类产品，只有协调能开）。
  if (/(出|画|交)(一版|几张)?(探索图|样张|探索稿|板稿)/.test(text) && !/^[VL]-/.test(baseName) && !configOnly && !/^同类产品：.+/m.test(text)) {
    problems.push('这份任务书要出图或调研界面，缺「同类产品：」一行：写清最接近的同类产品同一处的真截图在哪（协调先打开存好）、或「它没有这个东西，查了哪里」')
  }
  // 5b 把拍板清单 / 板源放进仓库的实现线，必须写明同类产品截图不进仓库（来由：2026-11-14 参数面板线把带同类产品真截图的板源整目录入库）。
  if (isBuildLine && /docs\/design\/boards\/|拍板清单入库|板源入库/.test(text) && !/截图不进仓库/.test(text)) {
    problems.push('这份任务书要把拍板清单 / 板源放进仓库，缺一句「同类产品截图不进仓库」（只记 sha256 和日期，图留在仓库外；入库前在板目录里搜一遍图片）')
  }
  // 5c 方向复盘线、以及碰了反复修的地方（热点 / 引用方向检查文档）的任务书：「同类产品：」不许写「不适用」。
  // 来由：2026-11-22 R-patch-vs-replace-replay——「补」压过「删 / 换」的漏口是复盘把问题问窄了；18/29 份写了「同类产品：」的任务书写「不适用」。
  const isDirectionReview = /类根因复盘/.test(text) || /^R-.*direction/.test(baseName)
  const ridesHotspot = hotspot || /docs\/engineering\/direction-checks\/[^\s`#)]+\.md/.test(text)
  if ((isDirectionReview || ridesHotspot) && !isAcceptance) {
    const peer = /^同类产品：(.*)$/m.exec(text)?.[1]?.trim() ?? ''
    const hasSource = /https?:\/\/|[\w./-]+\.[a-z]{1,5}:\d+|\/[\w-]+\/[\w.-]+\/[\w.-]+/.test(peer)
    if (!peer || /^不适用/.test(peer) || !hasSource) {
      problems.push('这份任务书是方向复盘、或碰了反复修的地方：补「同类产品：<这一整块事的名字>；<已经在用的库或标准（或我们自己唯一的主人）>；<文档出处：网址、Context7 库路径或 file:line>」，并让线答「我们哪里绕开了它」；不许写「不适用」')
    }
  }
  // 6 界面验收任务书，必须要求每个控件真点一次并写下点完之后创作者看见什么。
  if (isAcceptance && /界面|真窗|拍板/.test(withoutNegatedMentions(text)) && !/各点一次|真点一次|每个控件.*点/.test(text)) {
    problems.push('界面验收任务书要写明「每个控件真点一次，并写下点完之后创作者看见什么」')
  }
  // 7 要起真窗验证的任务书，必须指向共用的验证驱动和技能（来由：2026-11-15 量过 83 条线，36 条各自现写驱动脚本，用常驻驱动的 0 条）。
  if (/真窗|真 App|真点|每个控件真点一次|起窗|截图/.test(withoutNegatedMentions(text)) && !/^声明：不起窗口/m.test(text)) {
    for (const need of ['verify-nomi', 'verify-line-meter']) {
      if (!text.includes(need)) {
        problems.push(`这份任务书要起真窗验证，却没提 ${need}：验证一节写「用 verify-nomi 技能（node tests/ux/ui.mjs up … → goto <功能名>）」，点名从哪个 goto 名出发、读回哪个标记或文案，并要求报告交 node scripts/verify-line-meter.mjs <证据目录> 那一行；确实不起窗口就写一行「声明：不起窗口」`)
      }
    }
  }
  // 8 登记自写 / 新增通用能力的任务书，必须要求把查证写成设计卡里的「## 先查别人」一节，并在交回前带正文跑那道门岗。
  if (isBuildLine && /登记[^\n]{0,12}自写|自写[^\n]{0,12}登记|self-written\.json|新增功能|新增通用/.test(text) && !/^声明：不登记自写/m.test(text)) {
    for (const need of ['先查别人', 'check-prior-art']) {
      if (!text.includes(need)) {
        problems.push(`这份任务书涉及自写 / 新增能力，却没提 ${need}：要求线在设计卡里写「## 先查别人」一节（≥3 条带 URL 或 file:line 的出处，只写真打开看过的），交回前跑 NOMI_PR_BODY="$(cat .tmp-pr-body.md)" node scripts/check-prior-art.mjs --pr；不登记自写就写一行「声明：不登记自写」`)
      }
    }
  }
  // 10 照拍板图做界面的实现线：要有「元素 × 状态 → 图上哪一块 → 组件 → 断言」对照表，交付要有并排图（来由：2026-11-16 付费确认拆 3 轮、模型面费用 5 轮，拍板图 / 清单 / 断言各说一套）。
  if (isBuildLine && !configOnly && /docs\/design\/boards\/|\.board\.json|拍板图|照板|照样张|对样张/.test(text)) {
    const row = /^对照表：\s*(\S.*)$/m.exec(text)
    const waived = row && /^不照板实现\s*[：:]\s*\S/.test(row[1])
    const tablePath = row && !waived ? row[1].split(/[\s（(，,]/)[0].replace(/^`|`$/g, '') : ''
    if (!row) problems.push('这份任务书照拍板图做界面，缺「对照表：<路径>」一行：派之前先由一条不写实现的线出「元素 × 状态 → 图上哪一块 → 组件 → 断言」对照表，任务书和断言只从表里抄；不是照板实现就写「对照表：不照板实现：<理由>」')
    else if (!waived && !fs.existsSync(tablePath)) problems.push(`「对照表：」指的文件不存在：${tablePath}。先出表再派`)
    if (!waived && !/并排图/.test(text)) {
      problems.push('照拍板图做界面的任务书，交付里要写明：每个已认领（implemented）的元素 × 每个状态，交同一次提交上出的「拍板图 | 真截图」并排图和一份逐行索引（元素 id · 状态 · 文件名 · 提交号），另一条线逐态核过才合')
    }
  }
  // 11 要本机回环 / 替身收报文的任务书（来由：2026-11-20 #1567 两轮验收没过都不是产品错：把「不碰代理」读成连子进程 NO_PROXY 也不许；自写探针没走改道）。
  const wantsLoopback = /本机回环|回环假服务|替身|本机假服务/.test(text)
  if (wantsLoopback && /不(改|碰|动)[^\n]{0,24}代理/.test(text) && !/NO_PROXY/.test(text)) {
    problems.push('这份任务书要走本机回环，又写了「不碰代理」类禁令，却没写清子进程 NO_PROXY 的口径：补一句「给自己起的子进程加 NO_PROXY=127.0.0.1,localhost 是允许的，不是停点」')
  }
  if (wantsLoopback && /报文|请求体|请求 ?body|\bPOST\b/.test(text)) {
    if (!/NOMI_TEST_NETWORK_REDIRECTS|startRehearsalStandIn/.test(text)) {
      problems.push('这份任务书要读替身收到的报文，却没点名现成改道：写明用 NOMI_TEST_NETWORK_REDIRECTS（源站 → 本机替身）或 startRehearsalStandIn，不让线自写函数级探针去接供应商地址')
    }
    if (!/金丝雀/.test(text) || !/金丝雀不过|替身收不到|函数级探针顶替/.test(text)) {
      problems.push('这份任务书要读替身报文，缺金丝雀两句：「先跑一条金丝雀，替身日志里有一行带方法、路径、请求体」和停点「金丝雀不过（替身收不到）就停这一步、写卡在哪，不许改用函数级探针顶替」')
    }
  }
  // 12 / 13 派给 Claude 子线（标题写 Claude）的任务书。
  const firstLine = lines[0] ?? ''
  // 12 临时文件不进共用草稿目录（来由：2026-11-21 两条 Claude 线都往协调会话的 scratchpad 写 commit-msg.txt，互相覆盖）。
  if (/Claude/.test(firstLine) && !/不(写|进|放)[^\n]{0,8}(草稿目录|scratchpad)/.test(text)) {
    problems.push('派给 Claude 子线的任务书缺一句：「提交说明、正文草稿、临时脚本和证据一律放 <证据目录>/<线名>/，不写草稿目录（scratchpad，几条线共用、会互相覆盖）」（<证据目录> 写任务书自己指定的目录）')
  }
  // 13 写代码的要在独立工作树里干，不能指定别人的现成工作树去写（来由：2026-11-21 L-editor-owner-door 指定别人的工作树，钩子拦了写）。
  if (/Claude/.test(firstLine) && /实现线|修补线|写代码/.test(firstLine) && !/独立工作树|isolation/.test(text)) {
    problems.push('派给 Claude 写代码子线的任务书要写明「在你自己的独立工作树里做（派时 isolation: worktree）；要接已有分支就 git checkout -b <分支>-2 <旧头>，旧工作树只读」，不要指定别人的工作树去写')
  }
  return problems
}

/** 返回缺项说明数组（空 = 通过）；热点只读 Git，提示写入 warnings。 */
export function checkDispatchBrief(text, { name = '', implementation = false, design = false, acceptance = false, root = REPO_ROOT, ref = 'origin/main', warnings = [], seamOptions = {} } = {}) {
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
  const interfaceText = withoutNegatedMentions(text).replace(/^\s*(?:不在范围|范围外)[：:][^\n]*/gm, '').replace(/[^。\n]*用户[^。\n]*拍板[^。\n]*/g, (sentence) => /界面|样张|拍板图/.test(sentence) ? sentence : '')
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
  problems.push(...orchestrationProblems(text, { name, hotspot: fileHits.length > 0 }))
  // 「」引号里、代码块里的是举例（讲反面例子、测试样本），不是指令。
  const instructions = text.replace(/```[\s\S]*?```/g, '').replace(/「[^」\n]*」/g, '')
  const wide = WHOLE_REPO_DELETE.exec(instructions)
  if (wide) problems.push(`删除范围写成了「搜到就删」（${wide[0].slice(0, 40)}）：按归属列出只许改的文件，搜索只用来最后核对剩下什么`)
  return problems
}

/**
 * T-8 自动发现触点 2：派工书校验时，按任务书提到的 src/ / electron/ 路径自动输出「已有主人与现成库」速查
 * （不依赖 Claude Code PreToolUse hook，覆盖蜂群 worker / Antigravity / Codex 等所有宿主，严格 ≤ 2500 字节）。
 */
export function briefCapabilityHints(text, { root = REPO_ROOT, registries = null } = {}) {
  const paths = briefPaths(text).filter((p) => /^(?:src|electron)\//.test(p) && !/\.(?:test|spec|e2e)\.[^.]+$/.test(p))
  if (paths.length === 0) return ''
  const { buildCapabilityIndex, loadRegistries } = capabilityIndexMod()
  let loaded = registries
  if (!loaded) {
    try { loaded = loadRegistries(root) } catch { return '' }
  }
  const primary = paths[0]
  const index = buildCapabilityIndex({ ...loaded, targetRel: primary, maxBytes: 2200 })
  if (!index.text) return ''
  return `【动手前自动发现 · 已有主人与现成库（按任务范围 ${primary}${paths.length > 1 ? ` 等 ${paths.length} 处` : ''}）】\n${index.text}`
}

function main() {
  const file = process.argv[2]
  if (!file || !fs.existsSync(file)) { console.error('用法：node scripts/check-dispatch-brief.mjs <任务书.md>'); return 2 }
  const text = fs.readFileSync(file, 'utf8')
  const warnings = []
  const problems = checkDispatchBrief(text, { name: path.basename(file), implementation: isImplementationBrief(text, file), design: isDesignBrief(text, file), acceptance: isAcceptanceBrief(text, file), warnings })
  for (const warning of warnings) console.warn(warning)
  if (problems.length) {
    console.error(`派工书检查：${problems.length} 项缺失\n${problems.map((p) => `  · ${p}`).join('\n')}`)
    return 1
  }
  const hints = briefCapabilityHints(text)
  if (hints) console.log(hints)
  console.log('派工书检查：范围、不碰清单、停点、删不删、调用方、删除范围齐全，第 3 轮复盘、模型可见工具清单、目标合同、热点方向检查与设计系统引用检查通过。')
  return 0
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main())
