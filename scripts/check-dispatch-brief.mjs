#!/usr/bin/env node
// 派工书检查（省 token 与方向检查在派工那一步的执行点）：协调会话发任务书前跑一遍。
//   node scripts/check-dispatch-brief.mjs <任务书.md>
// 查五件事：① 写了范围；② 写了不碰清单；③ 写了停点（做到哪就停）；④ 写了「补还是换」（P0 / RW 接到派工入口）；⑤ 若是修补第 3 轮及以上，必须引用方向检查复盘文档。
// 只看有没有写，不判写得好不好；退出码 1 = 缺项（派工前补齐）。纯文本匹配，不调模型。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const CHECKS = [
  { key: '范围', re: /范围|scope|只改|仅改/i, hint: '写清改哪些文件 / 概念（范围）' },
  { key: '不碰清单', re: /不碰|禁触|不许碰|禁止碰|do not touch/i, hint: '写不碰清单（哪些文件、目录、私有资料不许动）' },
  { key: '补还是换', re: /补还是换|补\s*[/、]\s*换\s*[/、]\s*删|接入\s*[/、]\s*补\s*[/、]\s*重写\s*[/、]\s*删/, hint: '写「补还是换」一节：近 14 天修过几次（node scripts/fix-churn.mjs <文件>）、是不是通用能力 / 有没有成熟方案、选补 / 换 / 删；纯调研 / 纯文档写「补还是换：不适用（原因）」' },
  { key: '停点', re: /停点|停下|就停|做到.{0,12}停|stop (at|when|after)/i, hint: '写停点（例如「样张出来就停」「卡住 3 次就停下报告」）' },
]
const ROUND = /第\s*([0-9]+|[一二三四五六七八九十]+)\s*轮|round\s*([0-9]+)/i
const CN = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 }
const REVIEW_REF = /Direction-Check|方向检查|类根因复盘|direction-check/i

export function roundNumber(text) {
  const m = ROUND.exec(text)
  if (!m) return 0
  const raw = m[1] || m[2]
  return /^\d+$/.test(raw) ? Number(raw) : (CN[raw] ?? (raw.length === 2 && raw[0] === '十' ? 10 + (CN[raw[1]] ?? 0) : 0))
}

/** 纯判断：返回缺项说明数组（空 = 通过）。 */
export function checkDispatchBrief(text) {
  const problems = []
  for (const c of CHECKS) if (!c.re.test(text)) problems.push(`缺${c.key}：${c.hint}`)
  const n = roundNumber(text)
  if (n >= 3 && !REVIEW_REF.test(text)) problems.push(`这是第 ${n} 轮修补：同一处第 3 轮就停，改派类根因复盘（docs/engineering/direction-check-template.md），任务书里要引用复盘文档`)
  return problems
}

function main() {
  const file = process.argv[2]
  if (!file || !fs.existsSync(file)) { console.error('用法：node scripts/check-dispatch-brief.mjs <任务书.md>'); return 2 }
  const problems = checkDispatchBrief(fs.readFileSync(file, 'utf8'))
  if (!problems.length) { console.log('派工书检查：范围、不碰清单、停点、补还是换都有。'); return 0 }
  console.error(`派工书检查：${problems.length} 项缺失\n${problems.map((p) => `  · ${p}`).join('\n')}`)
  return 1
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main())
