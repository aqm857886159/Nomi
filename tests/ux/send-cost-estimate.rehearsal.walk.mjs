// 发送键上的约价：免费走查（花费显示第一步；设计卡 docs/plan/2026-11-17-cost-step1-estimate.md；
// 板 ModelSurfaces cost.send-pill / cost.hover）。
//
// 真实条件：打包同构的 dev Electron、隔离资料目录、内置 APIMart 目录、非秘密的假凭据。APIMart 的地址经测试出网重定向
// 指到本机回环假服务——价目、出错、超时都由它演；它对任何非 GET 一律 405，不产出媒体、不花钱。
// 主分支 APIMart 的型号没有数量参数（界面上没有「×N」），「单价 × 份数」由单测守（设计卡真实任务 3 记 unverified）。
//
// 设计卡六条真实任务（中文、英文各一遍）：
//   1. Seedance 2.0 Mini · 5 秒 720P：键上硬币 + 积分数（= 假价目 0.039 × 5 × 10）；悬停那一句逐字等于登记原文。
//   2. 改时长、再改清晰度：数字各变一次，等于假价目对应规格；中途不闪 0、新数出现后旧数不再回来。
//   4. 价目里没有的型号：键上只剩 ↑，不印数、不印 0；悬停「暂时估不出这次用量」。
//   5. 假价目回 500 / 一直不回（8 秒超时）：同 4，发送照常可点。
//   6. 只看价格：假服务收到的非 GET 0 次，花钱授权（审批流水 / 收据）0 条。
// 最后真点一次发送：停在花钱确认就取消；没有确认直接发出也只发给假服务（扣 5 秒再回 405，留出「生成中」那一帧），这一笔单独记账。
// 各状态的截图（对照表 cost.send-pill / cost.hover 每行一张，<语言>-<状态>[-dark].png）：loading（第一次读价目被假服务扣 6 秒）、
//   priced、hover、longest（Seedance 2.0 标准版 1080P 15 秒 = 14.63 积分，最长的数）、narrow（同一帧、窗口收到 700 宽）、unknown、unknown-hover、
//   error-500、error-timeout、generating（发出去、假服务还没回）。「禁用 + 有价」真窗口造不出（能禁用发送的条件都带参考输入或制作流程，
//   带参考的这一单真价目判估不出），由 ComposerSendButton 单测守；实验室格 sc-i-disabled-priced 只出图（该屏待拍板，门岗不比像素）。
//
// 用法：先 pnpm run build；node tests/ux/send-cost-estimate.rehearsal.walk.mjs
//   NOMI_SURFACE_SCHEME=dark 整轮按暗色起；NOMI_SEND_COST_EVIDENCE=<目录> 截图与收据目录（缺省 .tmp/send-cost-estimate）。
//   --out <文件> [--runs 5]（性能量具 tests/perf/node-json-bench.mjs 传入）：量「改一个参数 → 键上出现新数」的耗时；
//   缺省只跑中文一轮（性能场景 send-cost-param-update），--locale en 只跑英文一轮（send-cost-param-update-en）。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { once } from 'node:events'
import { expect } from '@playwright/test'
import { makeTempDir } from '../../scripts/_test-temp.mjs'
import { ACCEPTANCE_VIEWPORT, launchNomiApp, seedSavedFixtureCredentials } from './_launchApp.mjs'
import { clickOrFail, expectAbsent, expectVisible, proveProbe, screenshotSettled } from './_assert.mjs'
import { stationTimeout } from './_station-budget.mjs'
import { addCanvasNode, newProjectEntry, switchWorkspace } from './_shell.mjs'
import { panCanvasUntilInside } from './_canvasHit.mjs'
import { uiText, uiTextWith } from './full-walk/invariants.mjs'

const output = path.resolve(process.env.NOMI_SEND_COST_EVIDENCE || '.tmp/send-cost-estimate')
const scheme = process.env.NOMI_SURFACE_SCHEME === 'dark' ? 'dark' : 'light'
const shot = (locale, name) => path.join(output, `${locale}-${name}${scheme === 'dark' ? '-dark' : ''}.png`)
fs.mkdirSync(output, { recursive: true })
const perfFile = process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : undefined
const runs = Number(process.argv[process.argv.indexOf('--runs') + 1]) || 5
/** 主分支对照：主分支没有约价，只量 paramUi（NOMI_SEND_COST_BASELINE=1，只在 --out 性能模式下用）。 */
const BASELINE = process.env.NOMI_SEND_COST_BASELINE === '1' && Boolean(perfFile)
/**
 * 只跑一种语言：--locale（性能场景按语言各登记一个）或 NOMI_SEND_COST_LOCALE（取证）；性能模式缺省中文，走查缺省中英各一轮。
 * 性能循环每次关面板后也核「摘要不压提示词工具」。
 */
const onlyLocale = process.argv.includes('--locale') ? process.argv[process.argv.indexOf('--locale') + 1] : process.env.NOMI_SEND_COST_LOCALE
const LOCALES = onlyLocale ? [onlyLocale] : perfFile ? ['zh-CN'] : ['zh-CN', 'en']
/** 取证：把发送键往左撑宽 N 像素（主分支没有约价胶囊，用它模拟胶囊占的宽，复现同一个让法漏量）。 */
const WIDEN_PX = Number(process.env.NOMI_SEND_COST_WIDEN_PX) || 0

/** 假价目（美元 / 秒，照 APIMart 公开价目的字段形状）。最贵规格 = 标准版 1080P：15 秒 1.4625 美元 = 14.63 积分。 */
const VIDEO_RATES = {
  'seedance-2.0-mini': { '480P': 0.02, '720P': 0.039 },
  'seedance-2.0': { '480P': 0.02, '720P': 0.039, '1080P': 0.0975 },
}
/** 演出错（500）/ 演超时（一直不回）的型号；其余没列的型号回 success:false（价目里没有）。 */
const FAILING = new Map()
/** 演「算价中」：下一次读这个型号的价目扣多少毫秒再回（只扣一次）。 */
const SLOW_ONCE = new Map()
/** 非 GET 扣这么久再回 405：发出去以后节点处在「生成中」，够截一帧。 */
const NON_GET_HOLD_MS = 5000
const calls = []
const server = http.createServer((req, res) => {
  const target = new URL(req.url, 'http://127.0.0.1')
  const model = target.searchParams.get('model')
  calls.push({ method: req.method, path: target.pathname, model, at: Date.now() })
  if (req.method !== 'GET') { setTimeout(() => { res.statusCode = 405; res.end('{"success":false}') }, NON_GET_HOLD_MS); return }
  if (target.pathname === '/api/pricing/model' && FAILING.get(model) === 'hang') return
  const delay = target.pathname === '/api/pricing/model' ? SLOW_ONCE.get(model) ?? 0 : 0
  SLOW_ONCE.delete(model)
  setTimeout(() => {
    let payload = { success: false }
    if (target.pathname === '/api/pricing/model' && FAILING.get(model) === '500') res.statusCode = 500
    else if (target.pathname === '/api/pricing/model' && VIDEO_RATES[model]) {
      payload = { success: true, data: { model_name: model, billing_type: 'per_second', membership: { category: 'video' },
        resolution_enabled: true, resolution_paid_prices: VIDEO_RATES[model] } }
    } else if (target.pathname === '/v1/models') { res.statusCode = 401; payload = { error: { type: 'apimart_error' } } }
    else if (target.pathname !== '/api/pricing/model') res.statusCode = 404
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(payload))
  }, delay)
})
server.listen(0, '127.0.0.1')
await once(server, 'listening')
const origin = `http://127.0.0.1:${server.address().port}`
const credits = (usd) => String(Math.round(usd * 10 * 100) / 100)
const usdText = (usd) => `$${usd}`
const nonGet = () => calls.filter((call) => call.method !== 'GET').length

/** 审批流水与收据：隔离目录里任何一份 approvals.ndjson / approval-receipts.json 的条数。 */
function spendApprovals(root) {
  let count = 0
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(file)
      else if (entry.name === 'approvals.ndjson') count += fs.readFileSync(file, 'utf8').split('\n').filter((line) => line.trim()).length
      else if (entry.name === 'approval-receipts.json') {
        const parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
        count += Array.isArray(parsed) ? parsed.length : Object.keys(parsed?.receipts ?? {}).length
      }
    }
  }
  walk(root)
  return count
}

/** 在页面里记下发送键每一次变化：credits 文字 / arrow（只剩箭头）/ busy。 */
async function startRecording(win) {
  await win.evaluate(() => {
    const frames = []
    const read = () => {
      const send = document.querySelector('[data-node-composer-footer] [data-bar-segment="generate"]')
      const value = send?.querySelector('[data-send-cost="credits"]')?.textContent ?? (send ? 'arrow' : 'none')
      if (frames.at(-1)?.value !== value) frames.push({ value, at: performance.now() })
    }
    read()
    const observer = new MutationObserver(read)
    observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true })
    window.__sendCostFrames = frames
    window.__sendCostStop = () => observer.disconnect()
  })
}
const stopRecording = (win) => win.evaluate(() => { window.__sendCostStop(); return window.__sendCostFrames })

const results = []
const pricedUpdateMs = []
const paramUiMs = []
let explicitSends = 0
try {
  for (const locale of LOCALES) {
    const root = makeTempDir('nomi-send-cost-')
    const settingsDir = path.join(root, 'settings')
    fs.mkdirSync(settingsDir, { recursive: true })
    const options = {
      name: `send-cost-estimate-${locale}`, userDataDir: settingsDir, settingsDir, projectsDir: path.join(root, 'projects'),
      syntheticCredentialStorage: true,
      env: { NOMI_TEST_NETWORK_REDIRECTS: JSON.stringify([{ from: 'https://api.apimart.ai', to: origin }]) },
      initialLocalStorage: { 'nomi-color-scheme': scheme, 'nomi:locale:v1': locale, 'nomi:splash:v1': 'seen', 'nomi:journey-tour:v1': 'seen',
        'nomi-onboarding-checklist:v1': 'seen', 'nomi:canvas-gesture-hint:v1': 'seen' },
    }
    fs.mkdirSync(options.projectsDir, { recursive: true })
    await seedSavedFixtureCredentials(options, ['apimart'])
    const { app, win } = await launchNomiApp(options)
    const record = { locale, scheme }
    try {
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1220, 840))
      await clickOrFail(newProjectEntry(win), 'new project')
      await switchWorkspace(win, 'generation')
      await addCanvasNode(win, 'video')
      const composer = win.locator('[data-composer-host="canvas"]:visible').last()
      const send = composer.locator('[data-bar-segment="generate"]')
      if (WIDEN_PX) await send.first().evaluate((el, px) => { el.style.marginLeft = `${px}px` }, WIDEN_PX)
      const picker = composer.getByRole('button', { name: uiText(locale, 'generationCommon.parameters.model'), exact: true })
      const menu = win.locator('[data-nomi-select-dropdown]:visible').first()
      const pick = async (pattern, label) => {
        await clickOrFail(picker, `open model picker for ${label}`)
        const more = menu.getByRole('button', { name: uiText(locale, 'onboardingProviders.modelControls.more'), exact: true })
        const row = menu.getByRole('option').filter({ has: win.locator('[data-nomi-select-option-label]', { hasText: pattern }) }).first()
        const menuOpen = await proveProbe(menu, 'model menu is open')
        if (!(await row.isVisible()) && await more.isVisible().catch(() => false)) await clickOrFail(more, 'expand more models')
        if (!(await row.isVisible())) {
          record.menuRows = await menu.locator('[data-nomi-select-option-label]').allInnerTexts()
          throw new Error(`model menu has no row matching ${pattern}: ${JSON.stringify(record.menuRows)}`)
        }
        await clickOrFail(row, `pick ${label}`)
        await expectAbsent(menu, { provenBy: menuOpen, message: 'model menu closes after picking' })
      }
      const setParam = async (key, value) => {
        await clickOrFail(composer.locator('[data-parameter-summary]').first(), `open parameters for ${key}`)
        const control = win.locator(`[data-agent-parameter-control="${key}"]`).first()
        await expectVisible(control, `parameter control ${key}`)
        if (typeof value === 'number') {
          // 时长是连续滑杆（4–15 秒）：在轨道上点一下＝只提交一次（方向键每一步都会提交）。
          await clickSlider(control, value)
        } else {
          const option = control.getByRole('radio', { name: value, exact: true })
          if (!(await option.first().isVisible())) {
            record[`options-${key}`] = await control.innerText()
            throw new Error(`parameter ${key} has no option ${value}: ${record[`options-${key}`]}`)
          }
          await option.first().click()
        }
        await win.keyboard.press('Escape')
        await summaryClearOfTools(`after setting ${key}`)
      }
      // 关面板后摘要不许压在提示词工具底下（底栏量的是屏上原件，主分支 86eed2e87 / 634448a01 起；中英两轨都核）。
      // 约价胶囊让画布底栏开始挤，这一下最常见：开面板改参数 → 关面板。
      const summaryClearOfTools = async (label) => {
        const summary = composer.locator('[data-parameter-summary]').first()
        const firstTool = composer.locator('[data-prompt-tool]').first()
        await expect.poll(async () => {
          const [a, b] = [await summary.boundingBox(), await firstTool.boundingBox()]
          return Boolean(a && b && a.x + a.width <= b.x + 0.5)
        }, { message: `${label}: summary chip ends before the prompt tools`, timeout: stationTimeout() }).toBe(true)
      }
      const clickSlider = async (control, value) => {
        const thumb = control.getByRole('slider').first()
        await expectVisible(thumb, 'duration slider')
        if (Number(await thumb.getAttribute('aria-valuenow')) === value) return
        const min = Number(await thumb.getAttribute('aria-valuemin'))
        const max = Number(await thumb.getAttribute('aria-valuemax'))
        const track = control.locator('.mantine-Slider-track').first()
        const box = await track.boundingBox()
        if (!box) throw new Error('duration slider has no box')
        await win.mouse.click(box.x + box.width * (value - min) / (max - min), box.y + box.height / 2)
        await expect(thumb).toHaveAttribute('aria-valuenow', String(value), { timeout: stationTimeout() })
      }
      const pill = send.locator('[data-send-cost="credits"]')
      /** 「不存在」断言的基线：先证明探针在有价时找得到东西（proveProbe），再断言它没了。 */
      let hoverShown = null
      let pillShown = null
      const hoverText = async () => {
        await send.hover()
        const tip = win.locator('[data-send-cost-hover]').first()
        await expect(tip, 'board:ModelSurfaces/cost.hover').toBeVisible({ timeout: stationTimeout() })
        hoverShown = await proveProbe(tip, 'hover sentence is shown')
        // 共用提示组件（Radix）在内容里另放一份只给读屏的副本（role="tooltip"，视觉隐藏）：只读眼睛看得到的那份。
        const text = (await tip.evaluate((el) => {
          const copy = el.cloneNode(true)
          for (const hidden of copy.querySelectorAll('[role="tooltip"]')) hidden.remove()
          return copy.textContent ?? ''
        })).replace(/\s+/g, ' ').trim()
        const screenReader = (await tip.locator('[role="tooltip"]').allTextContents()).join(' ').replace(/\s+/g, ' ').trim()
        assert(!screenReader || screenReader === text, `screen-reader copy says the same sentence: ${screenReader}`)
        return { tip, text }
      }
      const leave = async () => {
        await win.mouse.move(20, 20, { steps: 5 })
        await win.mouse.move(40, 40, { steps: 5 })
        await expectAbsent(win.locator('[data-send-cost-hover]'), { provenBy: hoverShown, message: 'hover sentence goes away after the pointer leaves' }, stationTimeout())
      }

      /** 一帧证据：整屏截图 + 生成浮框的框（并排图按它裁）。 */
      const frame = async (name) => {
        record.boxes = { ...record.boxes, [name]: { ...await composer.boundingBox(), viewportWidth: await win.evaluate(() => window.innerWidth) } }
        await screenshotSettled(win, { path: shot(locale, name) })
      }

      // 任务 1：Seedance 2.0 Mini · 5 秒 720P。提示词先写上（拍板图 M4 ① 那一帧是写了字、能发的样子）。
      if (!perfFile) await composer.locator('[data-prompt-box] .ProseMirror').first().fill(locale === 'en' ? 'A heron at a dawn pier' : '清晨的码头，一只白鹭')
      // 算价中：第一次读这个型号的价目被假服务扣 6 秒——键上只剩 ↑（不转圈、不印 0、也还不说「估不出」）。
      const miniReads = () => calls.filter((call) => call.model === 'seedance-2.0-mini').length
      const miniReadsBefore = miniReads()
      if (!perfFile) SLOW_ONCE.set('seedance-2.0-mini', 6000)
      await pick(/^Seedance 2\.0 Mini$/, 'Seedance 2.0 Mini')
      if (!perfFile) {
        await expect.poll(miniReads, { message: 'price read for Seedance 2.0 Mini reached the fake list', timeout: stationTimeout() }).toBeGreaterThan(miniReadsBefore)
        await expect(send, 'board:ModelSurfaces/cost.send-pill').not.toHaveAttribute('aria-description', /.+/)
        await expect(pill).toHaveCount(0)
        await expect(send).toHaveText('')
        await frame('loading')
        assert.equal(await pill.count(), 0, 'still calculating when the loading frame was taken')
      }
      await setParam('duration', 5)
      await setParam('resolution', '720p')
      const fiveUsd = 0.039 * 5
      if (!BASELINE) {
        await expect(pill, 'board:ModelSurfaces/cost.send-pill').toHaveText(credits(fiveUsd), { timeout: stationTimeout() })
        pillShown = await proveProbe(pill, 'send key shows the estimate')
        await expect(send.locator('svg').first(), 'board:ModelSurfaces/cost.send-pill').toHaveClass(/tabler-icon-coin/)
        await expect(send).toHaveAttribute('data-price-source', /\/api\/pricing\/model\?model=seedance-2\.0-mini/)
      }
      if (perfFile) {
        // 性能：交替改时长 5 ↔ 10。页面里的 MutationObserver 记两个时刻（预热 1 次）：
        //   paramUi  = 在滑杆上按下 → 滑块到新值（改参数这一下的界面响应；主分支同样能量，用来同机对照）；
        //   response = 在滑杆上按下 → 键上出现新数（含 100ms 防抖、IPC、读价目；只在本分支有）。
        for (let run = -1; run < runs; run++) {
          // 起点已是 5 秒：预热改到 10，之后 5、10、5…交替，每次都真的变了。
          const [next, usd] = (run + 1) % 2 === 0 ? [10, 0.039 * 10] : [5, fiveUsd]
          await clickOrFail(composer.locator('[data-parameter-summary]').first(), 'open parameters (perf)')
          const control = win.locator('[data-agent-parameter-control="duration"]').first()
          const thumb = control.getByRole('slider').first()
          await expectVisible(thumb, 'duration slider (perf)')
          await thumb.evaluate((el, [wantValue, wantText]) => {
            const marks = { start: null, checked: null, priced: null }
            window.__perfMarks = marks
            // 起点＝按下鼠标那一刻（事件时间戳与 performance.now 同一时钟），不含 Playwright 往返。
            document.addEventListener('pointerdown', (event) => { if (marks.start === null) marks.start = event.timeStamp }, { capture: true, once: true })
            const read = () => {
              const now = performance.now()
              if (marks.start === null) return
              if (marks.checked === null && el.getAttribute('aria-valuenow') === String(wantValue)) marks.checked = now
              const text = document.querySelector('[data-node-composer-footer] [data-bar-segment="generate"] [data-send-cost="credits"]')?.textContent
              if (marks.priced === null && text === wantText) marks.priced = now
            }
            new MutationObserver(read).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true })
          }, [next, credits(usd)])
          const min = Number(await thumb.getAttribute('aria-valuemin'))
          const max = Number(await thumb.getAttribute('aria-valuemax'))
          const box = await control.locator('.mantine-Slider-track').first().boundingBox()
          await win.mouse.click(box.x + box.width * (next - min) / (max - min), box.y + box.height / 2)
          await expect.poll(() => win.evaluate(() => window.__perfMarks.checked !== null), { timeout: stationTimeout() }).toBe(true)
          if (!BASELINE) await expect(pill).toHaveText(credits(usd), { timeout: stationTimeout() })
          const marks = await win.evaluate(() => window.__perfMarks)
          if (run >= 0) {
            paramUiMs.push(marks.checked - marks.start)
            if (!BASELINE) pricedUpdateMs.push(marks.priced - marks.start)
          }
          await win.keyboard.press('Escape')
          await summaryClearOfTools(`perf run ${run}`)
        }
        continue
      }
      const estimate = uiTextWith(locale, 'generationCommon.composer.sendCost.estimate', { value: credits(fiveUsd), usd: usdText(fiveUsd) })
      const hovered = await hoverText()
      assert.equal(hovered.text, estimate, 'hover sentence equals the registered wording exactly')
      record.task1 = { pill: await pill.innerText(), hover: hovered.text }
      await frame('hover')
      await leave()
      await frame('priced')

      // 任务 2：改时长，再改清晰度；记下键上每一次变化。
      for (const [key, value, usd] of [['duration', 10, 0.039 * 10], ['resolution', '480p', 0.02 * 10]]) {
        const before = await pill.innerText()
        await startRecording(win)
        await setParam(key, value)
        await expect(pill, 'board:ModelSurfaces/cost.send-pill').toHaveText(credits(usd), { timeout: stationTimeout() })
        await win.waitForTimeout(400)
        const frames = await stopRecording(win)
        const values = frames.map((frame) => frame.value)
        assert(!values.some((value) => /^0([.,]0+)?$/.test(value)), `no 0 flashed: ${values}`)
        const firstNew = values.indexOf(credits(usd))
        assert(values.slice(firstNew).every((value) => value === credits(usd)), `old value never returns after the new one: ${values}`)
        assert(values.every((value) => [before, credits(usd), 'arrow'].includes(value)), `only old / new / arrow while updating: ${values}`)
        record[`task2-${key}`] = { before, after: credits(usd), frames: values }
      }

      // 任务 4：价目里没有的型号 → 只剩箭头、悬停「暂时估不出这次用量」。
      await pick(/^Wan 2\.7$|^Wan/, 'a model the price list lacks')
      await expect(send, 'board:ModelSurfaces/cost.send-pill').toHaveAttribute('aria-description', uiText(locale, 'generationCommon.composer.sendCost.priceUnknown'), { timeout: stationTimeout() })
      await expectAbsent(pill, { provenBy: pillShown, message: 'no number on the send key when the price is unknown' })
      await expect(send).toHaveText('')
      const unknownHover = await hoverText()
      assert.equal(unknownHover.text, uiText(locale, 'generationCommon.composer.sendCost.priceUnknown'))
      await frame('unknown-hover')
      await leave()
      await frame('unknown')
      record.task4 = { asked: calls.filter((call) => call.path === '/api/pricing/model').map((call) => call.model) }

      // 任务 5：价目回 500 / 一直不回（主进程 8 秒超时）→ 同未知；发送照常可点。
      for (const [mode, model, row] of [['500', 'seedance-2.0-fast', /^Seedance 2\.0 Fast$/], ['hang', 'seedance-2.0', /^Seedance 2\.0$/]]) {
        FAILING.set(model, mode)
        const askedBefore = calls.filter((call) => call.model === model).length
        await pick(row, `${model} (${mode})`)
        await expect.poll(() => calls.filter((call) => call.model === model).length, { timeout: stationTimeout() }).toBeGreaterThan(askedBefore)
        await expect(send, 'board:ModelSurfaces/cost.send-pill').toHaveAttribute('aria-description', uiText(locale, 'generationCommon.composer.sendCost.priceUnknown'), { timeout: stationTimeout() })
        await expectAbsent(pill, { provenBy: pillShown, message: 'no number on the send key when the price read fails' })
        await expect(send).toHaveText('')
        await expect(send).toBeEnabled()
        await frame(mode === 'hang' ? 'error-timeout' : 'error-500')
        record[`task5-${mode}`] = { model, unknown: true }
      }

      // 最长的数：Seedance 2.0（标准版，Mini / Fast 只到 720P）最贵的规格 1080P × 最长时长 15 秒 = 14.63 积分；
      // 数字一行、不出浮框，摘要不压工具（setParam 里核）。接着任务 5 的超时：那次读空已把缓存删掉，撤掉故障后改参数就重新读价。
      FAILING.delete('seedance-2.0')
      await setParam('resolution', '1080p')
      await setParam('duration', 15)
      await expect(pill, 'board:ModelSurfaces/cost.send-pill').toHaveText(credits(0.0975 * 15), { timeout: stationTimeout() })
      const fits = async (label) => {
        const [box, pillBox, sendBox, lastTool] = [await composer.boundingBox(), await pill.boundingBox(), await send.boundingBox(),
          await composer.locator('[data-prompt-tool]').last().boundingBox()]
        assert(pillBox && pillBox.height < 24, `${label}: the number stays on one line (${pillBox?.height})`)
        assert(box && sendBox && sendBox.x + sendBox.width <= box.x + box.width + 0.5, `${label}: the send key stays inside the composer`)
        assert(lastTool && sendBox && lastTool.x + lastTool.width <= sendBox.x + 0.5, `${label}: the prompt tools end before the send key`)
        return box
      }
      const wideBox = await fits('longest')
      await frame('longest')
      // 最窄：生成浮框宽恒为 NODE_COMPOSER_WIDTH，不随节点和窗口变；页面收到 700 宽再核一遍同一帧。
      // 启动器把内容区钉在 ACCEPTANCE_VIEWPORT（Playwright 视口），改原生窗口大小不动 innerWidth，要改视口本身。
      await win.setViewportSize({ width: 700, height: 720 })
      await expect.poll(() => win.evaluate(() => window.innerWidth), { timeout: stationTimeout() }).toBeLessThan(720)
      // 视口收窄后浮框还在原处、右半截出了窗口；真人会把画布拖过来再看——照做（中键拖，同 panCanvasUntilInside），拖不进来也照实记。
      // 左右只留 8（700 宽里舞台放不下 600 的浮框再加左缘 72）；下面照默认留 72，让开右下角常驻钮和缩放条，不然截出来发送键被常驻钮盖住。
      const narrowPan = await panCanvasUntilInside(win, composer, { margin: { left: 8, right: 8, top: 8 } })
      await summaryClearOfTools('narrow window')
      const narrowBox = await fits('narrow')
      const sendReachable = await send.first().evaluate((el) => {
        const r = el.getBoundingClientRect()
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
        return Boolean(hit && el.contains(hit))
      })
      assert(sendReachable, 'narrow: after panning the composer into view, nothing covers the send key')
      assert(Math.abs(narrowBox.width - wideBox.width) < 1, `composer keeps its width in a narrow window: ${wideBox.width} → ${narrowBox.width}`)
      await frame('narrow')
      record.longest = { pill: await pill.innerText(), composerWidth: wideBox.width, narrowComposerWidth: narrowBox.width, narrowPan: { ok: narrowPan.ok, reason: narrowPan.reason ?? null } }
      await win.setViewportSize(ACCEPTANCE_VIEWPORT)
      await expect.poll(() => win.evaluate(() => window.innerWidth), { timeout: stationTimeout() }).toBeGreaterThan(1000)

      // 任务 6：只看价格 → 假服务非 GET 0 次、授权 0 条。
      assert.equal(nonGet(), explicitSends, 'viewing prices sent no generation request')
      assert.equal(spendApprovals(root), 0, 'viewing prices created no spend approval')
      record.task6 = { nonGet: nonGet() - explicitSends, approvals: spendApprovals(root) }

      // 真点一次发送：换回有价的型号，停在确认就取消；没有确认直接发出 → 假服务扣着不回的这几秒就是「生成中」。
      await pick(/^Seedance 2\.0 Mini$/, 'Seedance 2.0 Mini (send)')
      await expect(pill, 'board:ModelSurfaces/cost.send-pill').toBeVisible({ timeout: stationTimeout() })
      await expect(send).toBeEnabled()
      const postsBefore = nonGet()
      await clickOrFail(send, 'click send once')
      const dialog = win.locator('[data-spend-confirm-dialog]').first()
      await expect.poll(async () => (await dialog.isVisible()) || nonGet() > postsBefore, { timeout: stationTimeout() }).toBe(true)
      if (await dialog.isVisible()) {
        await screenshotSettled(win, { path: shot(locale, 'send-confirm') })
        await clickOrFail(dialog.locator('[data-spend-confirm-action="cancel"]'), 'cancel spend confirmation')
        record.send = 'confirm-cancelled'
      } else {
        // 生成中：键照主干忙态画，不印约价。
        await expect(send, 'board:ModelSurfaces/cost.send-pill').toHaveAttribute('aria-busy', 'true', { timeout: stationTimeout() })
        await expectAbsent(pill, { provenBy: pillShown, message: 'no estimate on the send key while generating' })
        await frame('generating')
        assert.equal(await send.getAttribute('aria-busy'), 'true', 'still generating when the frame was taken')
        record.generating = { text: await send.innerText(), busy: await send.getAttribute('aria-busy') }
        await expect(send).not.toHaveAttribute('aria-busy', 'true', { timeout: stationTimeout() })
        await screenshotSettled(win, { path: shot(locale, 'send-fake-upstream') })
        record.send = 'sent-to-fake-upstream'
      }
      explicitSends += nonGet() - postsBefore
      results.push(record)
    } catch (error) {
      record.error = String(error?.stack ?? error)
      results.push(record)
      await screenshotSettled(win, { path: shot(locale, 'failure') }).catch(() => undefined)
      throw error
    } finally {
      await app.close()
      fs.rmSync(root, { recursive: true, force: true })
    }
  }
  assert.equal(nonGet(), explicitSends, 'non-GET only from the explicit send click')
  if (perfFile) fs.writeFileSync(perfFile, JSON.stringify({ runs, noisy: os.loadavg()[0] >= 10, metrics: BASELINE ? { paramUi: paramUiMs } : { response: pricedUpdateMs, paramUi: paramUiMs } }))
} finally {
  fs.writeFileSync(path.join(output, `receipt${scheme === 'dark' ? '-dark' : ''}.json`), JSON.stringify({ results, reads: calls, explicitSends, pricedUpdateMs, paramUiMs }, null, 2))
  server.closeAllConnections()
  server.close()
}
