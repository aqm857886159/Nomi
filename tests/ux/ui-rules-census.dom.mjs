// UI 基本规则 · 设计实验室 DOM 普查（2026-10-07，只读，不是门岗，不接 gates）。
//
// 规则正本：docs/research/2026-10-07-ui-basic-rules.md（UI-R01…）。静态那一半在 scripts/census-ui-rules.mjs；
// 这里只量**渲染出来才知道**的那一半：点击目标尺寸 / 对比度 / 无名字控件 / 被截断没全文 / 禁用没原因 /
// 决定栏顺序 / 对勾位置 / 焦点环 / 同标签不同样式 / 小字号 / 间距不是 4 的倍数。
// 跑哪些格：设计实验室全部屏的全部格（和 popupGeometry.census 同一套起服务、取页面的口子）。
// 「弹层压住触发钮」那条已有现成普查 tests/ux/design-lab/popupGeometry.census.mjs，这里不重做（汇总时直接引用它的结果）。
//
// 用法：
//   node tests/ux/ui-rules-census.dom.mjs                       全部格，写 tests/ux/shots/ui-rules-census/report.json
//   SCREEN=primitives-actions node tests/ux/ui-rules-census.dom.mjs   只跑一屏
//   SHOTS=1 node tests/ux/ui-rules-census.dom.mjs               每条规则另存最典型的 3 处截图（红框标出违例）
//
// 只读：不写产品代码、不碰 %APPDATA%、不连任何生成接口；起的 vite 在结束时一定关掉。
import { chromium } from 'playwright'
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { LAB_SCREEN_IDS, readLabStates, REPO_ROOT } from './design-lab/labStates.mjs'
import { assertLabPortOwnership, labOriginFor } from './design-lab/labServer.mjs'
import { stationTimeout } from './_station-budget.mjs'

const ROLE = 'popup-geometry' // 借用已登记的端口角色（不新增角色，不改实验室基建）；本脚本与它不同时跑
const ORIGIN = labOriginFor(ROLE)
const ONLY_SCREEN = process.env.SCREEN || ''
const WANT_SHOTS = process.env.SHOTS === '1'
const OUT_DIR = path.join(REPO_ROOT, 'tests/ux/shots/ui-rules-census')
const DIRECTOR_SCREENS = new Set(['director-3dbox', 'director-refine'])
const COLD_START_MS = stationTimeout({ operations: 12 })
const PER_STATE_MS = stationTimeout({ operations: 4 })
const FOCUS_STOPS = 10

// ---------------------------------------------------------------------------
// 页面内探针：自包含（会被序列化进浏览器），不依赖任何产品代码。
// 返回 { counts, items:[{rule, rect, text, ...}], labels:[{label, sig}] }
// ---------------------------------------------------------------------------
function probe() {
  const items = []
  const add = (rule, el, extra = {}) => {
    const r = el.getBoundingClientRect()
    items.push({ rule, rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }, tag: el.tagName.toLowerCase(), text: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 40), ...extra })
  }
  const cs = (el) => getComputedStyle(el)
  const visible = (el) => {
    const r = el.getBoundingClientRect()
    if (r.width <= 0 || r.height <= 0) return false
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const s = cs(n)
      if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) === 0) return false
    }
    return true
  }
  const parseColor = (value) => {
    const m = value.match(/rgba?\(([^)]+)\)/)
    if (!m) {
      const m2 = value.match(/color\(srgb ([\d.]+) ([\d.]+) ([\d.]+)(?: \/ ([\d.]+))?\)/)
      if (m2) return { r: m2[1] * 255, g: m2[2] * 255, b: m2[3] * 255, a: m2[4] === undefined ? 1 : Number(m2[4]) }
      return null
    }
    const parts = m[1].split(/[ ,/]+/).filter(Boolean).map(Number)
    return { r: parts[0], g: parts[1], b: parts[2], a: parts[3] === undefined ? 1 : parts[3] }
  }
  const over = (top, bottom) => {
    const a = top.a + bottom.a * (1 - top.a)
    if (a === 0) return { r: 0, g: 0, b: 0, a: 0 }
    return { r: (top.r * top.a + bottom.r * bottom.a * (1 - top.a)) / a, g: (top.g * top.a + bottom.g * bottom.a * (1 - top.a)) / a, b: (top.b * top.a + bottom.b * bottom.a * (1 - top.a)) / a, a }
  }
  const lum = (c) => {
    const f = (v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4 }
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b)
  }
  const ratio = (a, b) => { const l1 = lum(a); const l2 = lum(b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05) }
  /** 背景合成：自下而上叠到第一个不透明层；遇到渐变/图片背景返回 null（量不了，不乱报）。 */
  const backdrop = (el) => {
    const layers = []
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const s = cs(n)
      if (s.backgroundImage && s.backgroundImage !== 'none') return null
      const c = parseColor(s.backgroundColor)
      if (c && c.a > 0) { layers.push(c); if (c.a >= 1) break }
    }
    let acc = { r: 255, g: 255, b: 255, a: 1 }
    for (let i = layers.length - 1; i >= 0; i -= 1) acc = over(layers[i], acc)
    return acc
  }
  const opacityChain = (el) => { let o = 1; for (let n = el; n && n.nodeType === 1; n = n.parentElement) o *= Number(cs(n).opacity); return o }

  const INTERACTIVE = 'button, a[href], input:not([type=hidden]), select, textarea, [role=button], [role=menuitem], [role=menuitemcheckbox], [role=menuitemradio], [role=tab], [role=switch], [role=checkbox], [role=radio], [role=option], [role=slider], [role=link]'
  const interactive = [...document.querySelectorAll(INTERACTIVE)].filter((el) => visible(el) && !el.closest('[aria-hidden=true]') && !(el.getBoundingClientRect().width <= 2 && el.getBoundingClientRect().height <= 2))
  const enabled = interactive.filter((el) => !el.disabled && el.getAttribute('aria-disabled') !== 'true')

  // ---- UI-R10 点击目标 ≥24×24（WCAG 2.5.8，含「间距」例外与「行内」例外）
  const rects = enabled.map((el) => ({ el, r: el.getBoundingClientRect() }))
  const small = rects.filter(({ el, r }) => (r.width < 24 || r.height < 24) && !(cs(el).display === 'inline' && el.tagName === 'A'))
  const circleHitsRect = (cx, cy, rad, r) => {
    const nx = Math.max(r.left, Math.min(cx, r.right)); const ny = Math.max(r.top, Math.min(cy, r.bottom))
    return (cx - nx) ** 2 + (cy - ny) ** 2 < rad * rad
  }
  for (const { el, r } of small) {
    const cx = r.left + r.width / 2; const cy = r.top + r.height / 2
    const conflict = rects.some(({ el: o, r: or }) => {
      if (o === el || o.contains(el) || el.contains(o)) return false
      const small2 = or.width < 24 || or.height < 24
      if (small2) return Math.hypot(cx - (or.left + or.width / 2), cy - (or.top + or.height / 2)) < 24
      return circleHitsRect(cx, cy, 12, or)
    })
    // 同一个控件的 label/外壳扩大了点击区：input 在 label 里时按 label 量
    const wrapper = el.closest('label')
    if (wrapper) { const wr = wrapper.getBoundingClientRect(); if (wr.width >= 24 && wr.height >= 24) continue }
    add(conflict ? 'UI-R10' : 'UI-R10-spaced', el, { w: Math.round(r.width), h: Math.round(r.height) })
  }

  // ---- UI-R07 无名字的控件
  const accName = (el) => {
    const label = el.getAttribute('aria-label'); if (label && label.trim()) return label.trim()
    const by = el.getAttribute('aria-labelledby')
    if (by) { const t = by.split(/\s+/).map((id) => document.getElementById(id)?.textContent?.trim() ?? '').join(' ').trim(); if (t) return t }
    const text = (el.innerText || el.textContent || '').trim(); if (text) return text
    if (el.getAttribute('title')) return el.getAttribute('title')
    const img = el.querySelector('img[alt]'); if (img?.getAttribute('alt')) return img.getAttribute('alt')
    const svgTitle = el.querySelector('svg title'); if (svgTitle?.textContent?.trim()) return svgTitle.textContent.trim()
    if (el.id) { const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`); if (l?.textContent?.trim()) return l.textContent.trim() }
    if (el.closest('label')?.textContent?.trim()) return el.closest('label').textContent.trim()
    if (el.getAttribute('placeholder')) return el.getAttribute('placeholder')
    return ''
  }
  for (const el of interactive) if (!accName(el)) add('UI-R07', el)
  for (const el of document.querySelectorAll('[role=dialog], [role=alertdialog]')) {
    if (visible(el) && !accName(el)) add('UI-R18', el)
  }

  // ---- UI-R06 禁用没原因
  for (const el of interactive.filter((e) => e.disabled || e.getAttribute('aria-disabled') === 'true')) {
    if (el.matches('input[type=checkbox], input[type=radio]') && el.closest('label')?.title) continue
    const hasWhy = el.getAttribute('title') || el.getAttribute('aria-describedby') || el.closest('[title]') || el.parentElement?.closest('[aria-describedby]')
    const busy = el.getAttribute('aria-busy') === 'true' || el.querySelector('.nomi-loading-mark')
    if (!hasWhy && !busy) add('UI-R06', el)
  }

  // ---- UI-R16 被截断 / 硬切
  for (const el of document.querySelectorAll('body *')) {
    if (!visible(el)) continue
    const s = cs(el)
    if (!(el.childNodes.length && [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()))) continue
    const overflowsX = el.scrollWidth > el.clientWidth + 1 && s.overflowX !== 'visible'
    const clamped = s.webkitLineClamp && s.webkitLineClamp !== 'none' && el.scrollHeight > el.clientHeight + 1
    if (!overflowsX && !clamped) continue
    let covered = false
    for (let n = el, i = 0; n && i < 5; n = n.parentElement, i += 1) if (n.getAttribute('title') || n.getAttribute('aria-label') && n.matches('button, a')) covered = true
    if (!covered) add(s.textOverflow === 'ellipsis' || clamped ? 'UI-R16' : 'UI-R16-clipped', el, { full: el.textContent.trim().slice(0, 60) })
  }

  // ---- UI-R23 对比度（WCAG 1.4.3，4.5:1 / 大字 3:1；渐变/图片背景量不了的跳过）
  const seen = new Set()
  for (const el of document.querySelectorAll('body *')) {
    if (!visible(el)) continue
    const own = [...el.childNodes].filter((n) => n.nodeType === 3 && n.textContent.trim())
    if (!own.length) continue
    if (el.closest(':disabled, [aria-disabled=true], [aria-hidden=true]')) continue
    const s = cs(el)
    const fg = parseColor(s.color); const bg = backdrop(el)
    if (!fg || !bg) continue
    const alpha = fg.a * opacityChain(el)
    const eff = over({ ...fg, a: alpha }, bg)
    const size = parseFloat(s.fontSize); const bold = Number(s.fontWeight) >= 700
    const large = size >= 24 || (size >= 18.66 && bold)
    const need = large ? 3 : 4.5
    const got = ratio(eff, bg)
    if (got < need) {
      const key = `${el.tagName}|${s.color}|${bg.r | 0},${bg.g | 0},${bg.b | 0}|${own[0].textContent.trim().slice(0, 12)}`
      if (seen.has(key)) continue
      seen.add(key)
      add('UI-R23', el, { ratio: Number(got.toFixed(2)), need, size: Math.round(size), fg: s.color, opacity: Number(opacityChain(el).toFixed(2)) })
    }
    // ---- UI-R24 小字（< 11px，低于 token micro）
    if (size < 11 - 0.01) add('UI-R24', el, { size })
  }

  // ---- UI-R01 / UI-R03 / UI-R04 决定栏：同一行的按钮们
  const cancelRe = /^(取消|cancel|不要|不用|算了|no|not now|稍后|later|不分享|跳过|skip)/i
  const deleteRe = /^(删除|delete|remove|移除|丢弃|discard)/i
  const btns = interactive.filter((e) => e.matches('button, [role=button]'))
  const byParent = new Map()
  for (const b of btns) { const p = b.parentElement; if (!p) continue; (byParent.get(p) ?? byParent.set(p, []).get(p)).push(b) }
  const isFilled = (el) => { const c = parseColor(cs(el).backgroundColor); return c && c.a > 0.6 && lum(c) < 0.25 }
  for (const [, row] of byParent) {
    if (row.length < 2) continue
    const rs = row.map((b) => ({ b, r: b.getBoundingClientRect(), t: (b.innerText || b.getAttribute('aria-label') || '').trim() }))
    const sameLine = (a, b) => Math.abs((a.r.top + a.r.height / 2) - (b.r.top + b.r.height / 2)) < 10
    for (const c of rs.filter((x) => cancelRe.test(x.t))) {
      for (const p of rs) {
        if (p === c || cancelRe.test(p.t) || !p.t || !sameLine(c, p)) continue
        if (isFilled(p.b) && c.r.left > p.r.left) add('UI-R01', c.b, { with: p.t.slice(0, 20) })
      }
    }
    for (const d of rs.filter((x) => deleteRe.test(x.t) || x.b.querySelector('.tabler-icon-trash'))) {
      if (rs.some((o) => o !== d && !(deleteRe.test(o.t)) && sameLine(d, o) && o.r.left > d.r.right - 1)) add('UI-R03', d.b, { with: rs.filter((o) => o !== d).map((o) => o.t.slice(0, 10)).join('|') })
    }
  }
  for (const b of btns) {
    const icon = b.querySelector('svg[class*="tabler-icon-check"], svg[class*="tabler-icon-circle-check"]')
    if (!icon) continue
    if (b.getAttribute('aria-pressed') || b.getAttribute('aria-checked') || ['menuitemcheckbox', 'menuitemradio', 'option', 'checkbox', 'switch', 'radio'].includes(b.getAttribute('role'))) continue
    const text = (b.innerText || '').trim()
    add('UI-R04', b, { leftOfText: Boolean(text) && icon.getBoundingClientRect().left < b.getBoundingClientRect().left + 24, label: text.slice(0, 20) })
  }

  // ---- UI-R13 间距：flex/grid gap 不是 4 的倍数（信息档，按值分组）
  const gaps = {}
  for (const el of document.querySelectorAll('body *')) {
    const s = cs(el)
    if (!/flex|grid/.test(s.display)) continue
    for (const v of [s.columnGap, s.rowGap]) {
      const n = parseFloat(v)
      if (n > 0 && n % 4 !== 0 && visible(el)) gaps[n] = (gaps[n] ?? 0) + 1
    }
  }

  // ---- UI-R11 同标签不同样式：把可见短标签按钮的外观指纹带回去汇总
  const labels = []
  for (const el of btns) {
    const t = (el.innerText || '').trim()
    if (!t || t.length > 8 || t.includes('\n')) continue
    const s = cs(el); const r = el.getBoundingClientRect()
    labels.push({ label: t, sig: [Math.round(r.height), s.borderRadius, s.backgroundColor, s.color, s.fontSize, s.fontWeight, s.borderTopWidth].join('|') })
  }
  // ---- UI-R32 / UI-R33 / UI-R36 图标位置、尺寸描边、与文字中线对齐（组件级小规则）
  const iconStats = []
  const structural = /tabler-icon-(chevron|arrow|caret|selector|external|dots|maximize|minimize)/
  for (const el of interactive.filter((e) => e.matches('button, [role=button], [role=menuitem], a[href]'))) {
    const svgs = [...el.querySelectorAll('svg')].filter((v) => visible(v) && v.getBoundingClientRect().width > 0)
    if (!svgs.length) continue
    const text = (el.innerText || '').trim()
    for (const svg of svgs) {
      const sr = svg.getBoundingClientRect()
      const stroke = svg.getAttribute('stroke-width') || getComputedStyle(svg).strokeWidth
      iconStats.push({ w: Math.round(sr.width * 10) / 10, stroke: String(stroke), hasText: Boolean(text) })
    }
    if (!text || svgs.length !== 1) continue
    const svg = svgs[0]; const sr = svg.getBoundingClientRect()
    const range = document.createRange(); const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
    let tr = null
    for (let t = walker.nextNode(); t; t = walker.nextNode()) { if (t.textContent.trim() && !svg.contains(t)) { range.selectNodeContents(t); const rr = range.getBoundingClientRect(); if (rr.width > 0) { tr = rr; break } } }
    if (!tr) continue
    const dy = Math.abs((sr.top + sr.height / 2) - (tr.top + tr.height / 2))
    if (dy > 1.5) add('UI-R36', el, { dy: Number(dy.toFixed(1)) })
    const right = (sr.left + sr.width / 2) > (tr.left + tr.width / 2)
    const isStructural = structural.test(svg.getAttribute('class') || '')
    const gap = right ? Math.round(sr.left - tr.right) : Math.round(tr.left - sr.right)
    iconStats.push({ pos: right ? 'right' : 'left', structural: isStructural, gap })
    if (right && !isStructural) add('UI-R32', el, { gap })
  }
  return { items, gaps, labels, iconStats, interactive: interactive.length }
}

// 焦点环：真 Tab 走一遍，量每一站有没有可见指示（自身 / 向上 3 层的 outline、box-shadow、border、背景在聚焦前后有变化）
async function probeFocus(page) {
  const results = []
  const snap = () => page.evaluate(() => {
    const el = document.activeElement
    if (!el || el === document.body) return null
    const chain = []
    for (let n = el, i = 0; n && i < 4; n = n.parentElement, i += 1) {
      const s = getComputedStyle(n)
      chain.push([s.outlineStyle, s.outlineWidth, s.outlineColor, s.boxShadow, s.borderTopColor, s.borderTopWidth, s.backgroundColor, s.textDecorationLine].join('|'))
    }
    const r = el.getBoundingClientRect()
    return { chain, tag: el.tagName.toLowerCase(), text: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 30), rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }, focusVisible: el.matches(':focus-visible') }
  })
  await page.keyboard.press('Tab')
  for (let i = 0; i < FOCUS_STOPS; i += 1) {
    const on = await snap()
    if (!on) break
    // 同一个元素：失焦取「前」、再程序化聚焦（focusVisible）取「后」，Tab 序列从它继续
    const handle = await page.evaluateHandle(() => document.activeElement)
    const off = await handle.evaluate((el) => { el.blur() }).then(() => page.evaluate(() => {
      return null
    }))
    void off
    const before = await handle.evaluate((el) => {
      const chain = []
      for (let n = el, k = 0; n && k < 4; n = n.parentElement, k += 1) {
        const s = getComputedStyle(n)
        chain.push([s.outlineStyle, s.outlineWidth, s.outlineColor, s.boxShadow, s.borderTopColor, s.borderTopWidth, s.backgroundColor, s.textDecorationLine].join('|'))
      }
      return chain
    })
    await handle.evaluate((el) => el.focus({ focusVisible: true }))
    const after = await snap()
    const differs = after && after.chain.some((c, idx) => c !== before[idx])
    if (!differs) results.push({ rule: 'UI-R09', tag: on.tag, text: on.text, rect: on.rect, focusVisible: after?.focusVisible })
    await page.keyboard.press('Tab')
  }
  return results
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------
const allTargets = LAB_SCREEN_IDS
  .filter((screen) => !ONLY_SCREEN || screen === ONLY_SCREEN)
  .filter((screen) => !(process.env.SKIP_SCREENS || '').split(',').includes(screen))
  .flatMap((screen) => readLabStates(screen).map((state) => ({ screen, state })))
if (!allTargets.length) throw new Error(`没有要量的格（SCREEN=${ONLY_SCREEN || '全部'}）`)

fs.mkdirSync(OUT_DIR, { recursive: true })
const tailwind = spawnSync(process.execPath, ['scripts/build-tailwind.mjs'], { cwd: REPO_ROOT, stdio: 'inherit' })
if (tailwind.status !== 0) throw new Error('build-tailwind 失败：整页没有样式，量出来的数没有意义')

assertLabPortOwnership(ROLE)
const port = new URL(ORIGIN).port
const vite = spawn(process.execPath, [path.join(REPO_ROOT, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', port, '--strictPort'], {
  cwd: REPO_ROOT,
  stdio: ['ignore', 'ignore', 'pipe'],
})
vite.stderr?.on('data', (chunk) => process.stderr.write(`[vite] ${chunk}`))

const report = { iconSizes: {}, iconStroke: {}, iconPos: { left: 0, right: 0, rightStructural: 0 }, iconGap: {}, cells: 0, failedCells: [], byRule: {}, gaps: {}, labelSigs: {}, shotsTaken: {}, interactive: 0 }
const shotLeft = {} // rule → 还能再截几张
const langOf = (id) => (/(^|[-_])zh([-_]|$)/.test(id) ? 'zh' : /(^|[-_])en([-_]|$)/.test(id) ? 'en' : 'other')
const wantShot = (rule, id) => {
  if (!WANT_SHOTS) return false
  const taken = (report.shotsTaken[rule] ??= [])
  if (taken.length >= 3 || taken.some((t) => t.cell === id)) return false
  const lang = langOf(id)
  if (taken.length === 2 && !taken.some((t) => t.lang === 'zh') && lang !== 'zh') return false
  if (taken.length === 2 && !taken.some((t) => t.lang === 'en') && !taken.some((t) => t.lang === 'zh' && lang !== 'en') && lang !== 'en' && taken.filter((t) => t.lang === 'other').length >= 2) return false
  return true
}

const browser = await chromium.launch()
try {
  const deadline = Date.now() + COLD_START_MS
  for (;;) {
    try { if ((await fetch(`${ORIGIN}/design-lab.html`)).ok) break } catch { /* not up */ }
    if (Date.now() > deadline) throw new Error('实验室 vite 起不来')
    await new Promise((resolve) => setTimeout(resolve, 400))
  }
  assertLabPortOwnership(ROLE)
  {
    const warm = await browser.newPage()
    await warm.goto(`${ORIGIN}/design-lab.html?screen=${allTargets[0].screen}&frame=1&state=${allTargets[0].state.id}`, { timeout: COLD_START_MS, waitUntil: 'domcontentloaded' })
    await warm.waitForFunction(() => window.__designLabReady === true, null, { timeout: COLD_START_MS })
    await warm.close()
  }

  let n = 0
  const CONCURRENCY = Number(process.env.CONCURRENCY || 3)
  const queue = [...allTargets]
  const runOne = async ({ screen, state }) => {
    n += 1
    const cell = `${screen}/${state.id}`
    let done = false
    for (let attempt = 0; attempt < 2 && !done; attempt += 1) {
      const context = await browser.newContext({ viewport: DIRECTOR_SCREENS.has(screen) ? { width: 1280, height: 933 } : { width: 1440, height: 1000 }, colorScheme: 'light', deviceScaleFactor: 1 })
      try {
        const page = await context.newPage()
        await page.goto(`${ORIGIN}/design-lab.html?screen=${screen}&frame=1&state=${state.id}`, { timeout: PER_STATE_MS, waitUntil: 'domcontentloaded' })
        await page.waitForFunction(() => window.__designLabReady === true, null, { timeout: PER_STATE_MS })
        await page.waitForTimeout(200)
        const result = await page.evaluate(probe)
        let focusItems = []
        try { focusItems = await probeFocus(page) } catch { /* 焦点探测失败不影响其余规则 */ }
        report.interactive += result.interactive
        for (const st of result.iconStats) {
          if (st.w !== undefined) { report.iconSizes[st.w] = (report.iconSizes[st.w] ?? 0) + 1; report.iconStroke[st.stroke] = (report.iconStroke[st.stroke] ?? 0) + 1 }
          if (st.pos) { if (st.pos === 'right') report.iconPos[st.structural ? 'rightStructural' : 'right'] += 1; else report.iconPos.left += 1; report.iconGap[st.gap] = (report.iconGap[st.gap] ?? 0) + 1 }
        }
        for (const [g, c] of Object.entries(result.gaps)) report.gaps[g] = (report.gaps[g] ?? 0) + c
        for (const { label, sig } of result.labels) ((report.labelSigs[label] ??= {})[sig] ??= new Set()).add(cell)
        const all = [...result.items, ...focusItems]
        for (const item of all) {
          const bucket = (report.byRule[item.rule] ??= [])
          bucket.push({ cell, ...item })
          if (item.rect && item.rect.w > 0 && item.rect.y >= 0 && item.rect.y < 980 && item.rect.x >= 0 && item.rect.x < 1400 && wantShot(item.rule, cell)) {
            const margin = 90
            const clip = { x: Math.max(0, item.rect.x - margin), y: Math.max(0, item.rect.y - margin), width: Math.min(1440 - Math.max(0, item.rect.x - margin), item.rect.w + margin * 2), height: Math.min(1000 - Math.max(0, item.rect.y - margin), item.rect.h + margin * 2) }
            await page.evaluate((r) => {
              const box = document.createElement('div')
              box.style.cssText = `position:fixed;left:${r.x - 2}px;top:${r.y - 2}px;width:${r.w + 4}px;height:${r.h + 4}px;outline:2px solid #ff2d55;outline-offset:0;pointer-events:none;z-index:2147483647`
              document.body.appendChild(box)
            }, item.rect)
            const slot = { cell, lang: langOf(state.id), file: '', text: item.text }
            ;(report.shotsTaken[item.rule] ??= []).push(slot)
            const file = path.join(OUT_DIR, `${item.rule}__${screen}__${state.id}.png`.replace(/[^\w.\-]+/g, '_'))
            await page.screenshot({ path: file, clip, animations: 'disabled' })
            slot.file = path.relative(REPO_ROOT, file).split(path.sep).join('/')
          }
        }
        report.cells += 1
        done = true
        console.log(`  [${n}/${allTargets.length}] ${cell}：交互控件 ${result.interactive}，命中 ${all.length}`)
      } catch (error) {
        if (attempt === 1) { report.failedCells.push({ cell, error: String(error).split(/\r?\n/)[0] }); console.log(`  ✗ ${cell} 渲染失败：${String(error).split(/\r?\n/)[0]}`) }
      } finally {
        await context.close()
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => { for (let t = queue.shift(); t; t = queue.shift()) await runOne(t) }))
} finally {
  await browser.close()
  vite.kill()
}

// 同标签多种外观：只留「同一个短标签 ≥2 种指纹，且每种至少出现在 2 格」的，防止单格噪音
const labelReport = []
for (const [label, sigs] of Object.entries(report.labelSigs)) {
  const kinds = Object.entries(sigs).map(([sig, cells]) => ({ sig, cells: [...cells] })).filter((k) => k.cells.length >= 2)
  if (kinds.length >= 2) labelReport.push({ label, variants: kinds.length, kinds: kinds.map((k) => ({ sig: k.sig, cellCount: k.cells.length, sample: k.cells.slice(0, 2) })) })
}
labelReport.sort((a, b) => b.variants - a.variants)

const summary = Object.fromEntries(Object.entries(report.byRule).map(([rule, rows]) => [rule, { count: rows.length, cells: new Set(rows.map((r) => r.cell)).size }]))
const outFile = path.join(OUT_DIR, 'report.json')
fs.writeFileSync(outFile, JSON.stringify({ ...report, labelSigs: undefined, labelVariants: labelReport, summary }, null, 2))
console.log(`\n格数 ${report.cells}/${allTargets.length}（失败 ${report.failedCells.length}），交互控件 ${report.interactive}`)
for (const [rule, s] of Object.entries(summary).sort()) console.log(`  ${rule.padEnd(16)} ${String(s.count).padStart(5)} 处 / ${String(s.cells).padStart(3)} 格`)
console.log(`  同标签多外观：${labelReport.length} 个标签`)
console.log(`  图标位置：${JSON.stringify(report.iconPos)}；图标实际尺寸分布：${JSON.stringify(report.iconSizes)}；描边：${JSON.stringify(report.iconStroke)}；图标与文字间距：${JSON.stringify(report.iconGap)}`)
console.log(`  gap 不是 4 的倍数：${JSON.stringify(report.gaps)}`)
console.log(`报告：${path.relative(REPO_ROOT, outFile)}`)
