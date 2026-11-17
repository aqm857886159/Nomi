// 底栏「窄了谁先让」的迁移特征测试（方向检查 docs/engineering/direction-checks/2026-11-17-bar-yield.md「特征测试」一节）。
//
// 让法的判据是「屏上画出来的东西出没出界」，所以这里只在真浏览器排版里量（设计实验室，现役 BaseGenerationNode + 生成框）。
// 静止态的宽度 × 最长名字由 composer-params.walk.mjs 和设计实验室基线守；这里守的是**内容变了、底栏总宽没变**的迁移：
//   T1 面板开着把时长改长 → Esc 关面板 → 参数条里没有东西出界、摘要不压右边的图标；
//   T2 切语言：摘要的字不变、方式名变宽 → 照样重量，不出界；
//   T3 重量后尺寸不再变 → 不再触发（静置 600ms 里让级零变化）；面板开着连改三次值，每次静下来后让级不在两级之间来回抖。
// 每条都先把底栏收窄到「第 0 级刚好放得下」的宽度（二分找最小宽），让几个像素的差也能分出对错。
// 另出一张证据图（d）：分镜行最窄一档（行宽 598）英文，面板开着改值的那一刻。
//
// 用法：node tests/ux/composer-bar-yield-transitions.walk.mjs   （SHOTS_DIR=<目录> 存证据图，缺省 .tmp/composer-bar-yield/lab）
import { chromium } from 'playwright'
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { stationTimeout } from './_station-budget.mjs'
import { proveProbe } from './_assert.mjs'
import { REPO_ROOT } from './design-lab/labStates.mjs'
import { assertLabPortOwnership, labPortFor } from './design-lab/labServer.mjs'

const ROLE = 'walk-composer-bar-yield'
const HOST = '127.0.0.1'
const PORT = labPortFor(ROLE)
const BASE = `http://${HOST}:${PORT}`
const SHOTS_DIR = path.resolve(process.env.SHOTS_DIR || path.join(REPO_ROOT, '.tmp/composer-bar-yield/lab'))
const FOOTER = '.generation-canvas-v2-node__composer-card [data-node-composer-footer]'
const PANEL = '[data-agent-parameter-panel]'

const failures = []
function check(name, ok, detail) {
  if (ok) console.log(`  ✓ ${name}`)
  else { failures.push(`${name}${detail ? ` — ${detail}` : ''}`); console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`) }
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
assertLabPortOwnership(ROLE)
const browser = await chromium.launch({ headless: true })
const pageErrors = []

async function open(state, { lang = 'zh', screen = 'node-composer-bar' } = {}) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 })
  // 开发服务器一页几百个模块，资源计时缓冲默认只记 250 条：放大，T2 才找得到页面加载的那份 i18next。
  await context.addInitScript(() => performance.setResourceTimingBufferSize(20000))
  const page = await context.newPage()
  page.on('pageerror', (error) => pageErrors.push(`${state}: ${String(error).slice(0, 200)}`))
  await page.goto(`${BASE}/design-lab.html?screen=${screen}&frame=1&state=${state}${lang === 'en' ? '&lang=en' : ''}`, { timeout: stationTimeout({ operations: 12 }) })
  await page.waitForFunction(() => window.__designLabReady === true, null, { timeout: stationTimeout({ operations: 6 }) })
  return { page, context }
}

const settle = (page) => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))

/** 参数条里出界的格 + 底栏一行里相邻控件相压的对（一次读完）。 */
const readBar = (page, footerSel = FOOTER) => page.evaluate((sel) => {
  const footer = document.querySelector(sel)
  if (!footer) return null
  const bar = footer.querySelector('[data-bar-segment="model-params"] > *')
  const right = bar.getBoundingClientRect().right
  const items = [...bar.querySelectorAll('[data-yield-item]')]
  const out = items.filter((el) => el.getBoundingClientRect().right > right + 0.5).map((el) => el.getAttribute('data-parameter-summary') ?? el.textContent?.trim() ?? '')
  const row = [...items, footer.querySelector('[data-bar-segment="prompt-tools"]'), footer.querySelector('[data-bar-segment="generate"]')].filter(Boolean)
    .map((el) => ({ name: el.getAttribute('data-bar-segment') ?? el.getAttribute('data-parameter-summary') ?? 'identity', box: el.getBoundingClientRect() }))
    .sort((a, b) => a.box.left - b.box.left)
  const pressed = row.slice(1).filter((cur, index) => row[index].box.right > cur.box.left + 0.5).map((cur, index) => `${row[index].name} ⟂ ${cur.name}`)
  const summary = footer.querySelector('[data-parameter-summary]')
  return {
    level: footer.getAttribute('data-bar-yield-level'),
    summary: summary?.getAttribute('data-parameter-summary') ?? null,
    title: summary?.getAttribute('title') ?? null,
    drawn: summary?.textContent?.trim() ?? null,
    out,
    pressed,
    width: Math.round(footer.getBoundingClientRect().width),
  }
}, footerSel)

/** 把底栏收到 width（改的是底栏外层的宽；ResizeObserver 看得到）。 */
const setFooterWidth = async (page, width) => {
  await page.evaluate(([sel, w]) => { document.querySelector(sel).parentElement.style.width = `${w}px` }, [FOOTER, width])
  await settle(page)
}

/** 二分找「第 0 级刚好放得下」的最小底栏宽：再窄 1 像素就要让。 */
async function tightestLevelZero(page) {
  let low = 240
  let high = 1200
  await setFooterWidth(page, high)
  if ((await readBar(page)).level !== '0') throw new Error(`足够宽 ${high} 下就不在第 0 级，量不了`)
  while (high - low > 1) {
    const mid = Math.floor((low + high) / 2)
    await setFooterWidth(page, mid)
    if ((await readBar(page)).level === '0') high = mid
    else low = mid
  }
  await setFooterWidth(page, high)
  return high
}

/** 记让级每一次变化（MutationObserver 记属性改写，同值改写也算一次重量）。 */
const startLevelLog = (page) => page.evaluate((sel) => {
  const footer = document.querySelector(sel)
  window.__levelLog = []
  const observer = new MutationObserver((records) => { for (const record of records) window.__levelLog.push(footer.getAttribute('data-bar-yield-level') + (record.oldValue === null ? '' : `<-${record.oldValue}`)) })
  observer.observe(footer, { attributes: true, attributeFilter: ['data-bar-yield-level'], attributeOldValue: true })
  window.__levelLogStop = () => observer.disconnect()
}, FOOTER)
const readLevelLog = (page) => page.evaluate(() => window.__levelLog.slice())

const openPanel = async (page) => {
  if (await page.locator(PANEL).count()) return
  await page.locator(`${FOOTER} [data-parameter-summary]`).first().click()
  await proveProbe(page.locator(PANEL).first(), 'parameter panel opens')
}
const closePanel = async (page) => {
  await page.keyboard.press('Escape')
  await page.locator(PANEL).first().waitFor({ state: 'detached', timeout: stationTimeout() })
  await settle(page)
}
/** 时长：滑杆在轨道上点一下（只提交一次）；分段选择就点那一格。 */
async function setDuration(page, seconds) {
  const control = page.locator('[data-agent-parameter-control="duration"]').first()
  await control.waitFor({ state: 'visible', timeout: stationTimeout() })
  const thumb = control.getByRole('slider').first()
  if (await thumb.count()) {
    const min = Number(await thumb.getAttribute('aria-valuemin'))
    const max = Number(await thumb.getAttribute('aria-valuemax'))
    const box = await control.locator('.mantine-Slider-track').first().boundingBox()
    await page.mouse.click(box.x + box.width * (seconds - min) / (max - min), box.y + box.height / 2)
    await page.waitForFunction(([el, want]) => el.getAttribute('aria-valuenow') === want, [await thumb.elementHandle(), String(seconds)], { timeout: stationTimeout() })
  } else {
    await control.getByRole('radio', { name: new RegExp(`^${seconds}\\s*s`) }).first().click()
  }
  await settle(page)
}

async function shot(page, name) {
  fs.mkdirSync(SHOTS_DIR, { recursive: true })
  const clip = await page.evaluate(() => {
    const boxes = [document.querySelector('[data-design-lab-shot]'), document.querySelector('[data-agent-parameter-panel]')]
      .filter(Boolean).map((el) => el.getBoundingClientRect()).filter((r) => r.width > 0 && r.height > 0)
    const left = Math.max(0, Math.min(...boxes.map((r) => r.left)) - 8); const top = Math.max(0, Math.min(...boxes.map((r) => r.top)) - 8)
    const right = Math.min(window.innerWidth, Math.max(...boxes.map((r) => r.right)) + 8); const bottom = Math.min(window.innerHeight, Math.max(...boxes.map((r) => r.bottom)) + 8)
    return { x: left, y: top, width: right - left, height: bottom - top }
  })
  await page.screenshot({ path: path.join(SHOTS_DIR, `${name}.png`), clip, animations: 'disabled' })
}

const report = {}
try {
  // ── T1 面板开着把时长改长 → 关面板：不出界、不相压 ──
  {
    const { page, context } = await open('cp-t-panel-flat', { lang: 'en' })
    try {
      if (await page.locator(PANEL).count()) await closePanel(page)
      await openPanel(page)
      await setDuration(page, 5)
      await closePanel(page)
      const width = await tightestLevelZero(page)
      const before = await readBar(page)
      await openPanel(page)
      await setDuration(page, 10)
      const open10 = await readBar(page)
      await closePanel(page)
      const after = await readBar(page)
      report.t1 = { width, before, open10, after }
      check('T1 面板开着改长 → 关：参数条里没有东西出界', after.out.length === 0, JSON.stringify(report.t1))
      check('T1 面板开着改长 → 关：相邻控件不相压', after.pressed.length === 0, JSON.stringify(after.pressed))
      check('T1 面板开着时摘要画的就是当前值（量的就是画的）', open10.drawn === open10.summary && /10\s*s/.test(open10.summary ?? ''), JSON.stringify(open10))
    } finally { await context.close() }
  }

  // ── T2 切语言：摘要不变、方式名变宽 → 重量 ──
  {
    const { page, context } = await open('cp-t-panel-flat', { lang: 'zh' })
    try {
      if (await page.locator(PANEL).count()) await closePanel(page)
      // 比例默认「自动」会跟着语言变字；换成 16:9，摘要中英一个字不差，只剩方式名变宽。
      await openPanel(page)
      await page.locator(PANEL).getByRole('radio').filter({ hasText: '16:9' }).first().click()
      await closePanel(page)
      const width = await tightestLevelZero(page)
      const zh = await readBar(page)
      const modeZh = await page.evaluate((sel) => [...document.querySelectorAll(`${sel} [data-yield-item] button`)].map((el) => el.textContent?.trim()), FOOTER)
      // 切语言走 app 自己那份 i18next 实例：按页面实际加载的预打包地址取（地址差一个 ?v= 就是另一份实例，切了等于没切）。
      await page.evaluate(async () => {
        const url = performance.getEntriesByType('resource').map((entry) => entry.name).find((name) => /\/deps\/i18next\.js(\?|$)/.test(name))
        if (!url) throw new Error('页面没加载预打包的 i18next')
        const module = await import(url)
        await module.default.changeLanguage('en')
      })
      await page.waitForFunction(([sel, before]) => JSON.stringify([...document.querySelectorAll(`${sel} [data-yield-item] button`)].map((el) => el.textContent?.trim())) !== before, [FOOTER, JSON.stringify(modeZh)], { timeout: stationTimeout() })
      await settle(page)
      const en = await readBar(page)
      const modeEn = await page.evaluate((sel) => [...document.querySelectorAll(`${sel} [data-yield-item] button`)].map((el) => el.textContent?.trim()), FOOTER)
      report.t2 = { width, zh, en, modeZh, modeEn }
      check('T2 前提：摘要的整串中英相同（只有方式名变宽）', /^16:9 · /.test(zh.summary ?? '') && (en.title ?? '') === (zh.title ?? ''), JSON.stringify({ zh: zh.title, en: en.title }))
      check('T2 切到英文（方式名变宽）：参数条里没有东西出界', en.out.length === 0, JSON.stringify(report.t2))
      check('T2 切到英文：相邻控件不相压', en.pressed.length === 0, JSON.stringify(en.pressed))
    } finally { await context.close() }
  }

  // ── T3 重量后不再触发；面板开着连改三次值不抖 ──
  {
    const { page, context } = await open('cp-t-panel-flat', { lang: 'en' })
    try {
      if (await page.locator(PANEL).count()) await closePanel(page)
      await openPanel(page)
      await setDuration(page, 5)
      await closePanel(page)
      await tightestLevelZero(page)
      const rounds = []
      await openPanel(page)
      for (const seconds of [10, 5, 15]) {
        await setDuration(page, seconds)
        await page.waitForTimeout(150)
        await startLevelLog(page)
        await page.waitForTimeout(600)
        const log = await readLevelLog(page)
        rounds.push({ seconds, level: (await readBar(page)).level, log })
        await page.evaluate(() => window.__levelLogStop())
      }
      await closePanel(page)
      await page.waitForTimeout(150)
      await startLevelLog(page)
      await page.waitForTimeout(600)
      const closedLog = await readLevelLog(page)
      report.t3 = { rounds, closedLog }
      check('T3 面板开着连改三次：每次静下来后让级不再变（不在两级之间来回抖）', rounds.every((round) => round.log.length === 0), JSON.stringify(rounds))
      check('T3 关面板静下来后不再触发重量', closedLog.length === 0, JSON.stringify(closedLog))
    } finally { await context.close() }
  }

  // ── 证据图 d：分镜行最窄一档（行宽 598）英文，面板开着改值的那一刻 ──
  {
    const { page, context } = await open('sbl-yield-narrowest-longest-en', { lang: 'en', screen: 'storyboard-reuse' })
    try {
      const footer = '[data-node-composer-footer]'
      await page.locator(`${footer} [data-parameter-summary]`).first().click()
      await proveProbe(page.locator(PANEL).first(), 'storyboard parameter panel opens')
      const beforeValue = await page.locator(`${footer} [data-parameter-summary]`).first().getAttribute('data-parameter-summary')
      // 改清晰度（720p → 1080p）：实验室这一格里点时长，选中的时长没有变（原因未查清，不在本走查范围），所以改清晰度。
      // 这一档摘要只剩时长，改清晰度屏上摘要不变，图看的是「开着改值后底栏不出界、不压」。
      await page.locator(PANEL).getByRole('radio').filter({ hasText: '1080p' }).first().click()
      await settle(page)
      const facts = await readBar(page, footer)
      report.d = { beforeValue, facts }
      await shot(page, 'd-storyboard-598-en-open-changed')
    } finally { await context.close() }
  }
} finally {
  await browser.close()
  vite.kill()
  fs.mkdirSync(SHOTS_DIR, { recursive: true })
  fs.writeFileSync(path.join(SHOTS_DIR, 'transitions-report.json'), JSON.stringify({ report, failures, pageErrors }, null, 2))
}

check('渲染期间零 pageerror', pageErrors.length === 0, pageErrors.join(' | '))
console.log(failures.length ? `\n✗ ${failures.length} 条没过` : '\n✓ 全部通过')
process.exit(failures.length ? 1 : 0)
