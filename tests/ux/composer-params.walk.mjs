// 参数面板 / 底栏「高级设置」/ 名字旁说明走查（2026-11-14 拍板图 ComposerParams 第二排，清单
// docs/design/boards/2026-11-14-composer-params/ComposerParams.board.json）。
//
// 一格 = 实验室里现役 `BaseGenerationNode` + `NodeGenerationComposer`（states/05-composer-params.tsx），
// 对每个拍板元素量一条用户看得见的事实，断言名 `board:ComposerParams/<元素 id>` 与清单一一对应。
// 每格中文明色 + 英文暗色各截一张，证据进 docs/evidence/2026-11-14-composer-params/。
//
// 后面三段：
//   ② 最小窗口 700×720：方式菜单（Seedance 2.5 六行带说明）整个露出或在菜单里滚、不出窗口；7 项面板不出窗口。
//   ③ 分镜行 / 参考卡：底栏和画布是同一只组件（同一个底栏、同一颗生成钮）。
//   ④ 全目录矩阵：全部档案 × 方式 × 中英文，参数取最长值，数「三个值都在 / 只剩时长 / 模型名省略 / 出问题」。
//
// 用法：node tests/ux/composer-params.walk.mjs   （EVIDENCE=0 只跑断言不截图；MATRIX=0 跳过矩阵）
import { stationTimeout } from './_station-budget.mjs'
import { expectAbsent, proveProbe } from './_assert.mjs'
import { NODE_COMPOSER_WIDTH } from './_composerWidth.mjs'
import { uiText, uiTextWith } from './full-walk/invariants.mjs'
import { chromium } from 'playwright'
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { REPO_ROOT } from './design-lab/labStates.mjs'
import { assertLabPortOwnership, labPortFor } from './design-lab/labServer.mjs'

const ROLE = 'walk-composer-params'
const HOST = '127.0.0.1'
const PORT = labPortFor(ROLE)
const BASE = `http://${HOST}:${PORT}`
const SCREEN = 'node-composer-bar'
const EVIDENCE_DIR = path.join(REPO_ROOT, 'docs/evidence/2026-11-14-composer-params')
const WITH_EVIDENCE = process.env.EVIDENCE !== '0'
const WITH_MATRIX = process.env.MATRIX !== '0'
const RUNS = [{ lang: 'zh', locale: 'zh-CN', scheme: 'light' }, { lang: 'en', locale: 'en', scheme: 'dark' }]

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

async function open(state, { lang = 'zh', scheme = 'light', screen = SCREEN, viewport = { width: 1440, height: 1000 } } = {}) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 2 })
  const page = await context.newPage()
  page.on('pageerror', (error) => pageErrors.push(`${state}: ${String(error).slice(0, 200)}`))
  const extra = `${lang === 'en' ? '&lang=en' : ''}${scheme === 'dark' ? '&scheme=dark' : ''}`
  await page.goto(`${BASE}/design-lab.html?screen=${screen}&frame=1&state=${state}${extra}`, { timeout: stationTimeout({ operations: 12 }) })
  await page.waitForFunction(() => window.__designLabReady === true, null, { timeout: stationTimeout({ operations: 6 }) })
  return { page, context }
}

const CARD = '.generation-canvas-v2-node__composer-card'
const FOOTER = `${CARD} [data-node-composer-footer]`
const PANEL = '[data-agent-parameter-panel]'

async function shot(page, file, { full = false } = {}) {
  if (!WITH_EVIDENCE) return
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true })
  if (full) { await page.screenshot({ path: path.join(EVIDENCE_DIR, `${file}.png`), animations: 'disabled' }); return }
  // 拍的范围 = 样张框 ∪ 参数面板 ∪ 打开着的下拉 ∪ 说明浮层（都可能伸出样张框）。
  const clip = await page.evaluate(() => {
    const boxes = [document.querySelector('[data-design-lab-shot]'), document.querySelector('[data-agent-parameter-panel]'), ...document.querySelectorAll('[data-nomi-select-dropdown]')]
      .filter(Boolean).map((el) => el.getBoundingClientRect()).filter((r) => r.width > 0 && r.height > 0)
    const left = Math.max(0, Math.min(...boxes.map((r) => r.left))); const top = Math.max(0, Math.min(...boxes.map((r) => r.top)))
    const right = Math.min(window.innerWidth, Math.max(...boxes.map((r) => r.right))); const bottom = Math.min(window.innerHeight, Math.max(...boxes.map((r) => r.bottom)))
    return { x: left, y: top, width: right - left, height: bottom - top }
  })
  await page.screenshot({ path: path.join(EVIDENCE_DIR, `${file}.png`), clip, animations: 'disabled' })
}

/** 底栏、参数面板、高级设置的可见事实（一次读完）。 */
const readFacts = (page) => page.evaluate(([cardSel, footerSel, panelSel]) => {
  const box = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, w: Math.round(r.width), h: Math.round(r.height) } }
  const card = document.querySelector(cardSel)
  const footer = document.querySelector(footerSel)
  const panel = document.querySelector(panelSel)
  const scroller = panel?.firstElementChild ?? null
  const advanced = document.querySelector('[data-advanced-settings]')
  const toggle = document.querySelector('[data-advanced-settings-toggle]')
  const summary = footer?.querySelector('[data-parameter-summary]')
  const modelButton = footer?.querySelector('[data-bar-segment="model-params"] button')
  const panelRows = scroller ? [...scroller.children].filter((el) => !el.hasAttribute('data-agent-generation-mode') && !el.hasAttribute('data-parameter-panel-footer')) : []
  return {
    card: box(card),
    cardWidth: card ? Math.round(card.getBoundingClientRect().width) : null,
    prompt: document.querySelectorAll(`${cardSel} [data-prompt-box]`).length,
    refEntries: document.querySelectorAll(`${cardSel} [data-reference-entry], ${cardSel} [data-reference-add-entry], ${cardSel} [data-asset-add-tile]`).length,
    model: modelButton?.textContent?.trim() ?? null,
    footer: box(footer),
    footerOverflow: footer ? footer.scrollWidth > footer.clientWidth + 1 : null,
    tools: footer?.querySelectorAll('[data-bar-segment="prompt-tools"] button:not([data-advanced-settings-toggle])').length ?? 0,
    send: footer?.querySelectorAll('[data-bar-segment="generate"]').length ?? 0,
    summary: summary ? { text: summary.getAttribute('data-parameter-summary') ?? '', title: summary.getAttribute('title') ?? '', cramped: summary.getAttribute('data-parameter-summary-cramped') === 'true' } : null,
    toggle: toggle ? { label: toggle.getAttribute('aria-label') ?? '', changed: toggle.getAttribute('data-advanced-settings-changed') === 'true', inFooter: Boolean(toggle.closest('[data-node-composer-footer]')) } : null,
    advanced: advanced ? { ...box(advanced), rows: [...advanced.querySelectorAll('[data-advanced-setting]')].map((el) => el.getAttribute('data-advanced-setting')), marks: [...advanced.querySelectorAll('[data-parameter-help]')].map((el) => el.getAttribute('aria-label') ?? '') } : null,
    panel: panel ? { ...box(panel), rows: panelRows.length, keys: [...panel.querySelectorAll('[data-agent-parameter-control]')].map((el) => el.getAttribute('data-agent-parameter-control')), scrolls: scroller ? scroller.scrollHeight > scroller.clientHeight + 1 : null, text: panel.textContent ?? '' } : null,
    capped: [...document.querySelectorAll('[data-option-group-capped]')].map((el) => ({ h: Math.round(el.clientHeight), sh: el.scrollHeight, row: Math.round(el.querySelector('button, [role="radio"]')?.getBoundingClientRect().height ?? 0) })),
    viewport: { w: window.innerWidth, h: window.innerHeight },
  }
}, [CARD, FOOTER, PANEL])

const SAMPLES = ['cp-t-panel-flat', 'cp-t2-advanced-open', 'cp-t3-advanced-changed', 'cp-t8-both-open', 'cp-u-image-model', 'cp-u2-max-main', 'cp-u3-single-advanced', 'cp-l-options-56', 'cp-q-longest-label', 'cp-solo-panel']
const ADVANCED_KEYS = new Set(['seed', 'watermark', 'output_format', 'nsfw_check', 'return_last_frame'])
const report = { samples: [], narrow: [], storyboard: [], matrix: null }

try {
  // ── ① 拍板格 ──
  for (const { lang, locale, scheme } of RUNS) {
    const tag = `${lang}-${scheme}`
    const t = (key, values) => uiTextWith(locale, key, values)
    for (const state of SAMPLES) {
      const { page, context } = await open(state, { lang, scheme })
      const f = await readFacts(page)
      report.samples.push({ state, lang, scheme, summary: f.summary, panelRows: f.panel?.rows ?? null, panelKeys: f.panel?.keys, advanced: f.advanced?.rows ?? null, toggle: f.toggle, capped: f.capped })
      if (state === 'cp-t-panel-flat') {
        check(`board:ComposerParams/composer.shell · 生成框宽 ${NODE_COMPOSER_WIDTH} · ${tag}`, f.cardWidth === NODE_COMPOSER_WIDTH, String(f.cardWidth))
        check(`board:ComposerParams/composer.prompt · ${tag}`, f.prompt === 1)
        check(`board:ComposerParams/composer.refs · 点选 + 添加两颗 · ${tag}`, f.refEntries >= 2, String(f.refEntries))
        check(`board:ComposerParams/bar.model · ${tag}`, /Seedance 2\.5/.test(f.model ?? ''), String(f.model))
        const modeText = (await page.evaluate((label) => document.querySelector(`[data-node-composer-footer] button[aria-label="${label}"]`)?.textContent?.trim() ?? null, t('generationCommon.modeMenu.heading')))
        check(`board:ComposerParams/bar.mode · 没放输入写文生视频 · ${tag}`, modeText === t('generationCommon.modeMenu.name.text'), String(modeText))
        // 600 宽：中文三个值都在（560 时差 6 像素会少比例）；英文按便签 T5「720p · 5s」和今天一样，至少两个值。
        const parts = (f.summary?.text ?? '').split(' · ').filter(Boolean)
        check(`board:ComposerParams/bar.params · 600 宽中文三个值都在、英文至少两个 · ${tag}`, Boolean(f.summary) && !f.summary.cramped && parts.length >= (lang === 'zh' ? 3 : 2), JSON.stringify(f.summary))
        check(`board:ComposerParams/bar.tools · 提示词三颗 · ${tag}`, f.tools === 3, String(f.tools))
        check(`board:ComposerParams/bar.send · ${tag}`, f.send === 1, String(f.send))
        check(`board:ComposerParams/bar.advanced · 底栏里、读屏名「高级设置」、没改动时不带点 · ${tag}`, Boolean(f.toggle) && f.toggle.inFooter && f.toggle.label === t('generationCommon.parameters.advanced') && !f.toggle.changed, JSON.stringify(f.toggle))
        check(`board:ComposerParams/params.panel · 全摊开（4 项、不滚、没有五类）· ${tag}`, Boolean(f.panel) && f.panel.rows === 4 && f.panel.scrolls === false && !(f.panel.keys ?? []).some((key) => ADVANCED_KEYS.has(key)), JSON.stringify(f.panel && { rows: f.panel.rows, keys: f.panel.keys, scrolls: f.panel.scrolls }))
        check(`边界 · 底栏不溢出 · ${state} ${tag}`, f.footerOverflow === false)
      }
      if (state === 'cp-t2-advanced-open') {
        const want = ['return_last_frame', 'seed', 'watermark', 'output_format', 'nsfw_check']
        check(`board:ComposerParams/advanced.section · 五项都在、在底栏下面 · ${tag}`, Boolean(f.advanced) && want.every((key) => f.advanced.rows.includes(key)) && f.advanced.rows.length === 5 && f.advanced.top >= f.footer.bottom - 1, JSON.stringify({ rows: f.advanced?.rows, top: f.advanced?.top, footerBottom: f.footer?.bottom }))
        const names = [t('generationCommon.parameters.help.markLabel', { name: '' })]
        check(`board:ComposerParams/help.mark · 三个 ⓘ、读屏名「…是什么」 · ${tag}`, (f.advanced?.marks ?? []).length === 3 && f.advanced.marks.every((label) => label.includes(names[0].trim()) || label.endsWith(lang === 'zh' ? '是什么' : 'what is it')), JSON.stringify(f.advanced?.marks))
        // 悬停第一个 ⓘ：说明出在名字下面（不是弹窗），话是那条说明。
        const mark = page.locator('[data-parameter-help]').first()
        await mark.hover()
        // Radix 在说明里另放一份给读屏的隐藏副本（role=tooltip），读字时去掉它，只读看得见的那份。
        const help = await page.waitForFunction(() => {
          const el = document.querySelector('[data-parameter-help-text]')
          if (!el || el.getBoundingClientRect().height <= 0) return null
          const copy = el.cloneNode(true)
          copy.querySelectorAll('[role="tooltip"]').forEach((hidden) => hidden.remove())
          return copy.textContent?.trim() ?? null
        }, null, { timeout: 4000 }).then((h) => h.jsonValue()).catch(() => null)
        const texts = ['seed', 'returnLastFrame', 'moderation'].map((key) => t(`generationCommon.parameters.help.${key}`))
        check(`board:ComposerParams/help.text · 悬停出说明 · ${tag}`, texts.includes(help ?? ''), String(help))
        await shot(page, `cp-t4-help-open-${lang}-${scheme}`)
        // 移开鼠标、等说明收起，再拍 T2 本格（不然 T2 的图里会带着 T4 的说明）。
        // 分几步移：Radix 离开按钮后要再收到一次「在说明框外」的移动才收起，一步跳过去只有一次移动事件（真鼠标是连续的）。
        await page.mouse.move(5, 5, { steps: 8 })
        await page.waitForFunction(() => !document.querySelector('[data-parameter-help-text]'), null, { timeout: stationTimeout({ operations: 1 }) }).then(() => true).catch(() => false)
          .then((closed) => check(`board:ComposerParams/help.text · 鼠标移开说明收起 · ${tag}`, closed))
      }
      if (state === 'cp-t3-advanced-changed') check(`board:ComposerParams/bar.advanced · 里面填过种子 → 图标带点 · ${tag}`, f.toggle?.changed === true, JSON.stringify(f.toggle))
      if (state === 'cp-t8-both-open') check(`边界 · T8 面板和高级设置同时开、都在视口里 · ${tag}`, Boolean(f.panel && f.advanced) && f.panel.bottom <= f.viewport.h && f.advanced.bottom <= f.viewport.h, JSON.stringify({ panel: f.panel && [f.panel.top, f.panel.bottom], advanced: f.advanced && [f.advanced.top, f.advanced.bottom] }))
      if (state === 'cp-u-image-model') check(`边界 · U 图片模型面板 3 项、高级 3 项 · ${tag}`, f.panel?.rows === 3 && f.advanced?.rows.length === 3, JSON.stringify({ panel: f.panel?.keys, advanced: f.advanced?.rows }))
      if (state === 'cp-u2-max-main') check(`board:ComposerParams/params.panel · U2 七项全摊开不滚、没有高级设置图标 · ${tag}`, f.panel?.rows === 7 && f.panel.scrolls === false && !f.toggle, JSON.stringify({ rows: f.panel?.rows, scrolls: f.panel?.scrolls, toggle: f.toggle }))
      if (state === 'cp-u3-single-advanced') check(`board:ComposerParams/advanced.section · U3 只有 1 项也进 · ${tag}`, f.advanced?.rows.length === 1, JSON.stringify(f.advanced?.rows))
      if (state === 'cp-l-options-56') {
        const capped = f.capped[0]
        check(`board:ComposerParams/params.option-group.capped · 56 个比例最多露 3 行、格内滚 · ${tag}`, Boolean(capped) && capped.sh > capped.h + 1 && capped.row > 0 && capped.h <= capped.row * 3 + 40, JSON.stringify(f.capped))
      }
      if (state === 'cp-q-longest-label') check(`边界 · Q 最长参数名不出面板 · ${tag}`, Boolean(f.panel) && f.panel.right <= f.viewport.w, JSON.stringify(f.panel && { w: f.panel.w }))
      if (state === 'cp-solo-panel') check(`board:ComposerParams/params.panel · 只有一项也是 320 面板（不是 68 窄条）· ${tag}`, Boolean(f.panel) && f.panel.w >= 300, JSON.stringify(f.panel && { w: f.panel.w, rows: f.panel.rows }))
      await shot(page, `${state}-${lang}-${scheme}`)
      await context.close()
    }
  }

  // ── ② 最小窗口 700×720 ──
  for (const { lang, scheme } of RUNS) {
    const tag = `700x720 ${lang}-${scheme}`
    const { page, context } = await open('mb-a-no-input-menu', { lang, scheme, viewport: { width: 700, height: 720 } })
    const menu = await page.evaluate(() => {
      const dropdown = [...document.querySelectorAll('[data-nomi-select-dropdown]')].find((el) => el.getBoundingClientRect().width > 0)
      if (!dropdown) return null
      const list = dropdown.querySelector('[data-nomi-select-whole]') ?? dropdown.querySelector('.overflow-auto')
      const rows = [...dropdown.querySelectorAll('[role="option"]')]
      const r = dropdown.getBoundingClientRect()
      const lr = list?.getBoundingClientRect()
      const last = rows.at(-1)?.getBoundingClientRect()
      return { rows: rows.length, whole: Boolean(dropdown.querySelector('[data-nomi-select-whole]')), top: r.top, bottom: r.bottom, scrolls: list ? list.scrollHeight > list.clientHeight + 1 : null, lastFullyVisible: Boolean(last && lr) && last.bottom <= lr.bottom + 0.5 && last.top >= lr.top - 0.5, vh: window.innerHeight }
    })
    report.narrow.push({ what: 'mode-menu', lang, menu })
    check(`边界 · 700×720 方式菜单不出窗口；放得下就整个露出（最后一行整行看得见），放不下在菜单里滚 · ${tag}`, Boolean(menu) && menu.whole && menu.top >= 0 && menu.bottom <= menu.vh + 0.5 && (menu.lastFullyVisible || menu.scrolls), JSON.stringify(menu))
    await shot(page, `narrow-700x720-mode-menu-${lang}-${scheme}`, { full: true })
    await context.close()
    const second = await open('cp-u2-max-main', { lang, scheme, viewport: { width: 700, height: 720 } })
    const f = await readFacts(second.page)
    report.narrow.push({ what: 'panel-7', lang, panel: f.panel && { top: f.panel.top, bottom: f.panel.bottom, scrolls: f.panel.scrolls } })
    check(`边界 · 700×720 七项面板不出窗口（放不下在面板里滚）· ${tag}`, Boolean(f.panel) && f.panel.top >= 0 && f.panel.bottom <= f.viewport.h + 0.5, JSON.stringify(f.panel && { top: f.panel.top, bottom: f.panel.bottom, scrolls: f.panel.scrolls }))
    await shot(second.page, `narrow-700x720-panel-7-${lang}-${scheme}`, { full: true })
    await second.context.close()
  }

  // ── ③ 分镜行 / 参考卡：同一只底栏 ──
  for (const { lang, scheme } of RUNS) {
    // 参考卡出过图后，生成走图下的「重新生成」，底栏里本来就没有生成钮（02 两张都已出图）；
    // 参考卡复用屏 sbr-05 里有一张还没生成的卡，用它验「参考卡的生成钮也在同一种底栏里」。
    // 画布列表详情嵌的是画布节点那只生成框本体（GenerationListDetail → LazyNodeGenerationComposer host="inline"）；
    // 实验室那一格没种模型目录，生成框只画骨架，这里量不到，记在 PR 的未验证里。
    for (const [screen, state] of [['storyboard', 'sb-row-01-draft-inherited-aspect'], ['storyboard', 'sb-zone-02-anchors-expanded'], ['storyboard-reuse', 'sbr-05-anchors-wide']]) {
      const expectSend = state !== 'sb-zone-02-anchors-expanded'
      const { page, context } = await open(state, { lang, scheme, screen })
      const facts = await page.evaluate(() => ({
        footers: document.querySelectorAll('[data-node-composer-footer]').length,
        sends: document.querySelectorAll('[data-node-composer-footer] [data-bar-segment="generate"]').length,
        stray: document.querySelectorAll('[data-bar-segment="generate"]:not([data-node-composer-footer] *)').length,
      }))
      report.storyboard.push({ state, lang, ...facts })
      // 「没有」先证探针活着：共用底栏在这一屏找得到，再说底栏外没有第二颗生成钮（02 再加：底栏里也没有）。
      let sameBar = true
      try {
        const footerProof = await proveProbe(page.locator('[data-node-composer-footer]'), `${state} 里画出了共用底栏`)
        const sendInFooter = page.locator('[data-node-composer-footer] [data-bar-segment="generate"]')
        if (expectSend) await proveProbe(sendInFooter, `${state} 的生成钮在共用底栏里`)
        else await expectAbsent(sendInFooter, { provenBy: footerProof, message: '参考卡都出过图：底栏里没有生成钮（走图下的「重新生成」）' })
        await expectAbsent(page.locator('[data-bar-segment="generate"]:not([data-node-composer-footer] *)'), { provenBy: footerProof, message: '底栏外没有第二颗生成钮' })
      } catch (error) {
        sameBar = false
        facts.error = String(error).split('\n')[0]
      }
      check(`board:ComposerParams/storyboard.row · ${state} 底栏是画布同一只（生成钮都在同一种底栏里）· ${lang}-${scheme}`, sameBar, JSON.stringify(facts))
      // 没存方式的镜头：方式格写这一镜实际会用的方式，不露 NomiSelect 的占位「选择」。
      const modeLabel = uiText(lang === 'en' ? 'en' : 'zh-CN', 'generationCommon.modeMenu.heading')
      const modeTexts = await page.evaluate((label) => [...document.querySelectorAll(`[data-node-composer-footer] button[aria-label="${label}"]`)].map((el) => el.textContent?.trim() ?? ''), modeLabel)
      const placeholder = [uiText('zh-CN', 'common.select'), uiText('en', 'common.select')]
      check(`board:ComposerParams/storyboard.row · ${state} 方式格不露占位字 · ${lang}-${scheme}`, modeTexts.every((text) => text && !placeholder.includes(text)), JSON.stringify(modeTexts))
      await shot(page, `${state}-${lang}-${scheme}`, { full: true })
      await context.close()
    }
  }

  // ── ④ 全目录矩阵 ──
  if (WITH_MATRIX) {
    const matrix = { zh: null, en: null }
    for (const { lang, locale } of RUNS) {
      const t = (key, values) => uiTextWith(locale, key, values)
      const modelLabel = t('generationCommon.parameters.model')
      const { page, context } = await open('cp-matrix', { lang, scheme: 'light' })
      const combos = await page.evaluate(() => window.__cpMatrix.combos)
      const tally = { combos: combos.length, threeOrMore: 0, two: 0, durationOnly: 0, oneOther: 0, noParams: 0, modelEllipsis: 0, problems: [], noFooter: [] }
      for (const combo of combos) {
        const id = `${combo.archetypeId}/${combo.modeId}`
        await page.evaluate((c) => window.__cpMatrix.set(c), combo)
        const ready = await page.waitForFunction((want) => {
          const host = document.querySelector('[data-cp-matrix]')
          if (host?.getAttribute('data-cp-matrix') !== want) return false
          return Boolean(host.querySelector('[data-node-composer-footer] [data-bar-segment="generate"]'))
        }, id, { timeout: stationTimeout({ operations: 1 }) }).then(() => true).catch(() => false)
        if (!ready) { tally.noFooter.push(id); continue }
        await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
        const f = await page.evaluate(([footerSel]) => {
          const footer = document.querySelector(footerSel)
          const card = footer?.closest('.generation-canvas-v2-node__composer-card')?.getBoundingClientRect()
          const cells = [...footer.querySelectorAll('button')].filter((b) => !b.closest('[aria-hidden="true"]') && b.getBoundingClientRect().width > 0).map((b) => {
            const r = b.getBoundingClientRect()
            const spans = [...b.querySelectorAll('span')].filter((sp) => sp.getBoundingClientRect().width > 0)
            return { label: b.getAttribute('aria-label') || b.textContent?.trim() || '', left: r.left, right: r.right, top: r.top, bottom: r.bottom, h: Math.round(r.height), title: b.getAttribute('title') ?? '', clipped: b.scrollWidth > b.clientWidth + 1 || spans.some((sp) => sp.scrollWidth > sp.clientWidth + 1) }
          })
          const summary = footer.querySelector('[data-parameter-summary]')
          return { cells, card: card && { left: card.left, right: card.right }, overflow: footer.scrollWidth > footer.clientWidth + 1, summary: summary ? { text: summary.getAttribute('data-parameter-summary') ?? '', title: summary.getAttribute('title') ?? '', cramped: summary.getAttribute('data-parameter-summary-cramped') === 'true' } : null }
        }, [FOOTER])
        const sorted = [...f.cells].sort((a, b) => a.left - b.left)
        const overlaps = sorted.slice(1).filter((cell, index) => sorted[index].right - cell.left > 0.5).length
        const outside = f.cells.filter((cell) => f.card && (cell.left < f.card.left - 0.5 || cell.right > f.card.right + 0.5)).length
        const tall = f.cells.filter((cell) => cell.h > 32).length
        const model = f.cells.find((cell) => cell.label === modelLabel || cell.title)
        const modelClipped = f.cells.some((cell) => cell.clipped && cell.label !== '' && !(f.summary && cell.title === f.summary.title))
        const shown = (f.summary?.text ?? '').split(' · ').filter(Boolean)
        const full = (f.summary?.title ?? '').split(' · ').filter(Boolean)
        if (!f.summary) tally.noParams += 1
        else if (shown.length >= 3 || shown.length === full.length) tally.threeOrMore += 1
        else if (shown.length === 2) tally.two += 1
        else if (shown.length === 1 && /\d+\s*(s|秒)$/.test(shown[0])) tally.durationOnly += 1
        else tally.oneOther += 1
        if (modelClipped) tally.modelEllipsis += 1
        if (overlaps || outside || f.overflow || tall) tally.problems.push({ id, overlaps, outside, overflow: f.overflow, tall, summary: f.summary, model: model?.title ?? null })
      }
      matrix[lang] = tally
      console.log(`  矩阵 ${lang}：${JSON.stringify({ ...tally, problems: tally.problems.length, noFooter: tally.noFooter.length })}`)
      check(`边界 · 全目录矩阵 ${lang}：底栏不互相盖、不出框、不折行 · ${combos.length} 个组合`, tally.problems.length === 0, JSON.stringify(tally.problems.slice(0, 5)))
      await context.close()
    }
    report.matrix = matrix
  }
  if (WITH_EVIDENCE) { fs.mkdirSync(EVIDENCE_DIR, { recursive: true }); fs.writeFileSync(path.join(EVIDENCE_DIR, 'walk-report.json'), `${JSON.stringify(report, null, 2)}\n`) }
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
