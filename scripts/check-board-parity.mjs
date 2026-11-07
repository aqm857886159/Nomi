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
//  R8 PR 正文 `## 拍板图` 认领的元素：在 PR 头上必须是 implemented，或带 userDecision 的 deferred / dropped
//     （认领可以指向任何日期目录里的板；发现到的每张新日期板都跑完整规则：抽取候选核哈希、人工普查须声明）
//
// 用法：node scripts/check-board-parity.mjs            （重抽候选 + 全部规则）
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

// 默认模式只用常量和哈希：不 import 抽取（抽取要浏览器），抽取在 --reextract 里动态加载。
import { BOARD_NAMES, BOARDS_DIR, REPO_ROOT } from './board-extract.mjs'
import { hashBoardSource } from './board-source-hash.mjs'

export const BOARD_STATUSES = Object.freeze(['implemented', 'in-progress', 'missing', 'deferred', 'dropped'])
export const BOARD_STATES = Object.freeze(['empty', 'loading', 'error', 'selected', 'disabled', 'hover', 'narrow', 'long-text', 'zh-en', 'dark'])
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

const isNonEmptyString = (value) => typeof value === 'string' && value.trim().length > 0

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
  const normalize = (manifests) => Object.fromEntries(Object.keys(manifests).sort().map((name) => [name, manifests[name]]))
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
  items.forEach((item, index) => {
    for (const field of ['url', 'takeaway', 'decisionImpact']) {
      if (!isNonEmptyString(item?.[field])) errors.push(tag(`priorArt[${index}] 缺 ${field}`))
    }
    if (isNonEmptyString(item?.url) && !/^https?:\/\/\S+$/.test(item.url.trim())) errors.push(tag(`priorArt[${index}].url 不是 http(s) 链接：${item.url}`))
  })
  return errors
}

/**
 * 单张板的清单校验。纯函数、可测。
 * @param {{board:string, manifest:object, candidates:Array<{id:string}>, assertionCorpus:string, date?:string}} input
 *   date = 板所在日期目录名（YYYY-MM-DD），不给就用清单的 approvedOn
 * @returns {string[]} 错误列表（空 = 通过）
 */
export function checkBoardManifest({ board, manifest, candidates, assertionCorpus, date }) {
  const errors = []
  const tag = (msg) => `[${board}] ${msg}`
  if (!manifest || typeof manifest !== 'object') return [tag('清单缺失或不是对象')]
  if (manifest.board !== board) errors.push(tag(`清单里的 board 字段是 ${manifest.board}，应为 ${board}`))
  if (!BOARD_STAGES.includes(manifest.stage)) errors.push(tag(`stage 只能是 ${BOARD_STAGES.join(' / ')}，当前 ${manifest.stage}`))
  errors.push(...checkPriorArt({ board, manifest, date }))
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
    errors.push(...checkBoardManifest({ board, manifest, candidates, assertionCorpus: corpus, date: path.basename(boardDir) }))
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
    errors.push(...checkBoardManifest({ board, manifest: manifests[board], candidates: doc.candidates, assertionCorpus: corpus, date: path.basename(dir) }))
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
