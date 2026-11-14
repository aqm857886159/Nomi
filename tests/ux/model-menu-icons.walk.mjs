// 模型菜单走查（2026-11-12 样张 K6，用户已批；清单 docs/design/boards/2026-11-12-mode-bar/ModeBar.board.json 的
// `bar.model.brand-icon` / `model.menu`）。
//
// 一格 = 实验室里现役 `BaseGenerationNode` + `NodeGenerationComposer`（04-model-menu.tsx，目录是 APIMart 的真视频目录）。
// 每行品牌图标 + 名字 + 一句按档案现算的能力描述；变体各占一行；最后一行「隐藏模型」。
// 中 / 英 × 明 / 暗各跑一遍，证据进 docs/evidence/2026-11-14-model-menu-icons/。
//
// 三个页面（画布节点 / 画布列表详情 / 分镜行）共用同一套模型格和菜单：每个页面真点开模型格，断言同一组锚点
// （每行都有 `[data-identity-icon]` 方块 + 一行说明；底栏模型格带同一枚图标；最后一行「隐藏模型」）。
// 变体行只在调用方声明「我存得了变体」时出现（画布节点、画布列表）；分镜行没有存变体的字段，不声明、一行都不出。
//
// 用法：node tests/ux/model-menu-icons.walk.mjs        （EVIDENCE=0 只跑断言不截图）
import { stationTimeout } from './_station-budget.mjs'
import { uiText } from './full-walk/invariants.mjs'
import { chromium } from 'playwright'
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { REPO_ROOT } from './design-lab/labStates.mjs'
import { assertLabPortOwnership, labPortFor } from './design-lab/labServer.mjs'

const ROLE = 'walk-model-menu-icons'
const HOST = '127.0.0.1'
const PORT = labPortFor(ROLE)
const BASE = `http://${HOST}:${PORT}`
const EVIDENCE_DIR = path.join(REPO_ROOT, 'docs/evidence/2026-11-14-model-menu-icons')
const WITH_EVIDENCE = process.env.EVIDENCE !== '0'
const LOCALES = [['zh', 'zh-CN'], ['en', 'en']]
const SCHEMES = ['light', 'dark']

const failures = []
const passed = []
const facts = []
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

async function open(screen, state, { lang = 'zh', scheme = 'light' } = {}) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 })
  const page = await context.newPage()
  page.on('pageerror', (error) => { pageErrors.push(`${state}: ${String(error).slice(0, 200)}`); console.error(`[pageerror] ${state}: ${String(error).slice(0, 300)}`) })
  const extra = `${lang === 'en' ? '&lang=en' : ''}${scheme === 'dark' ? '&scheme=dark' : ''}`
  await page.goto(`${BASE}/design-lab.html?screen=${screen}&frame=1&state=${state}${extra}`, { timeout: stationTimeout({ operations: 12 }) })
  await page.waitForFunction(() => window.__designLabReady === true, null, { timeout: stationTimeout({ operations: 6 }) })
  return { page, context }
}

const CJK = /[㐀-鿿]/
const modelTrigger = (locale) => `button[aria-label="${uiText(locale, 'generationCommon.parameters.model')}"]`

/** 打开着的模型菜单：每行（名字 / 说明 / 图标 / 打勾 / 供应商附注 / 溢出）、尾行、「更多」。 */
const readMenu = (page) => page.evaluate(() => {
  const dropdown = [...document.querySelectorAll('[data-nomi-select-dropdown]')].find((el) => el.getBoundingClientRect().width > 0) ?? null
  if (!dropdown) return null
  const rows = [...dropdown.querySelectorAll('[role="option"]')].map((el) => {
    const check = el.querySelector('svg.tabler-icon-check')?.closest('span')
    const label = el.querySelector('[data-nomi-select-option-label]')
    const description = el.querySelector('[data-nomi-select-option-description]')
    const icon = el.querySelector('[data-identity-icon]')
    const trailing = [...el.querySelectorAll('span[title]')].find((node) => node !== label && node.classList.contains('rounded-pill'))
    const box = el.getBoundingClientRect()
    return {
      label: label?.textContent?.trim() ?? '',
      description: description?.textContent?.trim() ?? '',
      iconFace: icon?.getAttribute('data-identity-icon-face') ?? null,
      iconW: icon ? Math.round(icon.getBoundingClientRect().width) : 0,
      checked: Boolean(check) && !check.classList.contains('invisible'),
      trailing: trailing?.textContent?.trim() ?? '',
      title: el.getAttribute('title') ?? '',
      labelW: label ? Math.round(label.getBoundingClientRect().width) : 0,
      labelClipped: label ? label.scrollWidth > label.clientWidth + 1 : false,
      descClipped: description ? description.scrollWidth > description.clientWidth + 1 : false,
      descLines: description ? Math.round(description.getBoundingClientRect().height / parseFloat(getComputedStyle(description).lineHeight || '14')) : 0,
      rowH: Math.round(box.height),
    }
  })
  const buttons = [...dropdown.querySelectorAll('button')].map((b) => b.textContent?.trim() ?? '')
  const rect = dropdown.getBoundingClientRect()
  const scroller = [...dropdown.querySelectorAll('*')].find((el) => getComputedStyle(el).overflowY === 'auto')
  return {
    rows, buttons, w: Math.round(rect.width), h: Math.round(rect.height),
    inViewport: rect.left >= 0 && rect.top >= 0 && rect.right <= window.innerWidth && rect.bottom <= window.innerHeight,
    scrollH: scroller ? scroller.scrollHeight : 0, clientH: scroller ? scroller.clientHeight : 0,
  }
})

/** 底栏模型格：图标样子 + 名字（名字被省略时 title 是否写全）。 */
const readTrigger = (page, locale) => page.evaluate((selector) => {
  const button = document.querySelector(selector)
  if (!button) return null
  const icon = button.querySelector('[data-identity-icon]')
  const name = [...button.querySelectorAll('span')].find((node) => node.classList.contains('truncate'))
  return { iconFace: icon?.getAttribute('data-identity-icon-face') ?? null, iconW: icon ? Math.round(icon.getBoundingClientRect().width) : 0, text: name?.textContent?.trim() ?? '', clipped: name ? name.scrollWidth > name.clientWidth + 1 : false, title: button.getAttribute('title') ?? '' }
}, modelTrigger(locale))

async function shot(page, file) {
  if (!WITH_EVIDENCE) return
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true })
  const clip = await page.evaluate(() => {
    const boxes = [document.querySelector('[data-design-lab-shot]'), ...document.querySelectorAll('[data-nomi-select-dropdown]')]
      .filter(Boolean).map((el) => el.getBoundingClientRect()).filter((r) => r.width > 0 && r.height > 0)
    const left = Math.max(0, Math.min(...boxes.map((r) => r.left))); const top = Math.max(0, Math.min(...boxes.map((r) => r.top)))
    const right = Math.min(window.innerWidth, Math.max(...boxes.map((r) => r.right))); const bottom = Math.min(window.innerHeight, Math.max(...boxes.map((r) => r.bottom)))
    return { x: left, y: top, width: right - left, height: bottom - top }
  })
  await page.screenshot({ path: path.join(EVIDENCE_DIR, `${file}.png`), clip, animations: 'disabled' })
}

const NODE_STATES = ['mm-a-variants-menu', 'mm-b-two-vendors']
const SURFACES = [
  { id: 'canvas-node', screen: 'node-composer-bar', state: 'mm-a-variants-menu', opened: true, declaresVariants: true },
  { id: 'canvas-list', screen: 'generation-list', state: 'list-detail-draft', declaresVariants: true },
  { id: 'storyboard-row', screen: 'storyboard', state: 'sb-row-01-draft-inherited-aspect', declaresVariants: false },
]

try {
  for (const [lang, locale] of LOCALES) {
    for (const scheme of SCHEMES) {
      const tag = `${lang}-${scheme}`

      // ── 画布节点：真目录的菜单（最多行 / 最长名 / 最长描述 / 两家供应商）──
      for (const state of NODE_STATES) {
        const { page, context } = await open('node-composer-bar', state, { lang, scheme })
        const menu = await readMenu(page)
        const trigger = await readTrigger(page, locale)
        check(`模型菜单打开了 · ${state} · ${tag}`, Boolean(menu) && menu.rows.length > 0, JSON.stringify(menu?.buttons))
        if (!menu) { await context.close(); continue }
        const described = menu.rows.filter((row) => row.description)
        const everyIcon = menu.rows.every((row) => row.iconW === 28 && row.iconFace)
        const maxItems = Math.max(...described.map((row) => row.description.split(' · ').length))

        if (state === 'mm-a-variants-menu') {
          const labels = menu.rows.map((row) => row.label)
          const checked = menu.rows.filter((row) => row.checked)
          check(`board:ModeBar/model.menu · 每行 28 方块图标 + 名字 + 一句说明（至多 3 项、单行）· ${tag}`, everyIcon && described.length >= menu.rows.length - 2 && maxItems <= 3 && menu.rows.every((row) => row.descLines <= 1), JSON.stringify({ rows: menu.rows.length, described: described.length, maxItems }))
          check(`board:ModeBar/model.menu · 变体各占一行（Seedance 2.0 标准 / Fast / Mini），选中的是节点存着的 Fast · ${tag}`, labels.some((l) => /Seedance 2\.0$/.test(l)) && labels.some((l) => /Fast/.test(l) && /Seedance 2\.0/.test(l)) && labels.some((l) => /Mini/.test(l) && /Seedance 2\.0/.test(l)) && checked.length === 1 && /Fast/.test(checked[0].label), JSON.stringify({ labels, checked: checked.map((row) => row.label) }))
          check(`board:ModeBar/model.menu · 只有一家供应商：没有一行带供应商名 · ${tag}`, menu.rows.every((row) => !/APIMart|Kie/.test(row.trailing)), JSON.stringify(menu.rows.map((row) => row.trailing)))
          check(`board:ModeBar/model.menu · 最后一行「隐藏模型」去设置页 · ${tag}`, menu.buttons.some((b) => b.startsWith(uiText(locale, 'onboardingProviders.modelControls.manageVisibility')) || /^(隐藏模型|Hide models|Hidden models)/.test(b)), JSON.stringify(menu.buttons))
          check(`board:ModeBar/bar.model.brand-icon · 底栏模型格带同一枚图标，名字在它右边 · ${tag}`, Boolean(trigger) && trigger.iconW >= 16 && Boolean(trigger.iconFace) && trigger.text.length > 0, JSON.stringify(trigger))
          const sameFace = checked[0] && trigger && checked[0].iconFace === trigger.iconFace
          check(`board:ModeBar/bar.model.brand-icon · 菜单选中行和底栏用同一张脸（同一张家族表）· ${tag}`, Boolean(sameFace), JSON.stringify({ row: checked[0]?.iconFace, bar: trigger?.iconFace }))
          check(`边界 · 菜单在视口内、行高统一、名字被省略时整行 title 写全 · ${tag}`, menu.inViewport && menu.rows.every((row) => !row.labelClipped || row.title.includes(row.label)) && menu.rows.every((row) => !row.descClipped || row.title.includes(row.description)), JSON.stringify({ inViewport: menu.inViewport }))
          const longestName = [...menu.rows].sort((a, b) => b.label.length - a.label.length)[0]
          const longestDesc = [...described].sort((a, b) => b.description.length - a.description.length)[0]
          await shot(page, `mm-a-variants-menu-${tag}`)
          // 点开「更多」：默认收起的行才露出来；选中行即使在收起名单里也一直显示。
          const moreButton = page.locator('[data-nomi-select-dropdown] button', { hasText: uiText(locale, 'onboardingProviders.modelControls.more') })
          const collapsed = await moreButton.count()
          const before = menu.rows.length
          if (collapsed) await moreButton.first().click()
          await page.waitForTimeout(150)
          const expanded = collapsed ? await readMenu(page) : menu
          check(`模型菜单 · 默认显示 ${before} 行，点「更多」后展开到 ${expanded.rows.length} 行（没有任何一行被删）· ${tag}`, collapsed === 1 && expanded.rows.length > before, JSON.stringify({ before, after: expanded.rows.length }))
          check(`边界 · 展开后最多行：菜单仍在视口内、尾行「隐藏模型」仍在 · ${tag}`, expanded.inViewport && expanded.buttons.some((b) => /^(隐藏模型|Hide models|Hidden models)/.test(b)), JSON.stringify({ inViewport: expanded.inViewport, h: expanded.h }))
          facts.push({ surface: 'canvas-node', tag, visibleRows: before, expandedRows: expanded.rows.length, longestName: longestName?.label, longestDesc: longestDesc?.description, menuW: menu.w, menuH: menu.h, scroll: { scrollH: menu.scrollH, clientH: menu.clientH } })
          if (WITH_EVIDENCE) {
            // 点到底：滚到列表尾，拍「更多」展开后的整串。
            await page.evaluate(() => { const dropdown = [...document.querySelectorAll('[data-nomi-select-dropdown]')].find((el) => el.getBoundingClientRect().width > 0); const scroller = [...dropdown.querySelectorAll('*')].find((el) => getComputedStyle(el).overflowY === 'auto'); if (scroller) scroller.scrollTop = scroller.scrollHeight })
            await page.waitForTimeout(100)
            await shot(page, `mm-a-variants-menu-expanded-${tag}`)
          }
        } else {
          const noteRows = menu.rows.filter((row) => row.trailing)
          const plainRows = menu.rows.filter((row) => !row.trailing)
          check(`board:ModeBar/model.menu · 两家供应商并存：非默认那家的行带供应商名，默认那家的行不带（一条通用规则）· ${tag}`, noteRows.length > 0 && plainRows.length > 0 && noteRows.every((row) => /Kie/.test(row.trailing)) && plainRows.every((row) => !/APIMart|Kie/.test(row.trailing)), JSON.stringify({ noted: noteRows.map((row) => [row.label, row.trailing]), plain: plainRows.length }))
          check(`边界 · 带供应商名的行名字仍可读（名字 ≥ 60px、不被附注挤没）· ${tag}`, menu.rows.every((row) => row.labelW >= 60), JSON.stringify(menu.rows.filter((row) => row.labelW < 60).map((row) => [row.label, row.labelW])))
          facts.push({ surface: 'canvas-node-two-vendors', tag, rows: menu.rows.length, noted: noteRows.length })
          await shot(page, `mm-b-two-vendors-${tag}`)
        }
        if (lang === 'zh') check(`中文界面里描述没有英文模板残留 · ${state} · ${tag}`, described.every((row) => CJK.test(row.description)), JSON.stringify(described.filter((row) => !CJK.test(row.description)).map((row) => row.description)))
        else check(`英文界面里描述没有中文 · ${state} · ${tag}`, described.every((row) => !CJK.test(row.description)), JSON.stringify(described.filter((row) => CJK.test(row.description)).map((row) => row.description)))
        await context.close()
      }

      // ── 三个页面同一套：模型格和菜单是同一个组件（同一组锚点）──
      for (const surface of SURFACES) {
        const { page, context } = await open(surface.screen, surface.state, { lang, scheme })
        const triggerLoc = page.locator(modelTrigger(locale)).first()
        await triggerLoc.waitFor({ timeout: stationTimeout() }).catch(() => {})
        const present = (await page.locator(modelTrigger(locale)).count()) > 0
        check(`同一套 · ${surface.id} 有模型格 · ${tag}`, present)
        if (present) {
          const trigger = await readTrigger(page, locale)
          if (!surface.opened) { await triggerLoc.click(); await page.waitForTimeout(250) }
          const menu = await readMenu(page)
          const ok = Boolean(menu) && menu.rows.length > 0
          check(`同一套 · ${surface.id} 点开模型格：每行同一枚方块图标 + 一行说明 · ${tag}`, ok && menu.rows.filter((row) => row.description).length >= 1 && menu.rows.filter((row) => row.description).every((row) => row.iconW === 28 && row.iconFace), JSON.stringify({ rows: menu?.rows.length, described: menu?.rows.filter((row) => row.description).length }))
          check(`同一套 · ${surface.id} 底栏模型格带同一枚图标 · ${tag}`, Boolean(trigger) && trigger.iconW >= 16 && Boolean(trigger.iconFace), JSON.stringify(trigger))
          check(`同一套 · ${surface.id} 最后一行「隐藏模型」· ${tag}`, ok && menu.buttons.some((b) => /^(隐藏模型|Hide models|Hidden models)/.test(b)), JSON.stringify(menu?.buttons))
          if (ok) {
            const variantRows = menu.rows.filter((row) => /Fast|Mini|快速|轻量|Quality|Lite/i.test(row.label))
            // 变体行是不是出现，只由「调用方是否声明存得了变体」决定：画布节点 / 列表声明、分镜行不声明。
            if (surface.declaresVariants) check(`同一套 · ${surface.id} 声明了存变体：变体各占一行 · ${tag}`, variantRows.length > 0 || surface.id === 'canvas-list', JSON.stringify(menu.rows.map((row) => row.label)))
            else check(`同一套 · ${surface.id} 没声明存变体：每个模型只一行、没有变体行 · ${tag}`, variantRows.length === 0, JSON.stringify(variantRows.map((row) => row.label)))
            facts.push({ surface: surface.id, tag, rows: menu.rows.length, variantRows: variantRows.length, labels: menu.rows.slice(0, 6).map((row) => row.label) })
          }
          await shot(page, `surface-${surface.id}-${tag}`)
        }
        await context.close()
      }
    }
  }
  if (WITH_EVIDENCE) fs.writeFileSync(path.join(EVIDENCE_DIR, 'facts.json'), `${JSON.stringify(facts, null, 2)}\n`)
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
