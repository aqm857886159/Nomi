// 「先查别人」门岗的判据本体（R27 / R29 的派工侧，2026-09-07）。
//
// 守的不变量：**任何实施动作之前，必须有一份可复核的「别人做过没有」报告，而且实施方案里指得到它。**
//
// 起因（这一族的类根因）：系统只奖励「做出来」，不惩罚「没查」。派工单的视角天然是
// 「把这件事做出来」，于是每个执行体都从零开始写，而依赖里 / 仓库里 / 生态里早已有一份。
// 2026-09-06 #546 的 pi SDK 评审是这个机制的一次显形（五项能力各写了一份更差的），
// 但它不是 pi 特有的——只要「查」这一步靠人记得，高负载下它就必漏。R29 把「框架已有的能力
// 不许再长一份」做成了门岗；本门岗补的是它的上游：**决定要不要写之前的那次检索本身**。
//
// 判据形状（刻意可机读、不判内容质量）：
//   ① 计划文档：docs/plan/<日期>-*.md 里必须有「## 先查别人」一节，且节内至少 3 条**带出处**
//      （URL 或 file:line）的条目。没有出处的条目 = 没查，只是写了句「查过了」。
//   ② PR：改动 src/ 或 electron/ 超过 300 行的 PR，正文必须引用一份带该节的计划文档。
//      300 行是「顺手小修」和「一次实施」的分界——小修不该被逼写调研，大改没查过不该合。
// 老文档按**日期阈值**豁免：阈值之前的计划不追溯（追溯只会让门岗一上线就是一片红，然后被无视）。
//
// 判据住在 lib 里是为了能被 node-test 喂假仓库：门岗自己的测试如果只能跑真实文档，
// 它就只测得到「今天的存量」，测不到「明天新增一份没查就写的方案会不会红」（R17）。

/** 「先查别人」节的标题。允许 ## / ### 两级，允许标题后跟补充文字。 */
const SECTION_HEADING = /^(#{2,3})\s*先查别人.*$/
/** 出处 = 一条 http(s) 链接，或一处 file:line（含冒号行号的仓库路径）。 */
const SOURCE_MARK = /https?:\/\/\S+|[\w@./+-]+\.[A-Za-z0-9]+:\d+/
const BULLET = /^\s*(?:[-*+]\s+|\d+[.)]\s+)/
const PLAN_DATE = /(?:^|\/)(\d{4}-\d{2}-\d{2})-/
const PLAN_REFERENCE = /docs\/plan\/[\w./+-]+\.md/g

/** 门岗上线日：这天（含）之后新建的计划文档才受本门岗管。 */
export const PRIOR_ART_THRESHOLD_DATE = '2026-09-07'
/** 一节里至少要有几条带出处的条目。模板四问（依赖 / 仓库 / 生态 / 自媒体）答满是 4，留 1 条余量。 */
export const PRIOR_ART_MIN_SOURCED_ENTRIES = 3
/** PR 改动预算：src/ + electron/ 的增删行数超过它，就必须引用一份带该节的方案。 */
export const PRIOR_ART_DIFF_BUDGET = 300
/** 报告模板的固定四问，写进报错文案，省得每个人再去翻文档。 */
export const PRIOR_ART_TEMPLATE_QUESTIONS = [
  '依赖里已有？（node_modules 的 d.ts / README，带 file:line）',
  '仓库里已有？（git grep 的结果，带 file:line）',
  '生态里已有？（同类开源项目 / 官方文档，带 URL）',
  'TikHub 自媒体里怎么说？（真实用户怎么解决这件事，带 URL）',
  '结论：用已有 / 自研 + 理由',
]

/** 从路径里取计划文档的日期前缀；没有日期前缀的一律当老文档（返回 null）。 */
export function planDate(file) {
  const match = PLAN_DATE.exec(String(file).replaceAll('\\', '/'))
  return match ? match[1] : null
}

/**
 * 抽出「先查别人」一节。返回 { found, entries, sourced }：
 * entries = 节内的条目行，sourced = 其中带出处的那些。
 * 节的边界 = 下一个同级或更高级标题（更深的 #### 属于节内，允许分小标题）。
 */
export function extractPriorArtSection(markdown) {
  const lines = String(markdown ?? '').split('\n')
  let level = 0
  let start = -1
  for (let index = 0; index < lines.length; index += 1) {
    const match = SECTION_HEADING.exec(lines[index])
    if (!match) continue
    level = match[1].length
    start = index + 1
    break
  }
  if (start === -1) return { found: false, entries: [], sourced: [] }

  const body = []
  for (let index = start; index < lines.length; index += 1) {
    const heading = /^(#{1,6})\s/.exec(lines[index])
    if (heading && heading[1].length <= level) break
    body.push(lines[index])
  }
  const entries = body.filter((line) => BULLET.test(line) || /^\s*\|[^|]/.test(line))
  const sourced = entries.filter((line) => SOURCE_MARK.test(line))
  return { found: true, entries, sourced }
}

/** 一份计划文档合不合格。返回错误数组（空 = 通过）。 */
export function evaluatePlan(file, markdown) {
  const section = extractPriorArtSection(markdown)
  if (!section.found) {
    return [`${file}: 缺少「## 先查别人」一节 —— 实施之前必须先有一份可复核的检索报告。`
      + `\n      模板四问：${PRIOR_ART_TEMPLATE_QUESTIONS.join(' / ')}`]
  }
  if (section.sourced.length < PRIOR_ART_MIN_SOURCED_ENTRIES) {
    return [`${file}: 「先查别人」节只有 ${section.sourced.length} 条带出处的条目`
      + `（要求 ≥ ${PRIOR_ART_MIN_SOURCED_ENTRIES}，共 ${section.entries.length} 条）`
      + ' —— 没有 URL 或 file:line 的条目等于只写了句「查过了」。']
  }
  return []
}

/**
 * 计划文档侧的门岗。`plans` = Map<仓库相对路径, 正文>。
 * 只管日期 >= threshold 的文档；没有日期前缀的老文档不追溯。
 */
export function evaluatePlans({ plans, threshold = PRIOR_ART_THRESHOLD_DATE }) {
  const errors = []
  for (const [file, markdown] of plans) {
    const date = planDate(file)
    if (!date || date < threshold) continue
    errors.push(...evaluatePlan(file, markdown))
  }
  return errors
}

/** PR 正文里引用到的计划文档路径（去重，保序）。 */
export function referencedPlans(body) {
  const found = new Set()
  for (const match of String(body ?? '').matchAll(PLAN_REFERENCE)) found.add(match[0])
  return [...found]
}

/**
 * PR 侧的门岗：改动 src/ 或 electron/ 超过预算时，正文必须引用一份**合格的**计划文档。
 * `plans` 同上；`changedLines` = src/ + electron/ 的增删行合计。
 */
export function evaluatePullRequest({ body, changedLines, plans, budget = PRIOR_ART_DIFF_BUDGET }) {
  if (!Number.isFinite(changedLines) || changedLines <= budget) return []
  const referenced = referencedPlans(body)
  if (referenced.length === 0) {
    return [`PR 改动 src/ 与 electron/ 共 ${changedLines} 行（预算 ${budget}），正文没有引用任何 docs/plan/*.md`
      + '\n      —— 这个量级的实施必须指得到一份带「## 先查别人」节的方案（R27 派工纪律）。']
  }
  const errors = []
  const passing = referenced.filter((file) => {
    const markdown = plans.get(file)
    if (markdown === undefined) {
      errors.push(`PR 正文引用的方案不存在于本分支：${file}`)
      return false
    }
    return evaluatePlan(file, markdown).length === 0
  })
  if (passing.length > 0) return []
  for (const file of referenced) {
    const markdown = plans.get(file)
    if (markdown === undefined) continue
    errors.push(...evaluatePlan(file, markdown).map((error) => `PR 引用的方案不合格 → ${error}`))
  }
  if (errors.length === 0) errors.push('PR 正文引用的方案都不合格（缺「## 先查别人」节或出处不足）')
  return errors
}
