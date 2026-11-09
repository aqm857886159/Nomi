#!/usr/bin/env node
// 派工书检查（省 token 与方向检查在派工那一步的执行点）：协调会话发任务书前跑一遍。
//   node scripts/check-dispatch-brief.mjs <任务书.md>
// 基础七项：① 写了范围；② 写了不碰清单；③ 写了停点（做到哪就停）；④ 若是修补第 3 轮及以上，必须引用方向检查复盘文档；⑤ 讲到模型可见工具改动，必须引用模型可见工具必读清单；
// ⑥ 实现线任务书要有一行「删掉：选 / 不选，理由」（P5 三条路里的「删掉」，只写在规则里时会被跳过）；⑦ 删东西不许写成「全仓搜到就删」，范围按归属列文件。
// 另查范围内存在文件的热点（复用原计数器；文件热点缺方向文档拦，目录 / 概念只提示）和实现任务自验的反例红绿合同（明确纯测试 / 文档 / 配置任务可免）。
// 只看有没有写，不判写得好不好；退出码 1 = 缺项（派工前补齐）。纯文本匹配，不调模型。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { directionMessage, findHotspots } from './fix-churn.mjs'

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
// ⑦ 「搜到哪删到哪」：同名的东西可能属于别家供应商、共享表、录下来的数据和历史文档。
// 形状 = 先搜（grep / 全仓 / 搜到 / 所有出现）再对搜到的「逐处 / 都 / 就」删。核对用的「全仓 grep 指向已删文件」和点名文件里删条目都不算。
const WHOLE_REPO_DELETE = /(grep|全仓|整个仓库|搜到|所有出现)[^\n。]{0,40}(逐处|每一?处|全部|都|就)\s*(删|改或删)/i


// 豁免必须独占声明行，正文举例或「纯文档 + 代码」不算。
const CHECK_ONLY = /^\s*(?:#{1,6}\s*)?(?:[-*]\s*)?(?:(?:任务类型|类别|声明|范围)\s*[：:]\s*)?(?:纯|只改)(?:测试|文档|配置)(?:\s*[/、+与和]\s*(?:纯)?(?:测试|文档|配置))*[。；\s]*$/m
const COUNTEREXAMPLE_CONTRACT = [/设计卡/, /★\s*9/, /每条/, /反例/, /改坏[^。\n]*红/, /还原[^。\n]*绿/, /日志[^。\n]*报告/]

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
export function isImplementationBrief(text, file = '') {
  return /^I-/.test(path.basename(file)) || /实现线/.test(text.split('\n', 1)[0])
}

/** 返回缺项说明数组（空 = 通过）；热点只读 Git，提示写入 warnings。 */
export function checkDispatchBrief(text, { implementation = false, root = REPO_ROOT, ref = 'origin/main', warnings = [] } = {}) {
  const problems = []
  for (const c of CHECKS) if (!c.re.test(text)) problems.push(`缺${c.key}：${c.hint}`)
  const n = roundNumber(text)
  if (n >= 3 && !REVIEW_REF.test(text)) problems.push(`这是第 ${n} 轮修补：同一处第 3 轮就停，改派类根因复盘（docs/engineering/direction-check-template.md），任务书里要引用复盘文档`)
  if (MODEL_FACING_TOOL_CHANGE.test(text) && !MODEL_FACING_TOOL_CHECKLIST.test(text)) problems.push('讲到模型可见工具改动：任务书必须引用 docs/engineering/model-facing-tool-checklist.md（先调研再动代码）')
  if (implementation && !DELETE_ANSWER.test(text)) problems.push('缺「删掉：」一行：先答这件事能不能直接删（选 / 不选，加一句理由），再写怎么修或怎么做（CLAUDE.md P5 三条路）')
  const selfCheck = briefSection(text, '自验')
  if (implementation && !CHECK_ONLY.test(text) && !COUNTEREXAMPLE_CONTRACT.every((re) => re.test(selfCheck))) {
    problems.push('缺反例红绿：自验必须要求「设计卡 ★9 每条反例改坏 → 红、还原 → 绿，日志进报告」；仅明确声明纯测试 / 纯文档 / 纯配置任务可豁免')
  }
  const scope = briefSection(text, '范围|scope')
  const files = [...new Set([...scope.matchAll(/`([^`\n]+)`/g)].map((m) => m[1]))].filter((file) =>
    !path.isAbsolute(file) && !file.split(/[\\/]/).includes('..') && fs.existsSync(path.join(root, file)) && fs.statSync(path.join(root, file)).isFile())
  const hits = files.length ? findHotspots(root, files, { ref }) : []
  const fileHits = hits.filter((hit) => !hit.unit && hit.reasons.some((reason) => !reason.startsWith('目录 ')))
  const advisory = hits.filter((hit) => !fileHits.includes(hit))
  if (advisory.length) warnings.push(`仅提示（目录 / 概念热点，不拦）：\n${advisory.map((hit) => `${hit.path}：${hit.reasons.join('；')}`).join('\n')}`)
  if (fileHits.length && !/docs\/engineering\/direction-checks\/[^\s`#)]+\.md(?:#[^\s`)]*)?/.test(text)) {
    problems.push(`${directionMessage(fileHits)}\n先派独立方向检查，并在任务书引用 docs/engineering/direction-checks/ 下的方向检查文档`)
  }
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
  const problems = checkDispatchBrief(text, { implementation: isImplementationBrief(text, file), warnings })
  for (const warning of warnings) console.warn(warning)
  if (!problems.length) { console.log('派工书检查：范围、不碰清单、停点、删不删、删除范围齐全，第 3 轮复盘引用与模型可见工具清单检查通过。'); return 0 }
  console.error(`派工书检查：${problems.length} 项缺失\n${problems.map((p) => `  · ${p}`).join('\n')}`)
  return 1
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main())
