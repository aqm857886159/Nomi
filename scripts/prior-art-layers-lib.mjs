// 「先查别人」门岗的分层判据（R5.2 做方案这一档，2026-09-17）。
//
// 守的不变量：**一份方案每一层都查过现成件，才算查过。**
//
// 起因（这一族的类根因，第二次显形）：`prior-art-lib.mjs` 的判据只数「几条带出处」，不看「覆盖了什么」。
//   · 2026-09-14 pi 生态调研已经指出一次：三条仓库内 file:line 也能过，没人去看依赖里有没有
//     （docs/roadmap/sources/2026-09-14-pi-ecosystem-gaps.md §4，只给了形状，没落地）；
//   · 2026-09-17 剪辑方案带 8 条出处过了门岗，查的却只有两端（整产品能不能搬 / 界面组件能不能用），
//     中间的时间轴标准模型（OpenTimelineIO）与剪辑引擎（MLT）一次都没查，方案写成「内核自己写」
//     还请用户拍板了顺序（docs/lessons/architecture-plan-must-check-every-layer-for-prior-art.md）。
// 数量判据对「漏掉整层」天然是瞎的——调研多≠调研全。所以这里判的是**覆盖面**：固定的层清单，每层一行。
//
// 为什么「默认都要」而不是「架构方案才要」：
//   「是不是架构方案」没有可靠的文本信号——2026-09-17 实扫 167 份受管方案，163 份提到至少一个层名词、
//   99 份提到 ≥4 个；「自己写/自研 + 层名词」也命中 37 份，多数是「不引入框架」这类不动项套话。
//   自报标记则正好是这次的失败模式（写的人自己没意识到这是架构取舍）。于是反过来：
//   **默认每份新方案都要分层表**，不涉及的方案写一行显式豁免（类别是封闭枚举），
//   豁免的真假由 PR 侧从代码 diff 反查（新增模块行数 / 新增运行时依赖，见 evaluateLayeredPullRequest）——
//   跳过需要写下一句可 grep 的具体声明，而且声明会被 diff 戳穿。
//
// 判据形状（只判结构，不判内容质量——内容质量归 R7 评审）：
//   表头 = 层 | 现成候选（标准/引擎/算法）| 许可 | 抄/改/自己写（允许后面再加列，如「理由」）
//   六个规范层每个至少一行；每行三选一：
//     ① 有候选：候选格带出处（URL / file:line / 仓库里真实存在的文件），许可格写明，结论 ∈ 抄/改/自己写；
//     ② 查过：无（…出处…）：括号里必须带出处（搜索链接也算），结论只能是「自己写」；
//     ③ 不涉及（理由）：理由非空，结论写「不涉及」。

/** 分层表判据的生效日：这天（含）之后的方案受管。2026-09-17 是触发这条规则的剪辑方案的日期。 */
export const LAYER_TABLE_THRESHOLD_DATE = '2026-09-17'

/**
 * 规范层清单。层格必须以其中一个名字开头（后面可跟括号补充，如「数据模型（时间轴）」）。
 * 刻意是通用的六层而不是剪辑专属：Agent 运行时、画布、生成链路都能落进这六格；
 * 2026-09-17 漏掉的恰好是前三层。
 */
export const REQUIRED_LAYERS = Object.freeze([
  { label: '数据模型', hint: '状态形状 / schema / 标准模型（如 OpenTimelineIO）' },
  { label: '操作与算法', hint: '编辑操作 / 撤销 / 调度 / 求解（如 OTIO editAlgorithm）' },
  { label: '引擎与运行时', hint: '渲染 / 执行 / 编解码（如 MLT、ffmpeg）' },
  { label: '格式与协议', hint: '存储格式 / 互操作标准 / 外部契约（R5.5）' },
  { label: '对外接口', hint: 'Agent 工具面 / MCP / API' },
  { label: '界面', hint: '组件库 / 交互' },
])

/** 豁免类别（封闭枚举）。没有「架构」「其他」——架构方案不许豁免，「其他」等于没有枚举。 */
export const LAYER_OPT_OUT_CATEGORIES = Object.freeze(['修复', '界面调整', '流程与文档', '门岗与测试'])

export const LAYER_DECISIONS = Object.freeze(['抄', '改', '自己写', '不涉及'])

/** PR 侧：新增文件（不含改名、不含测试）里的行数超过它 = 在长一块新模块。 */
export const LAYER_NEW_MODULE_BUDGET = 300

const OPT_OUT = /^\s*(?:[-*+]\s+|>\s*)?\**分层查\**\s*[：:]\s*不适用\s*[（(]\s*类别\s*[：:]\s*([^）)]+?)\s*[）)]\s*(.*)$/
const TABLE_ROW = /^\s*\|(.*)\|\s*$/
const SEPARATOR_CELL = /^\s*:?-{3,}:?\s*$/
const LICENSE_EMPTY = /^(?:|-+|—+|\?+|？+|未知|待查|不详|n\/?a)$/i
const NONE_CANDIDATE = /^查过\s*[：:]\s*无\s*[（(](.*)[）)]\s*$/
const NOT_APPLICABLE = /^不涉及\s*[（(](.*)[）)]\s*$/

const clean = (cell) => String(cell).replace(/[*`]/g, '').trim()
const splitRow = (line) => {
  const match = TABLE_ROW.exec(line)
  return match ? match[1].split('|').map(clean) : null
}

function isLayerHeader(cells) {
  return cells.length >= 4
    && cells[0] === '层'
    && cells[1].startsWith('现成候选')
    && cells[2] === '许可'
    && cells[3].includes('抄')
}

/**
 * 在「先查别人」节正文里找分层表与豁免声明。
 * `hasSource(text)` 由调用方给（复用主判据的三种出处），本模块不碰磁盘。
 */
export function extractLayerTable(sectionLines) {
  const lines = sectionLines ?? []
  let optOut = null
  for (const line of lines) {
    const match = OPT_OUT.exec(line)
    if (match) {
      optOut = { category: match[1].trim(), reason: match[2].replace(/^[—–\-:：\s]+/, '').trim() }
      break
    }
  }
  for (let index = 0; index < lines.length; index += 1) {
    const header = splitRow(lines[index])
    if (!header || !isLayerHeader(header)) continue
    const separator = splitRow(lines[index + 1] ?? '')
    if (!separator || !separator.every((cell) => SEPARATOR_CELL.test(cell))) continue
    const rows = []
    for (let rowIndex = index + 2; rowIndex < lines.length; rowIndex += 1) {
      const cells = splitRow(lines[rowIndex])
      if (!cells) break
      rows.push({ line: lines[rowIndex], cells })
    }
    return { found: true, rows, optOut }
  }
  return { found: false, rows: [], optOut }
}

function layerOf(cell) {
  return REQUIRED_LAYERS.find((layer) => cell.startsWith(layer.label))?.label ?? null
}

/** 单行合不合格。返回错误文案（null = 合格）。 */
function evaluateRow({ cells, line }, hasSource) {
  const [layerCell, candidate, license, decisionCell] = cells
  const label = layerCell || '（空层名）'
  // 结论格 = 枚举值，后面可跟括号补充（如「改（一选项一行 → 一层一行）」）
  const decision = LAYER_DECISIONS.find((value) => new RegExp(`^${value}(?:\\s*[（(].*[)）])?$`).test(decisionCell ?? ''))
  if (!decision) return `「${label}」行的结论写「${decisionCell}」—— 只能是 ${LAYER_DECISIONS.join(' / ')}`

  const notApplicable = NOT_APPLICABLE.exec(candidate)
  if (decision === '不涉及' || notApplicable) {
    if (!(decision === '不涉及' && notApplicable)) return `「${label}」行：候选写「不涉及（理由）」时结论必须是「不涉及」，反之亦然`
    if (!notApplicable[1].trim()) return `「${label}」行写了「不涉及」却没写理由`
    return null
  }

  const none = NONE_CANDIDATE.exec(candidate)
  if (none) {
    if (decision !== '自己写') return `「${label}」行：查过无现成件，结论只能是「自己写」（写的是「${decision}」）`
    if (!hasSource(none[1])) return `「${label}」行「查过：无」的括号里没有出处 —— 写上查了哪里（搜索链接 / 仓库路径）`
    return null
  }
  if (/^查过/.test(candidate)) return `「${label}」行：无现成件要写成「查过：无（查了哪里 + 链接）」`

  if (!candidate || !hasSource(candidate)) return `「${label}」行的现成候选没有出处（URL / file:line / 仓库里真实存在的文件）：${line.trim()}`
  if (LICENSE_EMPTY.test(license ?? '')) return `「${label}」行的许可没写 —— 抄/改之前得知道能不能抄`
  return null
}

/**
 * 分层判据本体。返回 { errors, optedOut }。
 * `sectionLines` = 「先查别人」节的正文行；`hasSource(text)` = 主判据的出处判定。
 */
export function evaluateLayerTable(file, sectionLines, hasSource) {
  const table = extractLayerTable(sectionLines)
  const layerList = REQUIRED_LAYERS.map((layer) => layer.label).join(' / ')
  if (!table.found) {
    if (table.optOut) {
      if (!LAYER_OPT_OUT_CATEGORIES.includes(table.optOut.category)) {
        return { errors: [`${file}: 分层查豁免的类别「${table.optOut.category}」不在枚举里（只许 ${LAYER_OPT_OUT_CATEGORIES.join(' / ')}）—— 架构取舍不许豁免`], optedOut: false }
      }
      if (!table.optOut.reason) return { errors: [`${file}: 分层查豁免没写理由（「分层查：不适用（类别：X）—— 理由」）`], optedOut: false }
      return { errors: [], optedOut: true }
    }
    return {
      errors: [`${file}: 「先查别人」节缺分层表 —— 调研多≠调研全，每一层都要查现成件。`
        + '\n      表头：| 层 | 现成候选（标准/引擎/算法）| 许可 | 抄/改/自己写 |'
        + `\n      必备层：${layerList}；每行 = 带出处的候选 / 「查过：无（查了哪里+链接）」/ 「不涉及（理由）」`
        + `\n      不涉及任何层取舍的方案写一行：分层查：不适用（类别：${LAYER_OPT_OUT_CATEGORIES.join('|')}）—— 理由`],
      optedOut: false,
    }
  }
  if (table.optOut) return { errors: [`${file}: 同时写了分层表和「分层查：不适用」—— 二选一`], optedOut: false }

  const errors = []
  const covered = new Set()
  for (const row of table.rows) {
    const label = layerOf(row.cells[0] ?? '')
    if (label) covered.add(label)
    const error = evaluateRow(row, hasSource)
    if (error) errors.push(`${file}: ${error}`)
  }
  const missing = REQUIRED_LAYERS.filter((layer) => !covered.has(layer.label))
  if (missing.length > 0) {
    errors.push(`${file}: 分层表缺层：${missing.map((layer) => `${layer.label}（${layer.hint}）`).join('；')}`
      + ' —— 不涉及的层也要写一行「不涉及（理由）」')
  }
  return { errors, optedOut: false }
}

/**
 * PR 侧反查：diff 自己说明「这是在长新层」时，引用的方案必须带分层表（豁免不算）。
 * 信号从代码来，不从方案自报来：新增文件行数（不含改名与测试）超预算，或新增运行时依赖。
 * `planStatus(file)` → 'layered' | 'opted-out' | 'missing' | 'invalid'。
 */
export function evaluateLayeredPullRequest({ newModuleLines, addedDependencies, referenced, planStatus, budget = LAYER_NEW_MODULE_BUDGET }) {
  const reasons = []
  if (Number.isFinite(newModuleLines) && newModuleLines > budget) reasons.push(`新增文件 ${newModuleLines} 行（预算 ${budget}）`)
  if (addedDependencies?.length > 0) reasons.push(`新增运行时依赖 ${addedDependencies.join(', ')}`)
  if (reasons.length === 0) return []
  if (referenced.some((file) => planStatus(file) === 'layered')) return []
  const cited = referenced.length === 0
    ? '正文没有引用任何 docs/plan/*.md'
    : `引用的方案都没有合格的分层表（${referenced.map((file) => `${file}=${planStatus(file)}`).join('，')}）`
  return [`PR ${reasons.join('、')} —— 这是在长新的一层，${cited}。`
    + '\n      豁免（分层查：不适用）在这里不算：代码已经说明它碰了层取舍。给方案补一张分层表（老方案也可以补）。']
}

/** 从 base 与 head 的 package.json 文本算新增的运行时依赖（只看 dependencies）。 */
export function addedRuntimeDependencies(baseJson, headJson) {
  const parse = (text) => {
    try {
      return Object.keys(JSON.parse(text)?.dependencies ?? {})
    } catch {
      return null
    }
  }
  const before = parse(baseJson)
  const after = parse(headJson)
  if (!after) return []
  const known = new Set(before ?? [])
  return after.filter((name) => !known.has(name)).sort()
}

/** 新增文件是不是测试（测试不算「长新模块」）。 */
export function isTestPath(file) {
  return /(?:^|\/)(?:__tests__|tests?)\//.test(file) || /\.(?:test|spec|node-test)\.[cm]?[jt]sx?$/.test(file)
}
