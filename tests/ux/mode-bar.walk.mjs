// 底栏「模型｜方式｜参数」走查（2026-11-12 样张 A–J，清单 docs/design/boards/2026-11-12-mode-bar/ModeBar.board.json）。
//
// 一格 = 实验室里现役 `BaseGenerationNode` + `NodeGenerationComposer`（states/03-mode-bar.tsx）。方式格、方式菜单、
// 行尾那句话都是生产组件按唯一 owner modeForInputs 现算的；这里对每个拍板元素量一条用户看得见的事实，
// 断言名 `board:ModeBar/<元素 id>` 与清单一一对应。每格中 / 英 × 明 / 暗各截一张，证据进 docs/evidence/2026-11-12-mode-bar/。
//
// 用法：node tests/ux/mode-bar.walk.mjs        （EVIDENCE=0 只跑断言不截图）
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
  await page.locator(`[data-design-lab-shot="${state}"]`).screenshot({ path: path.join(EVIDENCE_DIR, `${file}.png`), animations: 'disabled' })
}

const SAMPLE_STATES = ['mb-a-no-input-menu', 'mb-b-one-image-menu', 'mb-c-first-last-params', 'mb-d-third-image', 'mb-d-third-image-menu', 'mb-f-kling-menu', 'mb-h-image-node', 'mb-i-remove-menu', 'mb-j-model-limit']

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
          const panel = await page.evaluate(() => {
            const el = document.querySelector('[data-agent-parameter-panel]')
            return el ? { mode: el.querySelectorAll('[data-agent-generation-mode]').length, titles: [...el.querySelectorAll('[data-parameter-group-title], h3, h4')].map((h) => h.textContent?.trim()) } : null
          })
          check(`board:ModeBar/params.panel · 没有「生成方式」 · ${tag}`, Boolean(panel) && panel.mode === 0 && !panel.titles.includes(t('generationCommon.parameters.generationMode')), JSON.stringify(panel))
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
          check(`board:ModeBar/bar.mode · 图片节点没有方式格 · ${tag}`, (await trigger.count()) === 0)
        }
        if (state === 'mb-i-remove-menu') {
          const firstLast = menu?.rows.find((r) => r.label === name(locale, 'firstLast'))
          check(`board:ModeBar/mode.menu · 删回 2 张不跳回、首尾帧又能点 · ${tag}`, modeText === name(locale, 'reference') && firstLast && !firstLast.disabled, JSON.stringify({ modeText, firstLast }))
        }
        if (state === 'mb-j-model-limit') {
          const notSent = await page.evaluate(() => [...document.querySelectorAll('[data-reference-unused]')].map((el) => ({ text: el.textContent?.trim() ?? '', dimmed: Boolean(el.querySelector('[data-asset-tile]')) && getComputedStyle(el.querySelector('[data-asset-tile]')).opacity !== '1' })))
          check(`board:ModeBar/ref.tile.not-sent · 变淡 · ${tag}`, notSent.length === 1 && notSent.every((tile) => tile.dimmed), JSON.stringify(notSent))
          check(`board:ModeBar/ref.tiles · 可灵 4.0 放 3 张：两张进首尾帧、一张淡 · ${tag}`, (await count(page, '[data-reference-row] [data-asset-tile], [data-reference-row] [data-asset-slot]')) >= 3)
          check(`board:ModeBar/ref.tail.model-limit · ${tag}`, tail === t('assetLibrary.refRow.modelLimitOne', { model: '可灵 4.0', max: 2, from: 3 }), tail)
          const send = await page.evaluate(() => { const b = document.querySelector('[data-bar-segment="generate"]'); return b ? { disabled: b.hasAttribute('disabled') || b.getAttribute('aria-disabled') === 'true' } : null })
          check(`board:ModeBar/bar.send · 放不下照样能发 · ${tag}`, Boolean(send) && !send.disabled, JSON.stringify(send))
          check(`board:ModeBar/bar.mode · 可灵 4.0 留在图生视频 · ${tag}`, modeText === name(locale, 'image'), String(modeText))
        }
        await shot(page, state, `${state}-${tag}`)
        await context.close()
      }
    }
  }

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
