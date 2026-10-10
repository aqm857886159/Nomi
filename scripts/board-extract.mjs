#!/usr/bin/env node
// 设计图对账：把拍板板源（docs/design/boards/2026-10-08/preview/*.html）拆成「看得见的候选元素」。
//
// 为什么要这个：拍板图只是一张画，没人知道它一共有几个东西，于是「图上有、产品没做」只能靠用户自己发现。
// 抽出来的候选清单是对账的地基：清单里每个候选必须被一个元素认领，或列进 decor（纯装饰）。
//
// 确定性：只看 DOM 顺序、可见性和文字，不看字体与像素（外网字体请求全部断掉）。
// 同一份板源在任何机器上抽出的候选 id 完全一样；候选 id 只由 DOM 序号 + 标签 + 文字片段组成。
//
// 用法：
//   node scripts/board-extract.mjs            写 <Board>.candidates.json（12 张）
//   node scripts/board-extract.mjs --check    与仓库里的 candidates.json 比对，不一致退出码 1
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { hashBoardSource } from './board-source-hash.mjs'

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const BOARDS_DIR = path.join(REPO_ROOT, 'docs/design/boards/2026-10-08')
export const BOARD_NAMES = Object.freeze([
  'Main', 'Chrome', 'List', 'ListDetail', 'EmptyStates', 'Edges',
  'TextNode', 'Creation', 'CreationDoc', 'Library', 'LibraryEmpty', 'CanvasAgent',
])
export const VIEWPORT = Object.freeze({ width: 1280, height: 800 })
export const EXTRACTOR_VERSION = 'board-extract@1'

// 结构性 class 词：带这些词的可见盒子（条 / 卡 / 框）也算候选，即使它自己没文字。
const STRUCTURAL_CLASS = /(^|[\s_-])(card|bar|chip|tab|pill|btn|badge|node|group|frame|header|toolbar|panel|drawer|chrome|menu|row|strip|thumb|hint|tip|empty|action|dock|sheet|modal|dialog|pop|sidebar|nav|tray|timeline|edge|handle|composer|segment|seg|ctl|control)/i
const INTERACTIVE_TAGS = new Set(['button', 'a', 'input', 'select', 'textarea', 'label'])
const INTERACTIVE_ROLE = /^(button|tab|menuitem|switch|checkbox|option|link|radio|combobox|slider|textbox)$/
const SKIP_TAGS = new Set(['script', 'style', 'link', 'meta', 'title', 'helmet', 'template', 'noscript'])

/** 候选 id：DOM 序号（三位）+ 标签 + 文字片段（去空白、取前 12 字符）。纯函数、可测。 */
export function candidateId(seq, tag, text) {
  const slug = String(text || '').replace(/\s+/g, '').replace(/[^\p{L}\p{N}]/gu, '').slice(0, 12)
  return slug ? `${String(seq).padStart(3, '0')}-${tag}-${slug}` : `${String(seq).padStart(3, '0')}-${tag}`
}

/**
 * 把页面里原始采到的元素行（已按 DOM 顺序）变成候选清单。纯函数、可测。
 * 图标（svg）单独成候选；它归属的按钮 / 链接写在 `iconOf`，供清单生成时把图标挂到同一元素上。
 */
export function buildCandidates(rows) {
  const out = []
  rows.forEach((row, index) => {
    const seq = index + 1
    const id = candidateId(seq, row.tag, row.text)
    out.push({
      id,
      kind: row.kind,
      tag: row.tag,
      ...(row.role ? { role: row.role } : {}),
      text: row.text,
      bbox: row.bbox,
      region: row.region,
      ...(row.iconOf !== undefined ? { iconOf: row.iconOf } : {}),
    })
  })
  // iconOf 存的是「行号」，这里换成候选 id（行号 → id 的映射在同一遍里完成，不会错位）。
  const byRow = new Map(out.map((c, i) => [i, c.id]))
  for (const c of out) {
    if (typeof c.iconOf === 'number') c.iconOf = byRow.get(c.iconOf) ?? null
  }
  return out
}

/** 在页面里跑：采集可见候选的原始行。只读 DOM，不改页面。 */
function collectRowsInPage(structuralSrc) {
  const STRUCT = new RegExp(structuralSrc, 'i')
  const INTERACTIVE_TAGS_L = ['button', 'a', 'input', 'select', 'textarea', 'label']
  const INTERACTIVE_ROLE_RE = /^(button|tab|menuitem|switch|checkbox|option|link|radio|combobox|slider|textbox)$/
  const SKIP = ['script', 'style', 'link', 'meta', 'title', 'helmet', 'template', 'noscript']
  const REGION_TOKENS = ['topbar', 'navbar', 'header', 'sidebar', 'leftbar', 'left', 'drawer', 'canvas', 'node', 'card', 'toolbar', 'composer', 'timeline', 'agent', 'popover', 'menu', 'footer', 'dock', 'panel']
  const visible = (el) => {
    const cs = getComputedStyle(el)
    if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) return false
    const r = el.getBoundingClientRect()
    return r.width > 0 && r.height > 0
  }
  const regionOf = (el) => {
    for (let node = el; node && node !== document.body; node = node.parentElement) {
      const token = REGION_TOKENS.find((t) => (node.getAttribute('class') || '').toLowerCase().includes(t))
      if (token) return token
    }
    return 'root'
  }
  const ownText = (el) => {
    let s = ''
    for (const n of el.childNodes) if (n.nodeType === 3) s += n.textContent
    return s.replace(/\s+/g, ' ').trim()
  }
  const rows = []
  const rowOfEl = new Map()
  const all = Array.from(document.body.querySelectorAll('*'))
  for (const el of all) {
    const tag = el.tagName.toLowerCase()
    if (SKIP.includes(tag) || el.closest('helmet, template')) continue
    if (!visible(el)) continue
    const role = el.getAttribute('role') || ''
    const cls = el.getAttribute('class') || ''
    const label = el.getAttribute('aria-label') || ''
    const text = ownText(el) || label
    const isSvg = tag === 'svg'
    let kind = null
    if (isSvg) {
      // svg：有 aria-label 或在按钮内的才当候选；纯装饰 svg 也要成候选（kind=icon），归属由 iconOf 决定。
      kind = 'icon'
    } else if (text) kind = 'text'
    else if (INTERACTIVE_TAGS_L.includes(tag) || INTERACTIVE_ROLE_RE.test(role)) kind = 'control'
    else if (STRUCT.test(cls)) kind = 'box'
    if (!kind) continue
    if (kind === 'box' && !text) {
      const r0 = el.getBoundingClientRect()
      if (r0.width < 12 || r0.height < 12) continue
    }
    if (kind === 'control' && !text && !label) {
      // 无字按钮：仍是候选（控件），文字为空。
    }
    const r = el.getBoundingClientRect()
    rowOfEl.set(el, rows.length)
    rows.push({
      tag: isSvg ? 'svg' : tag,
      kind,
      role: role || undefined,
      text: text.slice(0, 60),
      bbox: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
      region: regionOf(el),
      _el: el,
    })
  }
  // 图标归属：svg 向上找最近的可交互祖先（已成候选的那一行）。
  for (const row of rows) {
    if (row.kind !== 'icon') continue
    let owner = null
    for (let node = row._el.parentElement; node && node !== document.body; node = node.parentElement) {
      if (rowOfEl.has(node) && rows[rowOfEl.get(node)].kind !== 'icon') {
        owner = rowOfEl.get(node)
        break
      }
    }
    row.iconOf = owner
  }
  return rows.map(({ _el, ...rest }) => rest)
}

/** 抽一张板的候选（需要 Playwright 的 page；只读）。 */
export async function extractBoard(page, htmlFile) {
  await page.route(/^https?:/, (route) => route.abort())
  await page.setViewportSize(VIEWPORT)
  await page.goto(pathToFileURL(htmlFile).href, { waitUntil: 'load' })
  await page.evaluate(() => document.fonts && document.fonts.ready)
  const rows = await page.evaluate(collectRowsInPage, STRUCTURAL_CLASS.source)
  return buildCandidates(rows)
}

export function candidatesFileOf(board) {
  return path.join(BOARDS_DIR, `${board}.candidates.json`)
}

export function previewFileOf(board) {
  return path.join(BOARDS_DIR, 'preview', `${board}.html`)
}

/** 候选文件正文。sourceSha256 = 抽取时板源的哈希，门岗默认模式靠它判断板改没改（不需要重抽）。 */
export function renderCandidatesFile(board, candidates, sourceSha256) {
  return `${JSON.stringify({
    board,
    extractor: EXTRACTOR_VERSION,
    source: `preview/${board}.html`,
    sourceSha256,
    viewport: VIEWPORT,
    candidates,
  }, null, 2)}\n`
}

async function withBrowser(fn) {
  const { chromium } = await import('playwright')
  const browser = await chromium.launch({ headless: true })
  try {
    const context = await browser.newContext({ viewport: VIEWPORT, colorScheme: 'light' })
    const page = await context.newPage()
    return await fn(page)
  } finally {
    await browser.close()
  }
}

/** 抽全部 12 张，返回 { board: candidates[] }。 */
export async function extractAllBoards() {
  return withBrowser(async (page) => {
    const result = {}
    for (const board of BOARD_NAMES) result[board] = await extractBoard(page, previewFileOf(board))
    return result
  })
}

async function main() {
  const check = process.argv.includes('--check')
  const all = await extractAllBoards()
  let drift = 0
  for (const board of BOARD_NAMES) {
    const text = renderCandidatesFile(board, all[board], hashBoardSource(BOARDS_DIR, board))
    const file = candidatesFileOf(board)
    if (check) {
      const committed = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''
      if (committed !== text) {
        drift += 1
        console.error(`候选漂移：${board}（板源变了或抽取规则变了，重跑 node scripts/board-extract.mjs）`)
      }
    } else {
      fs.writeFileSync(file, text)
      console.log(`${board}: ${all[board].length} 个候选`)
    }
  }
  if (check && drift) process.exit(1)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error)
    process.exit(1)
  })
}
