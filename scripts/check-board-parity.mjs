#!/usr/bin/env node
// 设计图对账门岗（check:board-parity）。规则来源：docs/engineering/design-pipeline.md。
//
// 守的事：拍板图里每个看得见的东西，要么有去处（实现了 / 在做 / 缺且有人认领 / 用户点头推迟或放弃），
// 要么是纯装饰。拍板图只是一张画时，「图上有、产品没做」没有任何东西会红；清单把它变成会红的东西。
//
// 规则（每条一个反例测试，见 check-board-parity.node-test.mjs）：
//  R1 每个候选恰好被一个元素引用或列进 decor（板改了出新候选 → 红；重抽的候选与仓库里的 candidates.json 不一致也红）
//  R2 status 只能是 implemented / in-progress / missing / deferred / dropped；元素 id 不重复；引用的候选必须存在
//  R3 missing / in-progress 必须有 owner（PR 号或交接任务名）
//  R4 implemented 必须有 assertion，且该字符串必须出现在 tests/ux 某个走查文件里（没有就不许写空断言）
//  R5 deferred / dropped 必须有 userDecision {quote, date}（用户原话 + 日期）
//  R6 functionCensus 每项的 after 必须是存在的元素 id（旧功能必须有去处）
//  R7 states 非空，取值只能来自状态词表
//  R9 priorArt（2026-10-19 起）：日期目录 ≥ 2026-10-19 的板必须有 ≥3 项 {url, takeaway, decisionImpact}（先查别人：它怎么做 + 对哪个设计决定的影响）；
//     更早的板不查。日期取板所在的日期目录名（取不到就取清单的 approvedOn）
//  R10 boundarySheet（2026-11-13 起）：日期目录 ≥ 2026-11-13 的板必须有边界表（数组 ≥1 行，每行 where / max / source / layout / board / element 非空，
//     board 是同目录存在的板名，element 是本清单存在的元素 id；或 { none: 原因 }）；更早的板不查，写了就照样查
//  R11–R15（2026-11-15 起，设计流程 2026-11-14 用户拍板的几句的执行；日期目录 ≥ 2026-11-15 的板才查，更早的板写了也不查）：
//  R11 同类产品先例：priorArt 第一项是 { kind: 'same-surface', product, screenshotSha256, seenOn, differences:[{what, why}] }，
//      或同类产品没有这东西时 { kind: 'same-surface', product, absent: 查了哪里 }；截图不进仓库，只记指纹和日期
//  R12 出现在哪几处：components（生产组件文件）+ appearsIn（每处一行 {place, files, board, element}）+ appearsInExcluded（{file, reason}）；
//      脚本列出直接引用这些组件文件的非测试文件（只取类型的不算；桶文件换成从桶里取了组件的文件；更远的不追），
//      每个都要在 appearsIn.files 或 appearsInExcluded 里；或 appearsIn: { none: 原因 }
//  R13 旧功能普查加列：functionCensus 每项 placement = direct / menu / dropped；menu 要 frequency（可写「不知道」）和 peerPlacement；
//      direct / menu 要 ifRemoved（删掉它创作者会做错什么）
//  R14 以前定过什么：priorDecisions 数组 ≥1 行 {what, source, stillValid}，或 { notFound: 查了哪里 }
//  R15 边界表覆盖：states 里有 max-count / long-text 的元素，必须被 boundarySheet 某一行的 element 指到；写 { none } 却有这样的元素 = 红
//  R8 PR 正文 `## 拍板图` 认领的元素：在 PR 头上必须是 implemented，或带 userDecision 的 deferred / dropped
//     （认领可以指向任何日期目录里的板；发现到的每张新日期板都跑完整规则：抽取候选核哈希、人工普查须声明）
//
// 用法：node scripts/check-board-parity.mjs            （重抽候选 + 全部规则）
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

// 默认模式只用常量和哈希：不 import 抽取（抽取要浏览器），抽取在 --reextract 里动态加载。
import { BOARD_NAMES, BOARDS_DIR, REPO_ROOT } from './board-extract.mjs'
import { hashBoardSource } from './board-source-hash.mjs'

export const BOARD_STATUSES = Object.freeze(['implemented', 'in-progress', 'missing', 'deferred', 'dropped'])
export const BOARD_STATES = Object.freeze(['empty', 'loading', 'error', 'selected', 'disabled', 'hover', 'narrow', 'long-text', 'zh-en', 'dark', 'max-count'])
export const BOARD_STAGES = Object.freeze(['explored', 'built'])
export const PR_SECTION = '拍板图'
/** 元素 id：字母 / 数字 / 下划线 / 点 / 冒号 / 连字符（清单里的写法，如 node.card）。 */
const ELEMENT_ID = /^[\p{L}\p{N}_.:-]+$/u
const BOARD_NAME_PART = '[A-Za-z][A-Za-z0-9]*'
/** 板名：字母开头、后面字母或数字（`IconsF1`、`Director3dbox`）。认领行和磁盘上的板文件名（`<板名>.board.json`）共用这一份。 */
export const BOARD_NAME = new RegExp(`^${BOARD_NAME_PART}$`)
const CLAIM_LINE = new RegExp(`^\\s*[-*]\\s*(${BOARD_NAME_PART})\\s*[:：]\\s*(.+)$`)

/** 从这天（含）起，板清单必须带 priorArt。更早的板不追溯。 */
export const PRIOR_ART_REQUIRED_FROM = '2026-10-19'
export const PRIOR_ART_MIN_ITEMS = 3
/** 从这天（含）起，板清单必须带 boundarySheet（边界表）。更早的板不追溯，但写了就照样查。 */
export const BOUNDARY_SHEET_REQUIRED_FROM = '2026-11-13'
export const BOUNDARY_SHEET_FIELDS = Object.freeze(['where', 'max', 'source', 'layout', 'board', 'element'])

/**
 * 从这天（含）起，板清单要带 2026-11-14 用户拍板的设计流程输入（R11–R15）。更早的板不追溯：写了也不查，
 * 因为这些栏是出图依据，旧板没有出图记录可补。
 */
export const DESIGN_INPUTS_REQUIRED_FROM = '2026-11-15'
export const CENSUS_PLACEMENTS = Object.freeze(['direct', 'menu', 'dropped'])
/** 出图依据栏：不是实现合同。compareBoardManifests 判「base/head 清单有没有合同差异」时不看它们。 */
export const DESIGN_INPUT_FIELDS = Object.freeze(['components', 'appearsIn', 'appearsInExcluded', 'priorDecisions'])
export const CENSUS_INPUT_FIELDS = Object.freeze(['placement', 'frequency', 'peerPlacement', 'ifRemoved'])
/** 这两种状态的元素会被数据撑开，必须被边界表指到（R15）。 */
const BOUNDARY_STATES = Object.freeze(['max-count', 'long-text'])

const isNonEmptyString = (value) => typeof value === 'string' && value.trim().length > 0
/** 板的日期：目录名开头的 YYYY-MM-DD（带后缀也认），取不到就取清单的 approvedOn。 */
const boardDay = (date, manifest) => /^(\d{4}-\d{2}-\d{2})(?:$|-)/.exec(String(date ?? ''))?.[1] ?? (/^\d{4}-\d{2}-\d{2}$/.test(String(manifest?.approvedOn ?? '')) ? manifest.approvedOn : null)
const designInputsRequired = (date, manifest) => {
  const day = boardDay(date, manifest)
  return Boolean(day) && day >= DESIGN_INPUTS_REQUIRED_FROM
}

/**
 * 对账 PR base/head 的界面清单。清单取不到或两边都没有清单时返回 unknown：
 * 没有证据不能把“没看到变化”当成“确定没变化”。判据层只消费这个结果，
 * 不在另一处复制 board manifest 的比较口径。
 */
export function compareBoardManifests(base, head) {
  if (!base || !head || typeof base !== 'object' || typeof head !== 'object') {
    return { known: false, changed: null, reason: '取不到 base/head 拍板图清单' }
  }
  const baseNames = Object.keys(base).filter((name) => base[name] && !base[name].ambiguous)
  const headNames = Object.keys(head).filter((name) => head[name] && !head[name].ambiguous)
  if (!baseNames.length || !headNames.length) {
    return { known: false, changed: null, reason: 'base/head 没有可对账的拍板图清单' }
  }
  // 出图依据栏（R12–R14 新加的 components / appearsIn / priorDecisions，普查新加的四列）不是实现合同：补它们不算界面差异。
  const contractOnly = (manifest) => {
    if (!manifest || typeof manifest !== 'object') return manifest
    const out = Object.fromEntries(Object.entries(manifest).filter(([key]) => !DESIGN_INPUT_FIELDS.includes(key)))
    if (Array.isArray(out.functionCensus)) {
      out.functionCensus = out.functionCensus.map((item) => (item && typeof item === 'object' ? Object.fromEntries(Object.entries(item).filter(([key]) => !CENSUS_INPUT_FIELDS.includes(key))) : item))
    }
    return out
  }
  const normalize = (manifests) => Object.fromEntries(Object.keys(manifests).sort().map((name) => [name, contractOnly(manifests[name])]))
  const changed = JSON.stringify(normalize(base)) !== JSON.stringify(normalize(head))
  return { known: true, changed, reason: changed ? 'base/head 拍板图清单有差异' : 'base/head 拍板图清单无差异' }
}

/**
 * R9：先查别人。日期 ≥ PRIOR_ART_REQUIRED_FROM 的板必须有 ≥3 项 {url, takeaway, decisionImpact}。纯函数、可测。
 */
export function checkPriorArt({ board, manifest, date }) {
  const day = /^\d{4}-\d{2}-\d{2}$/.test(String(date ?? '')) ? date : manifest?.approvedOn
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(day ?? '')) || day < PRIOR_ART_REQUIRED_FROM) return []
  const tag = (msg) => `[${board}] ${msg}`
  const items = manifest?.priorArt
  if (!Array.isArray(items)) return [tag(`${day} 起的板必须有 priorArt 数组（≥${PRIOR_ART_MIN_ITEMS} 项 {url, takeaway, decisionImpact}：别人怎么做 + 对哪个设计决定的影响）`)]
  const errors = []
  if (items.length < PRIOR_ART_MIN_ITEMS) errors.push(tag(`priorArt 至少 ${PRIOR_ART_MIN_ITEMS} 项，现在 ${items.length} 项`))
  // 2026-11-15 起第一项是「同类产品同一处」，由 R11（checkSameSurfacePriorArt）按它自己的字段查；url 写了照样查格式。
  const firstIsSameSurface = designInputsRequired(date, manifest)
  items.forEach((item, index) => {
    if (firstIsSameSurface && index === 0) {
      if (isNonEmptyString(item?.url) && !/^https?:\/\/\S+$/.test(item.url.trim())) errors.push(tag(`priorArt[0].url 不是 http(s) 链接：${item.url}`))
      return
    }
    for (const field of ['url', 'takeaway', 'decisionImpact']) {
      if (!isNonEmptyString(item?.[field])) errors.push(tag(`priorArt[${index}] 缺 ${field}`))
    }
    if (isNonEmptyString(item?.url) && !/^https?:\/\/\S+$/.test(item.url.trim())) errors.push(tag(`priorArt[${index}].url 不是 http(s) 链接：${item.url}`))
  })
  return errors
}

/**
 * R10：边界表。日期 ≥ BOUNDARY_SHEET_REQUIRED_FROM 的板必须有 boundarySheet；更早的板不查，但写了就照样查。纯函数、可测。
 * boardNames = 同目录里存在的板名。
 */
export function checkBoundarySheet({ board, manifest, date, boardNames }) {
  // 目录名带后缀（`2026-11-13-mode-bar`）也认：取开头的日期。取不到就取清单的 approvedOn。
  const dirDay = /^(\d{4}-\d{2}-\d{2})(?:$|-)/.exec(String(date ?? ''))?.[1]
  const day = dirDay ?? manifest?.approvedOn
  const sheet = manifest?.boundarySheet
  const required = /^\d{4}-\d{2}-\d{2}$/.test(String(day ?? '')) && day >= BOUNDARY_SHEET_REQUIRED_FROM
  const tag = (msg) => `[${board}] ${msg}`
  if (sheet === undefined || sheet === null) {
    return required ? [tag(`${day} 起的板必须有 boundarySheet（会被数据撑开的地方：数组，每行 ${BOUNDARY_SHEET_FIELDS.join(' / ')}；确实没有就写 { "none": "原因" }）`)] : []
  }
  if (!Array.isArray(sheet)) {
    return isNonEmptyString(sheet?.none) ? [] : [tag('boundarySheet 不是数组时必须是 { none: 原因 }，原因不能为空')]
  }
  if (sheet.length === 0) return [tag('boundarySheet 数组至少 1 行（确实没有会被数据撑开的地方就写 { "none": "原因" }）')]
  const errors = []
  const elementIds = new Set((Array.isArray(manifest?.elements) ? manifest.elements : []).map((el) => el?.id))
  sheet.forEach((row, index) => {
    for (const field of BOUNDARY_SHEET_FIELDS) {
      if (!isNonEmptyString(row?.[field])) errors.push(tag(`boundarySheet[${index}] 缺 ${field}`))
    }
    if (isNonEmptyString(row?.board) && !(boardNames ?? []).includes(row.board)) errors.push(tag(`boundarySheet[${index}].board「${row.board}」不是同目录里的板名`))
    if (isNonEmptyString(row?.element) && !elementIds.has(row.element)) errors.push(tag(`boundarySheet[${index}].element「${row.element}」不是本清单的元素 id`))
  })
  return errors
}

/** 某个目录里存在的板名（`<板名>.board.json`）。边界表的 board 字段只能指向这里。 */
export function boardNamesIn(dir) {
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir).filter((name) => name.endsWith('.board.json')).map((name) => name.slice(0, -'.board.json'.length))
}

const SHA256_HEX = /^[0-9a-f]{64}$/i
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/

/**
 * R11：先例第一项是最接近的成熟同类产品同一处（2026-11-14 用户拍板第 1 句）。日期 ≥ 2026-11-15 的板才查。纯函数、可测。
 * 截图不进仓库：只记 screenshotSha256（截图文件的 sha256）和 seenOn（看的日期）；它没有这个东西时写 absent（查了哪里）。
 */
export function checkSameSurfacePriorArt({ board, manifest, date }) {
  if (!designInputsRequired(date, manifest)) return []
  const tag = (msg) => `[${board}] ${msg}`
  const first = Array.isArray(manifest?.priorArt) ? manifest.priorArt[0] : undefined
  const shape = '{ "kind": "same-surface", "product": "产品名", "screenshotSha256": "截图文件的 sha256", "seenOn": "看的日期", "differences": [{ "what": "哪里不一样", "why": "为什么" }] }'
  if (!first || first.kind !== 'same-surface') {
    return [tag(`priorArt 第一项必须是最接近的成熟同类产品同一处：写成 ${shape}；同类产品没有这个东西时写 { "kind": "same-surface", "product": "产品名", "absent": "查了哪里" }`)]
  }
  const errors = []
  if (!isNonEmptyString(first.product)) errors.push(tag('priorArt[0] 缺 product（是哪个同类产品）'))
  if (first.absent !== undefined) {
    if (!isNonEmptyString(first.absent)) errors.push(tag('priorArt[0].absent 要写查了哪里（同类产品没有这个东西时），不能为空'))
    return errors
  }
  if (!SHA256_HEX.test(String(first.screenshotSha256 ?? ''))) errors.push(tag('priorArt[0] 缺 screenshotSha256：同类产品同一处真截图的 sha256（64 位十六进制；`shasum -a 256 截图.png`），截图本身不进仓库'))
  if (!ISO_DAY.test(String(first.seenOn ?? ''))) errors.push(tag('priorArt[0] 缺 seenOn：看这张截图的日期（YYYY-MM-DD）'))
  const diffs = first.differences
  if (!Array.isArray(diffs) || diffs.length === 0) errors.push(tag('priorArt[0] 缺 differences：和它不一样的地方逐条写 { what: 哪里不一样, why: 为什么 }；完全照它做也写一条说明'))
  else diffs.forEach((diff, index) => {
    for (const field of ['what', 'why']) if (!isNonEmptyString(diff?.[field])) errors.push(tag(`priorArt[0].differences[${index}] 缺 ${field}`))
  })
  return errors
}

/**
 * R12：出现在哪几处（2026-11-14 用户拍板第 3 句）。日期 ≥ 2026-11-15 的板才查。纯函数、可测。
 * referrersOf(file) → 直接引用这个组件文件的非测试文件列表（仓库相对路径）；文件不存在返回 null。
 * 只看直接引用，不追多层（桶文件 index.ts 本身就是一个引用方，要么算一处、要么写理由）。
 */
export function checkAppearsIn({ board, manifest, date, boardNames, referrersOf }) {
  if (!designInputsRequired(date, manifest)) return []
  const tag = (msg) => `[${board}] ${msg}`
  const errors = []
  const rows = manifest?.appearsIn
  const excluded = manifest?.appearsInExcluded ?? []
  const components = manifest?.components
  const elementIds = new Set((Array.isArray(manifest?.elements) ? manifest.elements : []).map((el) => el?.id))
  const rowShape = '{ "place": "产品里的面或设计实验室的屏", "files": ["引用组件的文件"], "board": "对应哪张板", "element": "对应哪个元素" }'
  const none = rows && !Array.isArray(rows) && typeof rows === 'object'
  if (rows === undefined || rows === null) {
    errors.push(tag(`缺 appearsIn：同一个东西出现在几处，每处一行 ${rowShape}；确实只是一处、不复用任何生产组件时写 { "none": "原因" }`))
  } else if (none) {
    if (!isNonEmptyString(rows.none)) errors.push(tag('appearsIn 不是数组时必须是 { none: 原因 }，原因不能为空'))
  } else if (rows.length === 0) {
    errors.push(tag('appearsIn 数组至少 1 行（只有一处也写那一处）'))
  } else {
    rows.forEach((row, index) => {
      for (const field of ['place', 'board', 'element']) if (!isNonEmptyString(row?.[field])) errors.push(tag(`appearsIn[${index}] 缺 ${field}`))
      if (!Array.isArray(row?.files) || !row.files.some(isNonEmptyString)) errors.push(tag(`appearsIn[${index}] 缺 files（这一处是哪个文件引用了组件）`))
      if (isNonEmptyString(row?.board) && !(boardNames ?? []).includes(row.board)) errors.push(tag(`appearsIn[${index}].board「${row.board}」不是同目录里的板名（每处各出一张图）`))
      if (isNonEmptyString(row?.element) && !elementIds.has(row.element)) errors.push(tag(`appearsIn[${index}].element「${row.element}」不是本清单的元素 id`))
    })
  }
  if (!Array.isArray(excluded)) errors.push(tag('appearsInExcluded 必须是数组 [{ file, reason }]'))
  else excluded.forEach((item, index) => {
    if (!isNonEmptyString(item?.file)) errors.push(tag(`appearsInExcluded[${index}] 缺 file`))
    if (!isNonEmptyString(item?.reason)) errors.push(tag(`appearsInExcluded[${index}] 缺 reason（为什么这个引用方不算一处）`))
  })
  if (components === undefined && none) return errors
  if (!Array.isArray(components) || !components.some(isNonEmptyString)) {
    errors.push(tag('缺 components：这块用到的生产组件文件（仓库相对路径，如 src/design/NomiSelect.tsx），门岗按它列出引用方'))
    return errors
  }
  const covered = new Set([
    ...(Array.isArray(rows) ? rows.flatMap((row) => (Array.isArray(row?.files) ? row.files : [])) : []),
    ...(Array.isArray(excluded) ? excluded.map((item) => item?.file) : []),
  ].filter(isNonEmptyString).map((file) => file.trim()))
  const declared = new Set(components.filter(isNonEmptyString).map((file) => file.trim()))
  for (const component of declared) {
    const referrers = referrersOf ? referrersOf(component) : null
    if (referrers === null) {
      errors.push(tag(`components 里的 ${component} 在仓库里找不到（写仓库相对路径；还没写的新组件不要列）`))
      continue
    }
    for (const file of referrers) {
      // 组件之间互相引用（如底栏引用模型下拉）不是一处：两个都在 components 里，各自的引用方已经在列
      if (!covered.has(file) && !declared.has(file)) errors.push(tag(`${file} 直接引用了 ${component}，却不在 appearsIn 里：它是一处就加一行（每处各出一张图），不算就写进 appearsInExcluded 并写理由`))
    }
  }
  return errors
}

/**
 * R13：旧功能普查加列（2026-11-14 用户拍板第 4、5 句）。日期 ≥ 2026-11-15 的板才查。纯函数、可测。
 */
export function checkCensusPlacement({ board, manifest, date }) {
  if (!designInputsRequired(date, manifest)) return []
  const tag = (msg) => `[${board}] ${msg}`
  const errors = []
  for (const item of Array.isArray(manifest?.functionCensus) ? manifest.functionCensus : []) {
    const name = `旧功能「${item?.function ?? '?'}」`
    if (!CENSUS_PLACEMENTS.includes(item?.placement)) {
      errors.push(tag(`${name}缺 placement：去处属于哪种，只能是 direct（直接摆）/ menu（收进菜单或二级入口）/ dropped（删掉）`))
      continue
    }
    if (item.placement === 'menu') {
      if (!isNonEmptyString(item.frequency)) errors.push(tag(`${name}收进菜单，缺 frequency：创作者多久用一次（有数据写数据，没有写「不知道」）`))
      if (!isNonEmptyString(item.peerPlacement)) errors.push(tag(`${name}收进菜单，缺 peerPlacement：最接近的成熟同类产品把它放在哪`))
    }
    if (item.placement !== 'dropped' && !isNonEmptyString(item.ifRemoved)) errors.push(tag(`${name}留下来了，缺 ifRemoved：删掉它创作者会做错什么（说不出来就该删）`))
  }
  return errors
}

/**
 * R14：以前定过什么。日期 ≥ 2026-11-15 的板才查。纯函数、可测。
 */
export function checkPriorDecisions({ board, manifest, date }) {
  if (!designInputsRequired(date, manifest)) return []
  const tag = (msg) => `[${board}] ${msg}`
  const value = manifest?.priorDecisions
  const shape = '[{ "what": "定过什么", "source": "出处（用户原话日期 / PR / 文档）", "stillValid": "现在还算不算数" }]'
  if (value === undefined || value === null) return [tag(`缺 priorDecisions：以前定过什么，写成 ${shape}；没查到写 { "notFound": "查了哪里" }`)]
  if (!Array.isArray(value)) return isNonEmptyString(value?.notFound) ? [] : [tag('priorDecisions 不是数组时必须是 { notFound: 查了哪里 }，不能为空')]
  if (value.length === 0) return [tag('priorDecisions 数组至少 1 行（没查到就写 { "notFound": "查了哪里" }）')]
  const errors = []
  value.forEach((row, index) => {
    for (const field of ['what', 'source', 'stillValid']) if (!isNonEmptyString(row?.[field])) errors.push(tag(`priorDecisions[${index}] 缺 ${field}`))
  })
  return errors
}

/**
 * R15：边界表覆盖（边界原则第 7 条的执行）。日期 ≥ 2026-11-15 的板才查。纯函数、可测。
 */
export function checkBoundaryCoverage({ board, manifest, date }) {
  if (!designInputsRequired(date, manifest)) return []
  const tag = (msg) => `[${board}] ${msg}`
  const sheet = manifest?.boundarySheet
  const pointed = new Set(Array.isArray(sheet) ? sheet.map((row) => row?.element).filter(isNonEmptyString) : [])
  const errors = []
  for (const el of Array.isArray(manifest?.elements) ? manifest.elements : []) {
    const hit = (Array.isArray(el?.states) ? el.states : []).filter((state) => BOUNDARY_STATES.includes(state))
    if (!hit.length || pointed.has(el.id)) continue
    const why = Array.isArray(sheet) ? '没有一行的 element 指到它' : '边界表写了 { none }'
    errors.push(tag(`元素 ${el.id} 的状态有 ${hit.join(' / ')}，会被数据撑开，但${why}：在 boundarySheet 加一行写它的最大值和怎么排`))
  }
  return errors
}

/**
 * 直接引用某个文件的非测试源文件（src/ 和 electron/ 下，设计实验室的屏算）。只看直接引用，不追多层。
 * 唯一的例外是桶文件：只把组件原样转出去（re-export，如 src/design/index.ts）的不算一处，
 * 改成列出「从桶里取了 X 的文件」——它们才是真的直接用到组件的地方。桶套桶不追。
 * 解析用 TypeScript 自带的 AST（import / export from / import()），相对路径按 TS 的扩展名规则解析；仓库没有路径别名。
 */
export function makeReferrerScanner(root = REPO_ROOT, roots = ['src', 'electron']) {
  // 同步 require、只在有 2026-11-15 起的板声明了 components 时才加载：别的板和默认路径不为它付启动时间。
  const ts = createRequire(import.meta.url)('typescript')
  const SOURCE = /\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/
  const TEST = /\.(?:test|spec|e2e)\.[^.]+$|\.node-test\.[cm]?js$|(?:^|\/)__tests__\//
  const files = []
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (SOURCE.test(entry.name)) files.push(full)
    }
  }
  for (const sub of roots) walk(path.join(root, sub))
  const toRel = (abs) => path.relative(root, abs).split(path.sep).join('/')
  const resolve = (from, spec) => {
    if (!spec.startsWith('.')) return null
    const base = path.resolve(path.dirname(from), spec)
    const candidates = [base, ...['.ts', '.tsx', '.mts', '.js', '.jsx', '.mjs', '.cjs'].map((ext) => base + ext), ...['index.ts', 'index.tsx', 'index.js', 'index.mjs'].map((name) => path.join(base, name)), base.replace(/\.(?:m?js|jsx)$/, '.ts'), base.replace(/\.(?:m?js|jsx)$/, '.tsx')]
    const hit = candidates.find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile())
    return hit ? toRel(hit) : null
  }
  // uses：target → Map(引用方 → 取的名字集合；'*' = 整个模块 / 默认导入 / 动态导入)；reexports：target → Map(桶 → 转出的名字)
  const uses = new Map()
  const reexports = new Map()
  const add = (map, target, from, names) => {
    if (!map.has(target)) map.set(target, new Map())
    const entry = map.get(target)
    const prev = entry.get(from)
    entry.set(from, prev === '*' || names === '*' ? '*' : new Set([...(prev ?? []), ...names]))
  }
  for (const file of files) {
    const rel = toRel(file)
    if (TEST.test(rel)) continue
    const text = fs.readFileSync(file, 'utf8')
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, false)
    const seen = new Set()
    for (const statement of source.statements) {
      const spec = statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier) ? statement.moduleSpecifier.text : null
      if (!spec) continue
      const target = resolve(file, spec)
      if (!target) continue
      seen.add(spec)
      if (ts.isImportDeclaration(statement)) {
        // 只取类型的引用画不出组件，不算一处
        const clause = statement.importClause
        if (clause?.isTypeOnly) continue
        const bindings = clause?.namedBindings
        if (!clause || clause.name || (bindings && ts.isNamespaceImport(bindings))) add(uses, target, rel, '*')
        else {
          const names = (bindings?.elements ?? []).filter((el) => !el.isTypeOnly).map((el) => (el.propertyName ?? el.name).text)
          if (names.length) add(uses, target, rel, names)
        }
      } else if (ts.isExportDeclaration(statement)) {
        if (statement.isTypeOnly) continue
        const clause = statement.exportClause
        add(reexports, target, rel, clause && ts.isNamedExports(clause) ? clause.elements.filter((el) => !el.isTypeOnly).map((el) => el.name.text) : '*')
      }
    }
    // 动态 import() / require()：整模块算用到
    for (const { fileName: spec } of ts.preProcessFile(text, true, true).importedFiles) {
      if (seen.has(spec)) continue
      const target = resolve(file, spec)
      if (target) add(uses, target, rel, '*')
    }
  }
  return (component) => {
    if (!fs.existsSync(path.join(root, component))) return null
    const out = new Set([...(uses.get(component)?.keys() ?? [])])
    for (const [barrel, names] of reexports.get(component) ?? []) {
      // 桶自己也用到了组件（import 了它）就照样算一处；只转出不用的，换成从桶里取了这些名字的文件。
      for (const [importer, taken] of uses.get(barrel) ?? []) {
        if (taken === '*' || names === '*' || [...taken].some((name) => names.has(name))) out.add(importer)
      }
    }
    out.delete(component)
    return [...out].sort()
  }
}

/**
 * 单张板的清单校验。纯函数、可测。
 * @param {{board:string, manifest:object, candidates:Array<{id:string}>, assertionCorpus:string, date?:string, boardNames?:string[], referrersOf?:(file:string)=>string[]|null}} input
 *   date = 板所在日期目录名（YYYY-MM-DD），不给就用清单的 approvedOn
 *   referrersOf = R12 用的引用方扫描（runBoardParity 传 makeReferrerScanner 的结果；不传时声明了 components 的新板会报「找不到」）
 * @returns {string[]} 错误列表（空 = 通过）
 */
export function checkBoardManifest({ board, manifest, candidates, assertionCorpus, date, boardNames, referrersOf }) {
  const errors = []
  const tag = (msg) => `[${board}] ${msg}`
  if (!manifest || typeof manifest !== 'object') return [tag('清单缺失或不是对象')]
  if (manifest.board !== board) errors.push(tag(`清单里的 board 字段是 ${manifest.board}，应为 ${board}`))
  if (!BOARD_STAGES.includes(manifest.stage)) errors.push(tag(`stage 只能是 ${BOARD_STAGES.join(' / ')}，当前 ${manifest.stage}`))
  errors.push(...checkPriorArt({ board, manifest, date }))
  errors.push(...checkBoundarySheet({ board, manifest, date, boardNames }))
  errors.push(...checkSameSurfacePriorArt({ board, manifest, date }))
  errors.push(...checkAppearsIn({ board, manifest, date, boardNames, referrersOf }))
  errors.push(...checkCensusPlacement({ board, manifest, date }))
  errors.push(...checkPriorDecisions({ board, manifest, date }))
  errors.push(...checkBoundaryCoverage({ board, manifest, date }))
  const elements = Array.isArray(manifest.elements) ? manifest.elements : []
  const decor = Array.isArray(manifest.decor) ? manifest.decor : []
  const census = Array.isArray(manifest.functionCensus) ? manifest.functionCensus : []

  // R2：元素 id 唯一
  const elementIds = new Set()
  for (const el of elements) {
    if (!isNonEmptyString(el.id)) errors.push(tag('有元素缺 id'))
    else if (elementIds.has(el.id)) errors.push(tag(`元素 id 重复：${el.id}`))
    else elementIds.add(el.id)
  }

  // R1：候选恰好被认领一次（元素或 decor）
  const candidateIds = new Set((candidates ?? []).map((c) => c.id))
  const claimed = new Map()
  const claim = (id, by) => claimed.set(id, [...(claimed.get(id) ?? []), by])
  for (const el of elements) for (const cid of el.candidates ?? []) claim(cid, `元素 ${el.id}`)
  for (const cid of decor) claim(cid, 'decor')
  for (const [cid, by] of claimed) {
    if (!candidateIds.has(cid)) errors.push(tag(`引用了不存在的候选：${cid}（${by.join('、')}）`))
    else if (by.length > 1) errors.push(tag(`候选被重复认领：${cid} ← ${by.join('、')}`))
  }
  for (const cid of candidateIds) {
    if (!claimed.has(cid)) errors.push(tag(`候选未认领（板上有、清单没去处）：${cid}`))
  }

  for (const el of elements) {
    const where = `元素 ${el.id}`
    // R2：status 合法
    if (!BOARD_STATUSES.includes(el.status)) {
      errors.push(tag(`${where} 的 status 非法：${el.status}`))
      continue
    }
    // R3：缺 / 在做必须有 owner
    if ((el.status === 'missing' || el.status === 'in-progress') && !isNonEmptyString(el.owner)) {
      errors.push(tag(`${where} 是 ${el.status}，必须写 owner（PR 号或交接任务名）`))
    }
    // R4：implemented 必须有走查断言，且断言名真在 tests/ux 里
    if (el.status === 'implemented') {
      if (!isNonEmptyString(el.assertion)) errors.push(tag(`${where} 是 implemented，必须写 assertion（走查断言名）`))
      else if (!assertionCorpus.includes(el.assertion)) errors.push(tag(`${where} 的断言 ${el.assertion} 不在 tests/ux 任何走查文件里`))
    }
    // R5：推迟 / 放弃必须有用户原话和日期
    if (el.status === 'deferred' || el.status === 'dropped') {
      const decision = el.userDecision
      if (!decision || !isNonEmptyString(decision.quote) || !isNonEmptyString(decision.date)) {
        errors.push(tag(`${where} 是 ${el.status}，必须有 userDecision {quote, date}（用户原话 + 日期）`))
      }
    }
    // R7：状态词表
    if (!Array.isArray(el.states) || el.states.length === 0) errors.push(tag(`${where} 缺 states（要列出它需要覆盖的状态）`))
    else for (const s of el.states) if (!BOARD_STATES.includes(s)) errors.push(tag(`${where} 的状态 ${s} 不在状态词表里`))
  }

  // R6：旧功能普查的去处必须是存在的元素
  for (const item of census) {
    if (!isNonEmptyString(item.function)) errors.push(tag('functionCensus 有一项缺 function'))
    if (!elementIds.has(item.after)) errors.push(tag(`旧功能「${item.function}」没有去处：after=${item.after} 不是本板的元素`))
  }
  return errors
}

/**
 * 解析 PR 正文的 `## 拍板图`：每行 `- <板名>: 元素id, 元素id`。
 * 返回 [{ board, ids }]。没有这一节 = []（照常过）。纯函数、可测。
 */
export function parsePrBoardClaims(body) {
  const lines = String(body || '').split(/\r?\n/)
  const start = lines.findIndex((line) => new RegExp(`^#{2,3}\\s+${PR_SECTION}\\s*$`).test(line.trim()))
  if (start < 0) return []
  const level = /^#+/.exec(lines[start].trim())[0].length
  const claims = []
  for (const line of lines.slice(start + 1)) {
    const heading = /^(#{1,6})\s+/.exec(line)
    if (heading && heading[1].length <= level) break
    const m = CLAIM_LINE.exec(line)
    if (!m) continue
    // 元素 id 以逗号 / 中文逗号 / 顿号 / 空白分隔；空串、纯分隔符得到 ids = []（V-gates B2：空认领不算认领，由 checkPrBoardClaims 判红）
    const ids = m[2].split(/[,，、\s]+/).map((s) => s.trim()).filter(Boolean)
    claims.push({ board: m[1], ids })
  }
  return claims
}

/**
 * merge 前判定：PR 认领的元素在 PR 头上是否都有去处。manifests：{ [board]: manifest }。纯函数、可测。
 */
export function checkPrBoardClaims(body, manifests) {
  const errors = []
  for (const { board, ids } of parsePrBoardClaims(body)) {
    // 每条认领至少一个合法的元素 id：「- Main: ,」这种空认领不能冒充已认领
    const valid = ids.filter((id) => ELEMENT_ID.test(id))
    if (!valid.length) errors.push(`拍板图 ${board} 的认领里没有合法的元素 id（写成「- ${board}: <元素 id>, <元素 id>」；空串、只有逗号 / 顿号 / 空白都不算认领）`)
    for (const id of ids.filter((id) => !ELEMENT_ID.test(id))) errors.push(`[${board}] 认领的「${id}」不是合法的元素 id`)
    const manifest = manifests[board]
    if (!manifest) {
      errors.push(`拍板图 ${board} 不存在（认领了一个没有清单的板）`)
      continue
    }
    if (manifest.ambiguous) {
      errors.push(`拍板图 ${board} 重名（不止一个日期目录有这张板），按板名认领有歧义：先改名`)
      continue
    }
    for (const id of valid) {
      const el = (manifest.elements ?? []).find((e) => e.id === id)
      if (!el) {
        errors.push(`[${board}] 认领的元素 ${id} 不在清单里`)
        continue
      }
      const decided = (el.status === 'deferred' || el.status === 'dropped') && el.userDecision?.quote && el.userDecision?.date
      if (el.status !== 'implemented' && !decided) {
        errors.push(`[${board}] 认领的元素 ${id} 还是 ${el.status}：合并前必须 implemented，或带用户原话的 deferred / dropped`)
      }
    }
  }
  return errors
}

/** 走查断言语料：tests/ux 下所有脚本的拼接文本（断言名只要在里面出现过即算「有走查」）。 */
export function loadAssertionCorpus(root = REPO_ROOT) {
  const dir = path.join(root, 'tests/ux')
  const chunks = []
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (/\.(mjs|cjs|js|ts|tsx)$/.test(entry.name)) chunks.push(fs.readFileSync(full, 'utf8'))
    }
  }
  if (fs.existsSync(dir)) walk(dir)
  return chunks.join('\n')
}

/**
 * 其它日期目录里的板（`docs/design/boards/<日期>/<板名>.board.json`，不在 BOARD_NAMES 那 12 张里）。
 * 2026-10-16：新板（例如只有文字拍板、没有画布的板）原来对门岗和合并前扫描都不可见——
 * 门岗不查它，PR 正文 `## 拍板图` 认领它时合并前扫描只会报「不存在」。
 * 返回 [{ board, dir, manifestOnly }]；身份 = 日期目录 + 板名（同名板各算一张，V-1203 复验 R1）；
 * manifestOnly = 同目录没有 `<板名>.candidates.json`（没有画布可抽候选）。
 */
export function findDatedBoards(root = path.dirname(BOARDS_DIR), skipDir = BOARDS_DIR) {
  const out = []
  if (!fs.existsSync(root)) return out
  for (const day of fs.readdirSync(root, { withFileTypes: true })) {
    if (!day.isDirectory()) continue
    const dir = path.join(root, day.name)
    if (path.resolve(dir) === path.resolve(skipDir)) continue
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith('.board.json')) continue
      const board = name.slice(0, -'.board.json'.length)
      out.push({ board, dir, manifestOnly: !fs.existsSync(path.join(dir, `${board}.candidates.json`)) })
    }
  }
  return out
}

export function loadManifests(dir = BOARDS_DIR, root = path.dirname(dir)) {
  const out = {}
  for (const board of BOARD_NAMES) {
    const file = path.join(dir, `${board}.board.json`)
    out[board] = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null
  }
  // 其它日期目录的板也能被 `## 拍板图` 认领到。重名（与固定 12 张或彼此）不挑第一份：标成有歧义，认领就红。
  for (const { board, dir: boardDir } of findDatedBoards(root, dir)) {
    if (out[board] === undefined) out[board] = JSON.parse(fs.readFileSync(path.join(boardDir, `${board}.board.json`), 'utf8'))
    else out[board] = { ambiguous: true }
  }
  return out
}

/**
 * 候选与板源哈希是否对得上（纯函数，可测）。
 * candidatesDoc = 解析后的 <Board>.candidates.json；currentHash = 当前板源的哈希。
 */
export function checkSourceHash({ board, candidatesDoc, currentHash }) {
  if (!candidatesDoc || typeof candidatesDoc.sourceSha256 !== 'string' || !candidatesDoc.sourceSha256) {
    return [`[${board}] candidates.json 缺 sourceSha256（抽取时没记板源哈希）：重跑 node scripts/board-extract.mjs`]
  }
  if (candidatesDoc.sourceSha256 !== currentHash) {
    return [`[${board}] 板源已改（哈希对不上）：板改了，重跑 node scripts/board-extract.mjs 并让清单认领新候选`]
  }
  return []
}

/**
 * 默认模式：只看哈希与清单，不起浏览器（CI 的 Contracts job 没有 Playwright 浏览器）。
 * reextract = true（显式 --reextract，只在本机或装了浏览器的环境）：再真抽一遍，比对候选文件全文。
 */
export async function runBoardParity({ dir = BOARDS_DIR, root = path.dirname(dir), reextract = false } = {}) {
  const errors = []
  const manifests = loadManifests(dir, root)
  const corpus = loadAssertionCorpus()
  // R12 的引用方扫描要读全部源文件：第一次用到时才建，之后共用。
  let scanner = null
  const referrersOf = (file) => (scanner ??= makeReferrerScanner())(file)
  // 其它日期目录里**发现到的每一张板**都跑完整规则（V-1203 F2：原来只查「只有清单」的那一种，带候选文件的新板落在两个循环之外）。
  // 发现集合与校验集合是同一份：findDatedBoards 找到什么就查什么。
  for (const { board, dir: boardDir, manifestOnly } of findDatedBoards(root, dir)) {
    let candidates = []
    if (!manifestOnly) {
      const doc = JSON.parse(fs.readFileSync(path.join(boardDir, `${board}.candidates.json`), 'utf8'))
      const extractor = typeof doc.extractor === 'string' ? doc.extractor : ''
      // 抽取出来的候选核板源哈希；人工普查（没有可抽取的板源）明写 extractor=manual-*，免哈希但照认领规则查；
      // 两样都不是 = 不声不响地免掉了哈希核对 → 红。
      if (extractor.startsWith('board-extract')) errors.push(...checkSourceHash({ board, candidatesDoc: doc, currentHash: hashBoardSource(boardDir, board) }))
      else if (!extractor.startsWith('manual')) errors.push(`[${board}] 候选文件既不是 board-extract 抽取的（核板源哈希），也没声明人工普查（extractor: manual-*）`)
      candidates = Array.isArray(doc.candidates) ? doc.candidates : []
    }
    // 读这张板自己目录里的清单，不按板名查表——同名板不能互相顶替（V-1203 复验 R1）。
    const manifest = JSON.parse(fs.readFileSync(path.join(boardDir, `${board}.board.json`), 'utf8'))
    errors.push(...checkBoardManifest({ board, manifest, candidates, assertionCorpus: corpus, date: path.basename(boardDir), boardNames: boardNamesIn(boardDir), referrersOf }))
  }
  // 重名本身就红：PR 正文按板名认领，重名就分不清认的是哪一张。
  const dated = findDatedBoards(root, dir)
  for (const name of new Set(dated.map((entry) => entry.board))) {
    const places = dated.filter((entry) => entry.board === name).map((entry) => path.basename(entry.dir))
    if (BOARD_NAMES.includes(name)) places.unshift(path.basename(dir))
    if (places.length > 1) errors.push(`[${name}] 同名板出现在多个日期目录（${places.join('、')}）：按板名认领有歧义，改名`)
  }
  for (const board of BOARD_NAMES) {
    const file = path.join(dir, `${board}.candidates.json`)
    const committed = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''
    if (!committed) {
      errors.push(`[${board}] 缺候选文件 ${board}.candidates.json：重跑 node scripts/board-extract.mjs`)
      continue
    }
    const doc = JSON.parse(committed)
    errors.push(...checkSourceHash({ board, candidatesDoc: doc, currentHash: hashBoardSource(dir, board) }))
    if (!manifests[board]) {
      errors.push(`[${board}] 缺清单 ${board}.board.json`)
      continue
    }
    errors.push(...checkBoardManifest({ board, manifest: manifests[board], candidates: doc.candidates, assertionCorpus: corpus, date: path.basename(dir), boardNames: boardNamesIn(dir), referrersOf }))
  }
  if (reextract) {
    // 显式开关：动态加载抽取（会起 Playwright 浏览器），逐字节比对候选文件。
    const { extractAllBoards, renderCandidatesFile } = await import('./board-extract.mjs')
    const fresh = await extractAllBoards()
    for (const board of BOARD_NAMES) {
      const file = path.join(dir, `${board}.candidates.json`)
      const committed = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''
      if (committed !== renderCandidatesFile(board, fresh[board], hashBoardSource(dir, board))) {
        errors.push(`[${board}] 重抽结果与 candidates.json 不一致（--reextract）：重跑 node scripts/board-extract.mjs`)
      }
    }
  }
  return errors
}

async function main() {
  const errors = await runBoardParity({ reextract: process.argv.includes('--reextract') })
  if (errors.length) {
    console.error(`拍板图对账未通过（${errors.length} 条）：`)
    for (const e of errors) console.error(`  ✗ ${e}`)
    process.exit(1)
  }
  const dated = findDatedBoards()
  console.log(`拍板图对账通过：${BOARD_NAMES.length} 张板，候选全部认领；其它日期目录 ${dated.length} 张板全部按完整规则查过（其中 ${dated.filter((entry) => entry.manifestOnly).length} 张只有清单）。`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error)
    process.exit(1)
  })
}
