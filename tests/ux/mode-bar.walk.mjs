// 底栏「模型｜方式｜参数」走查（2026-11-12 样张 A–J，清单 docs/design/boards/2026-11-12-mode-bar/ModeBar.board.json）。
//
// 一格 = 实验室里现役 `BaseGenerationNode` + `NodeGenerationComposer`（states/03-mode-bar.tsx）。方式格、方式菜单、
// 行尾那句话都是生产组件按唯一 owner modeForInputs 现算的；这里对每个拍板元素量一条用户看得见的事实，
// 断言名 `board:ModeBar/<元素 id>` 与清单一一对应。每格中 / 英 × 明 / 暗各截一张，证据进 docs/evidence/2026-11-12-mode-bar/。
//
// 后半段是边界走查（mb-k*，边界样张 K1–K5，用户 2026-11-12「按推荐做」），放到最多的数据上判四条（每格中 / 英各一遍）：
//   ① 底栏相邻两颗不互相盖；② 没有东西出生成框；③ 行尾那句话、底栏每一格都只一行（不折、不截半个值）；
//   ④ 放满 30 + 10 + 10 时那句话在可视区里（不在滚动口里、不跟着图滚走）。
// 每条先红后绿证过：把实现拿掉，这几条变红（见报告）。量到的事实另写进 boundary.json。
//
// 用法：node tests/ux/mode-bar.walk.mjs        （EVIDENCE=0 只跑断言不截图；BOUNDARY_ONLY=1 只跑边界）
import { stationTimeout } from './_station-budget.mjs'
import { uiText, uiTextWith } from './full-walk/invariants.mjs'
import { chromium } from 'playwright'
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { REPO_ROOT } from './design-lab/labStates.mjs'
import { assertLabPortOwnership, labPortFor } from './design-lab/labServer.mjs'

const ROLE = 'walk-mode-bar'
const HOST = '127.0.0.1'
const PORT = labPortFor(ROLE)
const BASE = `http://${HOST}:${PORT}`
const SCREEN = 'node-composer-bar'
const EVIDENCE_DIR = path.join(REPO_ROOT, 'docs/evidence/2026-11-12-mode-bar')
const WITH_EVIDENCE = process.env.EVIDENCE !== '0'
const LOCALES = [['zh', 'zh-CN'], ['en', 'en']]
const SCHEMES = ['light', 'dark']

const failures = []
const passed = []
function check(name, ok, detail) {
  if (ok) { passed.push(name); console.log(`  ✓ ${name}`) } else { failures.push(`${name}${detail ? ` — ${detail}` : ''}`); console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`) }
}

async function waitForServer(url, timeoutMs = 90000) {
  const start = Date.now()
  for (;;) {
    try { const response = await fetch(url); if (response.ok || response.status === 404) return } catch { /* not up yet */ }
    if (Date.now() - start > timeoutMs) throw new Error('vite dev server 启动超时')
    await new Promise((resolve) => setTimeout(resolve, 400))
  }
}

if (spawnSync('node', ['scripts/build-tailwind.mjs'], { cwd: REPO_ROOT, stdio: 'inherit' }).status !== 0) throw new Error('build-tailwind 失败')
assertLabPortOwnership(ROLE)
const vite = spawn(process.execPath, [path.join(REPO_ROOT, 'node_modules/vite/bin/vite.js'), '--host', HOST, '--port', String(PORT), '--strictPort'], { cwd: REPO_ROOT, stdio: ['ignore', 'ignore', 'pipe'] })
vite.stderr?.on('data', (chunk) => process.stderr.write(`[vite] ${chunk}`))
await waitForServer(BASE)
const browser = await chromium.launch({ headless: true })
const pageErrors = []

async function open(state, { lang = 'zh', scheme = 'light' } = {}) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 })
  const page = await context.newPage()
  page.on('pageerror', (error) => pageErrors.push(`${state}: ${String(error).slice(0, 200)}`))
  const extra = `${lang === 'en' ? '&lang=en' : ''}${scheme === 'dark' ? '&scheme=dark' : ''}`
  await page.goto(`${BASE}/design-lab.html?screen=${SCREEN}&frame=1&state=${state}${extra}`, { timeout: stationTimeout({ operations: 12 }) })
  await page.waitForFunction(() => window.__designLabReady === true, null, { timeout: stationTimeout({ operations: 6 }) })
  return { page, context }
}

const CARD = '.generation-canvas-v2-node__composer-card'
const FOOTER = `${CARD} [data-node-composer-footer]`
const text = (page, selector) => page.evaluate((sel) => document.querySelector(sel)?.textContent?.trim() ?? null, selector)
const count = (page, selector) => page.evaluate((sel) => document.querySelectorAll(sel).length, selector)
const modeTrigger = (locale) => `${FOOTER} button[aria-label="${uiText(locale, 'generationCommon.modeMenu.heading')}"]`
const CJK = /[\u3400-\u9fff]/
const name = (locale, kind) => uiText(locale, `generationCommon.modeMenu.name.${kind}`)

/** 打开着的方式菜单：小标题、每行（名字 / 说明 / 置灰 / 打勾）。 */
const readMenu = (page) => page.evaluate(() => {
  const dropdown = [...document.querySelectorAll('[data-nomi-select-dropdown]')].find((el) => el.getBoundingClientRect().width > 0) ?? null
  if (!dropdown) return null
  const rows = [...dropdown.querySelectorAll('[role="option"]')].map((el) => {
    const check = el.querySelector('svg.tabler-icon-check')?.closest('span')
    return {
      label: el.querySelector('[data-nomi-select-option-label]')?.textContent?.trim() ?? '',
      description: el.querySelector('[data-nomi-select-option-description]')?.textContent?.trim() ?? '',
      disabled: el.hasAttribute('data-combobox-disabled'),
      checked: Boolean(check) && !check.classList.contains('invisible'),
      icon: Boolean(el.querySelector('svg.tabler-icon:not(.tabler-icon-check)')),
    }
  })
  const rect = dropdown.getBoundingClientRect()
  return { heading: dropdown.querySelector('[data-nomi-select-heading]')?.textContent?.trim() ?? null, rows, width: Math.round(rect.width), height: Math.round(rect.height) }
})

async function shot(page, state, file) {
  if (!WITH_EVIDENCE) return
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true })
  // 拍的范围 = 样张框 ∪ 打开着的下拉（菜单挂在 portal 上、会伸出样张框；只拍框会把菜单下半截切掉，K5 英文就被切过）。
  const clip = await page.evaluate((sel) => {
    const boxes = [document.querySelector(sel), ...document.querySelectorAll('[data-nomi-select-dropdown]')]
      .filter(Boolean).map((el) => el.getBoundingClientRect()).filter((r) => r.width > 0 && r.height > 0)
    const left = Math.min(...boxes.map((r) => r.left)); const top = Math.min(...boxes.map((r) => r.top))
    const right = Math.max(...boxes.map((r) => r.right)); const bottom = Math.max(...boxes.map((r) => r.bottom))
    return { x: Math.max(0, left), y: Math.max(0, top), width: Math.min(window.innerWidth, right) - Math.max(0, left), height: Math.min(window.innerHeight, bottom) - Math.max(0, top), cut: bottom > window.innerHeight || right > window.innerWidth }
  }, `[data-design-lab-shot="${state}"]`)
  if (clip.cut) failures.push(`截图 ${file}：样张框或菜单伸出了视口，截不全`)
  await page.screenshot({ path: path.join(EVIDENCE_DIR, `${file}.png`), clip: { x: clip.x, y: clip.y, width: clip.width, height: clip.height }, animations: 'disabled' })
}

const SAMPLE_STATES = process.env.BOUNDARY_ONLY === '1' ? [] : ['mb-a-no-input-menu', 'mb-b-one-image-menu', 'mb-c-first-last-params', 'mb-d-third-image', 'mb-d-third-image-menu', 'mb-f-kling-menu', 'mb-h-image-node', 'mb-i-remove-menu', 'mb-j-model-limit']
const BOUNDARY_STATES = ['mb-k1-omni-max', 'mb-k2-switched-four', 'mb-k2-switched-five', 'mb-k2-twelve', 'mb-k2-switched-max', 'mb-k3-model-limit-max', 'mb-k4-bar-common', 'mb-k4-bar-longest', 'mb-k4-bar-longest-firstlast', 'mb-k5-menu-longest']

try {
  for (const [lang, locale] of LOCALES) {
    for (const scheme of SCHEMES) {
      const tag = `${lang}-${scheme}`
      const t = (key, values) => uiTextWith(locale, key, values)
      for (const state of SAMPLE_STATES) {
        const { page, context } = await open(state, { lang, scheme })
        const trigger = page.locator(modeTrigger(locale))
        const menu = await readMenu(page)
        const tail = (await text(page, '[data-reference-tail]')) ?? ''
        const modeText = (await trigger.count()) ? (await trigger.first().textContent())?.trim() : null

        if (state === 'mb-a-no-input-menu') {
          const card = await page.evaluate((sel) => { const el = document.querySelector(sel); if (!el) return null; const s = getComputedStyle(el); return { radius: parseFloat(s.borderTopLeftRadius), width: Math.round(el.getBoundingClientRect().width) } }, CARD)
          check(`board:ModeBar/composer.shell · ${tag}`, Boolean(card) && card.width === 560 && card.radius >= 9, JSON.stringify(card))
          check(`board:ModeBar/composer.prompt · ${tag}`, (await count(page, `${CARD} [data-prompt-box]`)) === 1)
          const add = await page.evaluate(() => [...document.querySelectorAll('[data-reference-entry], [data-reference-add-entry], [data-asset-add-tile]')].map((el) => { const r = el.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)] }))
          check(`board:ModeBar/ref.add · ${tag}`, add.length >= 2 && add.every(([w, h]) => w === 40 && h === 40), JSON.stringify(add))
          const model = await text(page, `${FOOTER} [data-bar-segment="model-params"] button`)
          check(`board:ModeBar/bar.model · ${tag}`, /Seedance 2\.5/.test(model ?? ''), String(model))
          check(`board:ModeBar/bar.mode · 没放输入写文生视频 · ${tag}`, modeText === name(locale, 'text'), String(modeText))
          // 菜单：小标题、四行、每行图标 + 说明；当前行（文生视频）打勾；带图的三种置灰、说明说要放什么
          const ok = menu && menu.heading === t('generationCommon.modeMenu.heading') && menu.rows.length === 4 && menu.rows.every((r) => r.icon && r.description) &&
            menu.rows.filter((r) => r.checked).map((r) => r.label).join() === name(locale, 'text') && menu.rows.filter((r) => r.disabled).length === 3
          check(`board:ModeBar/mode.menu · 没放输入：带图的三种置灰 · ${tag}`, Boolean(ok), JSON.stringify(menu))
          const tools = await count(page, `${FOOTER} [data-bar-segment="prompt-tools"] button`)
          check(`board:ModeBar/bar.tools · ${tag}`, tools >= 3, String(tools))
        }
        if (state === 'mb-b-one-image-menu') {
          check(`board:ModeBar/ref.tail.count · ${tag}`, tail === t('assetLibrary.refRow.count', { count: 1 }), tail)
          check(`board:ModeBar/bar.mode · 放了 1 张按全能参考 · ${tag}`, modeText === name(locale, 'reference'), String(modeText))
          const enabled = menu?.rows.filter((r) => !r.disabled).map((r) => r.label) ?? []
          check(`board:ModeBar/mode.menu · 放了 1 张：文生视频置灰，其余三种能点 · ${tag}`, enabled.length === 3 && !enabled.includes(name(locale, 'text')), JSON.stringify(menu))
        }
        if (state === 'mb-c-first-last-params') {
          // 面板里每一段按名字列出来（方式段记成 'mode'）：先要列得出参数段（探针是活的），再看里面没有方式段。
          const panel = await page.evaluate(() => {
            const el = document.querySelector('[data-agent-parameter-panel]')
            return el ? { sections: [...el.querySelectorAll('[data-agent-generation-mode], [role="radiogroup"]')].map((n) => (n.hasAttribute('data-agent-generation-mode') ? 'mode' : n.getAttribute('aria-label'))) } : null
          })
          check(`board:ModeBar/params.panel · 没有「生成方式」 · ${tag}`, Boolean(panel) && panel.sections.length > 0 && !panel.sections.includes('mode') && !panel.sections.includes(t('generationCommon.parameters.generationMode')), JSON.stringify(panel))
          check(`board:ModeBar/bar.mode · 手选首尾帧 · ${tag}`, modeText === name(locale, 'firstLast'), String(modeText))
          const labels = await page.evaluate(() => [...document.querySelectorAll('[data-asset-slot-label]')].map((el) => el.textContent?.trim()))
          check(`board:ModeBar/ref.tiles · 首尾帧两格带标签 · ${tag}`, labels.length === 2, JSON.stringify(labels))
          const params = await text(page, `${FOOTER} [data-bar-segment="model-params"] button:last-of-type`)
          check(`board:ModeBar/bar.params · ${tag}`, /5\s?s/.test(params ?? '') || (await count(page, '[data-agent-parameter-panel]')) === 1, String(params))
        }
        if (state === 'mb-d-third-image') {
          check(`board:ModeBar/ref.tail.switched · ${tag}`, tail.replace(/\s+/g, ' ') === `${t('assetLibrary.refRow.switchedTo', { count: 3 })} ${name(locale, 'reference')}`.replace(/\s+/g, ' ').trim() || (tail.startsWith(t('assetLibrary.refRow.switchedTo', { count: 3 }).trim()) && tail.endsWith(name(locale, 'reference'))), tail)
          check(`board:ModeBar/bar.mode · 放到第 3 张自动改成全能参考 · ${tag}`, modeText === name(locale, 'reference'), String(modeText))
        }
        if (state === 'mb-d-third-image-menu') {
          const firstLast = menu?.rows.find((r) => r.label === name(locale, 'firstLast'))
          check(`board:ModeBar/mode.menu · 3 张时首尾帧置灰并报数 · ${tag}`, Boolean(firstLast?.disabled) && /2/.test(firstLast?.description ?? ''), JSON.stringify(firstLast))
        }
        if (state === 'mb-f-kling-menu') {
          const labels = menu?.rows.map((r) => r.label) ?? []
          check(`board:ModeBar/mode.menu · 可灵 4.0 只列文生视频、图生视频 · ${tag}`, labels.join('|') === [name(locale, 'text'), name(locale, 'image')].join('|'), JSON.stringify(labels))
        }
        if (state === 'mb-h-image-node') {
          check(`board:ModeBar/image.tail.edit · ${tag}`, tail.includes(t('assetLibrary.refRow.count', { count: 1 })) && tail.includes(t('assetLibrary.refRow.imageEdit')), tail)
          // 底栏每个钮按无障碍名列出来：列得出钮（探针是活的），且没有一个叫「生成方式」（视频节点那几幕同一个名字找得到方式格）。
          const footerButtons = await page.evaluate((sel) => [...document.querySelectorAll(`${sel} button`)].map((b) => b.getAttribute('aria-label') ?? b.textContent?.trim() ?? ''), FOOTER)
          check(`board:ModeBar/bar.mode · 图片节点没有方式格 · ${tag}`, footerButtons.length > 0 && !footerButtons.includes(t('generationCommon.modeMenu.heading')), JSON.stringify(footerButtons))
        }
        if (state === 'mb-i-remove-menu') {
          const firstLast = menu?.rows.find((r) => r.label === name(locale, 'firstLast'))
          check(`board:ModeBar/mode.menu · 删回 2 张不跳回、首尾帧又能点 · ${tag}`, modeText === name(locale, 'reference') && firstLast && !firstLast.disabled, JSON.stringify({ modeText, firstLast }))
        }
        if (state === 'mb-j-model-limit') {
          const notSent = await page.evaluate(() => [...document.querySelectorAll('[data-reference-unused]')].map((el) => ({ text: el.textContent?.trim() ?? '', dimmed: Boolean(el.querySelector('[data-asset-tile]')) && getComputedStyle(el.querySelector('[data-asset-tile]')).opacity !== '1' })))
          check(`board:ModeBar/ref.tile.not-sent · 只变淡、格下不写字 · ${tag}`, notSent.length === 1 && notSent.every((tile) => tile.text === ''), JSON.stringify(notSent))
          check(`board:ModeBar/ref.tiles · 可灵 4.0 放 3 张：两张进首尾帧、一张淡 · ${tag}`, (await count(page, '[data-reference-row] [data-asset-tile], [data-reference-row] [data-asset-slot]')) >= 3)
          // 句里的模型名 = 底栏模型钮上写的那个（英文界面不许混进中文模型名，验收 C1）。
          const barModel = (await text(page, `${FOOTER} [data-bar-segment="model-params"] button`)) ?? ''
          check(`board:ModeBar/ref.tail.model-limit · ${tag}`, Boolean(barModel) && tail === t('assetLibrary.refRow.modelLimitOne', { model: barModel, max: 2, from: 3 }) && (lang !== 'en' || !CJK.test(tail)), JSON.stringify({ tail, barModel }))
          const send = await page.evaluate(() => { const b = document.querySelector('[data-bar-segment="generate"]'); return b ? { disabled: b.hasAttribute('disabled') || b.getAttribute('aria-disabled') === 'true' } : null })
          check(`board:ModeBar/bar.send · 放不下照样能发 · ${tag}`, Boolean(send) && !send.disabled, JSON.stringify(send))
          check(`board:ModeBar/bar.mode · 可灵 4.0 留在图生视频 · ${tag}`, modeText === name(locale, 'image'), String(modeText))
        }
        await shot(page, state, `${state}-${tag}`)
        await context.close()
      }
    }
  }

  // ── 边界（K1–K5）：放到最多的数据上判四条 + 每张样张自己的那一条。每格中 / 英各一遍，K1 再加暗色。 ──
  const boundary = []
  const BOUNDARY_RUNS = [...LOCALES.flatMap(([lang, locale]) => BOUNDARY_STATES.map((state) => ({ state, lang, locale, scheme: 'light' }))), ...LOCALES.map(([lang, locale]) => ({ state: 'mb-k1-omni-max', lang, locale, scheme: 'dark' }))]
  for (const { state, lang, locale, scheme } of BOUNDARY_RUNS) {
    const tag = `${state} ${lang}-${scheme}`
    const t = (key, values) => uiTextWith(locale, key, values)
    const { page, context } = await open(state, { lang, scheme })
    const facts = await page.evaluate(([cardSel, footerSel]) => {
      const box = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, w: Math.round(r.width), h: Math.round(r.height) } }
      const card = document.querySelector(cardSel)
      const footer = document.querySelector(footerSel)
      const scroll = document.querySelector('[data-reference-scroll]')
      const tail = document.querySelector('[data-reference-tail]')
      const block = document.querySelector('[data-reference-block]')
      // 底栏一颗一颗：模型 / 变体 / 方式 / 参数 + 右边几颗（直接可见的按钮，不含量尺）。
      const cells = footer ? [...footer.querySelectorAll('button')].filter((b) => !b.closest('[aria-hidden="true"]') && b.getBoundingClientRect().width > 0).map((b) => {
        const r = b.getBoundingClientRect()
        const spans = [...b.querySelectorAll('span')].filter((sp) => sp.getBoundingClientRect().width > 0)
        return { label: b.getAttribute('aria-label') || b.textContent?.trim() || '', text: b.textContent?.trim() ?? '', left: r.left, right: r.right, top: r.top, bottom: r.bottom, h: Math.round(r.height), title: b.getAttribute('title') ?? '', clippedTexts: spans.filter((sp) => sp.scrollWidth > sp.clientWidth + 1).map((sp) => sp.textContent?.trim() ?? ''), clipped: b.scrollWidth > b.clientWidth + 1 || spans.some((sp) => sp.scrollWidth > sp.clientWidth + 1) }
      }) : []
      const lh = tail ? parseFloat(getComputedStyle(tail).lineHeight) || 16 : 16
      const summary = footer?.querySelector('[data-parameter-summary]')
      const dropdown = [...document.querySelectorAll('[data-nomi-select-dropdown]')].find((el) => el.getBoundingClientRect().width > 0) ?? null
      const descriptions = dropdown ? [...dropdown.querySelectorAll('[data-nomi-select-option-description]')].map((d) => {
        const dlh = parseFloat(getComputedStyle(d).lineHeight) || 14
        const range = document.createRange(); range.selectNodeContents(d)
        const lines = new Map()
        for (const rect of range.getClientRects()) { if (rect.width < 1) continue; const key = Math.round(rect.top); lines.set(key, (lines.get(key) ?? 0) + rect.width) }
        const widths = [...lines.entries()].sort((a, b) => a[0] - b[0]).map(([, w]) => w)
        const fontSize = parseFloat(getComputedStyle(d).fontSize) || 11
        return { text: d.textContent?.trim() ?? '', lines: Math.round(d.getBoundingClientRect().height / dlh), truncated: d.scrollWidth > d.clientWidth + 1 || d.scrollHeight > d.clientHeight + 1 || getComputedStyle(d).textOverflow === 'ellipsis', lastLineW: Math.round(widths.at(-1) ?? 0), fontSize }
      }) : []
      return {
        card: box(card),
        scroll: scroll ? { ...box(scroll), scrollHeight: scroll.scrollHeight, clientHeight: scroll.clientHeight } : null,
        block: box(block),
        tail: tail ? { text: tail.textContent?.trim() ?? '', ...box(tail), lines: Math.round(tail.getBoundingClientRect().height / lh), inScroll: Boolean(tail.closest('[data-reference-scroll]')) } : null,
        tiles: document.querySelectorAll('[data-reference-row] [data-asset-tile]').length,
        unused: [...document.querySelectorAll('[data-reference-unused]')].map((el) => el.textContent?.trim() ?? ''),
        cells,
        footerOverflow: footer ? footer.scrollWidth > footer.clientWidth + 1 : null,
        summary: summary ? (() => {
          // 只剩时长还放不下时差多少 px：量尺最后一档（只留时长）的宽 − 槽宽。
          const slot = summary.closest('[data-parameter-summary-slot]')
          const ruler = slot?.querySelector(':scope > [aria-hidden]')
          const last = ruler?.lastElementChild instanceof HTMLElement ? ruler.lastElementChild.offsetWidth : null
          return { text: summary.getAttribute('data-parameter-summary') ?? '', title: summary.getAttribute('title') ?? '', cramped: summary.getAttribute('data-parameter-summary-cramped') === 'true', slotW: slot ? slot.clientWidth : null, shortPx: slot && last !== null ? Math.max(0, last - slot.clientWidth) : null }
        })() : null,
        menu: dropdown ? { w: Math.round(dropdown.getBoundingClientRect().width), descriptions } : null,
        viewport: { w: window.innerWidth, h: window.innerHeight },
      }
    }, [CARD, FOOTER])
    const inside = (r) => Boolean(r && facts.card) && r.left >= facts.card.left - 0.5 && r.right <= facts.card.right + 0.5 && r.top >= facts.card.top - 0.5 && r.bottom <= facts.card.bottom + 0.5
    // ① 相邻两颗不互相盖（按横向排序，后一颗的左缘不小于前一颗的右缘）。
    const sorted = [...facts.cells].sort((a, b) => a.left - b.left)
    const overlaps = sorted.slice(1).map((cell, index) => ({ a: sorted[index].label, b: cell.label, by: Math.round(sorted[index].right - cell.left) })).filter((pair) => pair.by > 0.5)
    check(`边界 · 底栏相邻不互相盖 · ${tag}`, facts.cells.length >= 4 && overlaps.length === 0, JSON.stringify(overlaps))
    // ② 没有东西出生成框：底栏每一颗、行尾那句话、图那一块都在卡片里；底栏自己不溢出。
    const outside = [...facts.cells.filter((cell) => !inside(cell)).map((cell) => cell.label), ...(facts.tail && !inside(facts.tail) ? ['tail'] : [])]
    check(`边界 · 没有东西出生成框 · ${tag}`, facts.cells.length >= 4 && outside.length === 0 && facts.footerOverflow === false, JSON.stringify({ outside, footerOverflow: facts.footerOverflow }))
    // ③ 行尾那句话、底栏每一格都只一行，不截半个值。唯一例外是让法顺序的最后一步（2026-11-12 拍板）：
    // 参数退到只剩时长还放不下时，模型名末尾省略——只许模型那一格，且 title 必须是全名。
    const modelLabel = t('generationCommon.parameters.model')
    const modelYields = (cell) => cell.label === modelLabel && Boolean(facts.summary?.cramped) && facts.summary.text.split(' · ').length === 1 && cell.title !== '' && cell.clippedTexts.length > 0 && cell.clippedTexts.every((text) => text === cell.title)
    const multi = facts.cells.filter((cell) => cell.h > 32 || (cell.clipped && !modelYields(cell))).map((cell) => `${cell.label}(${cell.h}px${cell.clipped ? '，截了' : ''})`)
    check(`边界 · 行尾和底栏每格都一行、不截 · ${tag}`, facts.cells.length >= 4 && multi.length === 0 && (!facts.tail || facts.tail.lines === 1), JSON.stringify({ multi, tailLines: facts.tail?.lines }))
    // ④ 那句话在可视区里：不在滚动口里，整句在卡片里、在视口里。
    if (facts.tail || state !== 'mb-k4-bar-longest-firstlast') {
      check(`边界 · 行尾那句话在可视区里（不跟着图滚走） · ${tag}`, Boolean(facts.tail) && !facts.tail.inScroll && inside(facts.tail) && facts.tail.bottom <= facts.viewport.h && facts.tail.top >= 0, JSON.stringify(facts.tail))
    }

    if (state === 'mb-k1-omni-max') {
      const expected = `${[t('assetLibrary.refRow.kindImage', { count: 30 }), t('assetLibrary.refRow.kindVideo', { count: 10 }), t('assetLibrary.refRow.kindAudio', { count: 10 })].join(' · ')}${t('assetLibrary.refRow.allFull')}`
      check(`board:ModeBar/ref.tail.kind-count · 按类型报数、都放满了 · ${tag}`, facts.tail?.text === expected, `${facts.tail?.text} ≠ ${expected}`)
      check(`边界 · K1 图多了在区内滚、那句话在滚动口下面 · ${tag}`, Boolean(facts.scroll) && facts.scroll.scrollHeight > facts.scroll.clientHeight + 1 && Boolean(facts.tail) && facts.tail.top >= facts.scroll.bottom - 1, JSON.stringify({ scroll: facts.scroll, tail: facts.tail }))
    }
    if (state === 'mb-k2-switched-four' || state === 'mb-k2-switched-five' || state === 'mb-k2-twelve' || state === 'mb-k2-switched-max') {
      const below = Boolean(facts.tail && facts.scroll) && facts.tail.top >= facts.scroll.bottom - 1
      const rightAligned = Boolean(facts.tail && facts.block) && Math.abs(facts.tail.right - facts.block.right) <= 1
      // 放得下一行就在行尾（同一行），放不下整句掉到下一行、靠右——两种都必须靠右、都一行。
      check(`board:ModeBar/ref.tail.count · K2 整句不折、靠右（${below ? '图下面一行' : '行尾'}） · ${tag}`, rightAligned && facts.tail.lines === 1, JSON.stringify({ tail: facts.tail, block: facts.block }))
      if (state === 'mb-k2-twelve' || state === 'mb-k2-switched-max') check(`边界 · K2 图超过一行时那句话在图下面 · ${tag}`, below, JSON.stringify({ tail: facts.tail, scroll: facts.scroll }))
    }
    if (state === 'mb-k3-model-limit-max') {
      check(`board:ModeBar/ref.tile.not-sent · K3 28 张只变淡、不逐张写字 · ${tag}`, facts.unused.length === 28 && facts.unused.every((text) => text === ''), JSON.stringify(facts.unused.slice(0, 3)))
      const barModel = (await text(page, `${FOOTER} [data-bar-segment="model-params"] button`)) ?? ''
      check(`board:ModeBar/ref.tail.model-limit · K3 其余 28 张不会发、模型名和底栏同一个 · ${tag}`, Boolean(barModel) && facts.tail?.text === t('assetLibrary.refRow.modelLimitRange', { model: barModel, max: 2, rest: 28 }) && (lang !== 'en' || !CJK.test(facts.tail?.text ?? '')), JSON.stringify({ tail: facts.tail?.text, barModel }))
    }
    if (state.startsWith('mb-k4-')) {
      const s = facts.summary
      // 摘要只能是全写的一个「整值后缀」：退掉的是前面的整值，不会出现半个值。
      const fullParts = (s?.title ?? '').split(' · ')
      const shownParts = (s?.text ?? '').split(' · ')
      const wholeSuffix = Boolean(s) && shownParts.length >= 1 && shownParts.join(' · ') === fullParts.slice(fullParts.length - shownParts.length).join(' · ')
      // 让法顺序：先参数整值退；退到只剩时长还放不下，才轮到模型名省略（cramped）。变体 / 方式 / 右边几颗永远不缩。
      const yielded = facts.cells.filter((cell) => cell.clipped)
      const orderOk = wholeSuffix && (!s.cramped || (shownParts.length === 1 && yielded.length > 0 && yielded.every(modelYields)))
      check(`board:ModeBar/bar.params · K4 参数先整值退、只剩时长才让模型名省略 · ${tag}`, orderOk, JSON.stringify({ summary: s, yielded: yielded.map((cell) => ({ label: cell.label, title: cell.title, clippedTexts: cell.clippedTexts })) }))
      if (state === 'mb-k4-bar-longest-firstlast' && lang === 'en') {
        // 协调 2026-11-12 加的一条：英文 + 有变体的模型 + 最长方式名（First & last frame）——最挤的一格。
        const model = facts.cells.find((cell) => cell.label === modelLabel)
        check(`边界 · K4 英文最挤（变体 + First & last frame）不互相盖、不出框、模型名省略时 title 是全名 · ${tag}`, overlaps.length === 0 && outside.length === 0 && facts.footerOverflow === false && Boolean(model) && (!model.clipped || modelYields(model)), JSON.stringify({ overlaps, outside, footerOverflow: facts.footerOverflow, model }))
      }
    }
    if (state === 'mb-k5-menu-longest') {
      const m = facts.menu
      const bad = (m?.descriptions ?? []).filter((d) => d.lines > 2 || d.truncated || (d.lines === 2 && d.lastLineW < d.fontSize * 1.8))
      check(`board:ModeBar/mode.menu · K5 菜单最宽 340、说明最多两行、不截、不留单个字 · ${tag}`, Boolean(m) && m.w <= 340 && m.descriptions.length >= 2 && bad.length === 0, JSON.stringify({ w: m?.w, bad }))
    }
    boundary.push({ state, lang, scheme, tail: facts.tail, scroll: facts.scroll, summary: facts.summary, cells: facts.cells.map((cell) => ({ label: cell.label, text: cell.text, w: Math.round(cell.right - cell.left) })), menu: facts.menu })
    await shot(page, state, `${state}-${lang}-${scheme}`)
    await context.close()
  }
  if (WITH_EVIDENCE) fs.writeFileSync(path.join(EVIDENCE_DIR, 'boundary.json'), `${JSON.stringify(boundary, null, 2)}\n`)

  if (pageErrors.length) failures.push(`页面抛错 ${pageErrors.length} 条：${pageErrors.slice(0, 3).join(' | ')}`)
} finally {
  await browser.close()
  vite.kill('SIGTERM')
}

console.log(`\n通过 ${passed.length} 条${failures.length ? `，失败 ${failures.length} 条` : ''}`)
if (failures.length) {
  console.error(failures.map((f) => `  ✗ ${f}`).join('\n'))
  process.exit(1)
}
