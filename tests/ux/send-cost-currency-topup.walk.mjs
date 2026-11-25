// 发送键旁约价单位切换（积分 / 人民币 / 美元，都标「约」，参考汇率带出处与日期）+ 余额不够同一行「还差 N 积分 · 去充值」真窗口走查。
// 板 ModelSurfaces：cost.send-pill / cost.hover / cost.low-balance。
//
// 真实条件：隔离资料目录 + 打包同构 Electron + 本机回环假 APIMart（NOMI_TEST_NETWORK_GUARD=1，所有非 GET 一律 405，零花费）。
// 覆盖：
//   1. 默认积分态（约 1.95 / ~1.95，带硬币图标）
//   2. 点开单位切换菜单（积分 / 人民币 / 美元三项实时约数 + 参考汇率出处与日期，汇率数与日期只读 sendCostFormat.ts 那一份）
//   3. 切到人民币（约 ¥x / ~¥x，x = 0.195 × 参考汇率）+ 悬停提示（含汇率出处日期，且按句分行无句中断行）
//   4. 切到美元（约 $0.195 / ~$0.195）
//   5. 余额不足态（板 ModelSurfaces cost.low-balance）：假余额 7.03 积分 vs Seedance 2.0 1080p 15s = 14.63 积分 →
//      发送键位置换成「还差 7.6 积分 · 去充值 ↗」（英文 Short 7.6 credits · Top up ↗），点「去充值」触发官方带邀请码外链且 0 生成 POST；
//      充值后假余额升到 50 积分并触发窗口 focus，自动恢复正常发送键！
//
// 用法：pnpm run build && NOMI_TEST_NETWORK_GUARD=1 node tests/ux/send-cost-currency-topup.walk.mjs
import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { once } from 'node:events'
import { expect } from '@playwright/test'
import { launchNomiApp } from './_launchApp.mjs'
import { buildWorld } from './_world.mjs'
import { clickOrFail, expectAbsent, expectVisible, proveProbe, screenshotSettled } from './_assert.mjs'
import { stationTimeout } from './_station-budget.mjs'
import { addCanvasNode, newProjectEntry, switchWorkspace } from './_shell.mjs'
import { uiText, uiTextWith } from './full-walk/invariants.mjs'
import { badBreaks } from './_sentenceBreaks.mjs'

// 参考汇率与日期的唯一一份在 sendCostFormat.ts；走查只从那里读，不另抄一个数。
const FX_OWNER = fs.readFileSync(path.resolve('src/workbench/generationCanvas/spend/sendCostFormat.ts'), 'utf8')
const FX_RATE = Number(FX_OWNER.match(/BUILTIN_USD_TO_CNY_RATE = ([\d.]+)/)?.[1])
const FX_DATE = FX_OWNER.match(/BUILTIN_USD_TO_CNY_DATE = '([\d-]+)'/)?.[1]
assert(Number.isFinite(FX_RATE) && FX_DATE, 'read FX rate/date from sendCostFormat.ts')

const output = path.resolve(process.env.NOMI_SEND_COST_T1_EVIDENCE || 'docs/evidence/2026-11-22-send-cost-currency-topup')
fs.mkdirSync(output, { recursive: true })
const onlyLocale = process.env.NOMI_SEND_COST_T1_LOCALE
const RUNS = onlyLocale
  ? [{ locale: onlyLocale, scheme: process.env.NOMI_SURFACE_SCHEME === 'dark' ? 'dark' : 'light' }]
  : [
      { locale: 'zh-CN', scheme: 'light' },
      { locale: 'en', scheme: 'light' },
      { locale: 'zh-CN', scheme: 'dark' },
    ]

const VIDEO_RATES = {
  'seedance-2.0-mini': { '480P': 0.02, '720P': 0.039 },
  'seedance-2.0': { '480P': 0.02, '720P': 0.039, '1080P': 0.0975 },
}

let currentBalanceCredits = 50
const calls = []
const server = http.createServer((req, res) => {
  const target = new URL(req.url, 'http://127.0.0.1')
  calls.push({ method: req.method, path: target.pathname, model: target.searchParams.get('model') })
  if (req.method !== 'GET') {
    res.statusCode = 405
    res.end('{"success":false}')
    return
  }
  res.setHeader('Content-Type', 'application/json')
  // 发送键旁读的是账户余额（main 上 vendorAccountBalance.readVendorAccountBalance → APIMART accountBalance.userBalancePath）；
  // Key 额度 /v1/balance 只给接入页「再查一次」用，这条走查不走那条。
  if (target.pathname === '/v1/user/balance') {
    res.end(JSON.stringify({
      success: true,
      remain_credits: currentBalanceCredits,
      remain_balance: currentBalanceCredits / 10,
    }))
    return
  }
  if (target.pathname === '/api/pricing/model') {
    const model = target.searchParams.get('model')
    if (VIDEO_RATES[model]) {
      res.end(JSON.stringify({
        success: true,
        data: {
          model_name: model,
          billing_type: 'per_second',
          membership: { category: 'video' },
          resolution_enabled: true,
          resolution_paid_prices: VIDEO_RATES[model],
        },
      }))
      return
    }
    res.end(JSON.stringify({ success: false }))
    return
  }
  res.statusCode = 404
  res.end(JSON.stringify({ success: false }))
})
server.listen(0, '127.0.0.1')
await once(server, 'listening')
const origin = `http://127.0.0.1:${server.address().port}`

const readTipLines = (tip) => tip.evaluate((el) => {
  const copy = el.cloneNode(true)
  for (const hidden of copy.querySelectorAll('[role="tooltip"]')) hidden.remove()
  const visibleText = (copy.textContent ?? '').replace(/\s+/g, ' ').trim()
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.parentElement?.closest('[role="tooltip"]') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  })
  const chars = []
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    for (let i = 0; i < n.data.length; i += 1) {
      const r = document.createRange()
      r.setStart(n, i)
      r.setEnd(n, i + 1)
      const b = r.getClientRects()[0]
      chars.push({ ch: n.data[i], rect: b ? { t: b.top, b: b.bottom, w: b.width, h: b.height } : null })
    }
  }
  const lines = []
  for (const c of chars) {
    if (!c.rect || (c.rect.w === 0 && /\s/.test(c.ch))) {
      if (lines.length) lines.at(-1).trail += c.ch
      continue
    }
    const last = lines.at(-1)
    if (!last || c.rect.t >= last.b - c.rect.h / 2) {
      if (last) {
        last.text += last.trail
        last.trail = ''
      }
      lines.push({ text: '', trail: '', b: c.rect.b })
    }
    const line = lines.at(-1)
    line.text += line.trail + c.ch
    line.trail = ''
    line.b = Math.max(line.b, c.rect.b)
  }
  for (const l of lines) l.text += l.trail
  return { visibleText, lines: lines.map((l) => l.text) }
})

const launchWithApimartKey = async (locale, scheme, tag) => {
  const world = buildWorld({ projects: [] })
  const options = {
    name: `send-cost-t1-${tag}-${locale}-${scheme}`,
    world,
    syntheticCredentialStorage: true,
    env: { NOMI_TEST_NETWORK_REDIRECTS: JSON.stringify([{ from: 'https://api.apimart.ai', to: origin }]) },
    initialLocalStorage: {
      'nomi-color-scheme': scheme,
      'nomi:locale:v1': locale,
      'nomi:splash:v1': 'seen',
      'nomi:journey-tour:v1': 'seen',
      'nomi-onboarding-checklist:v1': 'seen',
      'nomi:canvas-gesture-hint:v1': 'seen',
    },
  }
  const session = await launchNomiApp(options)
  await session.win.evaluate(async () => {
    await window.nomiDesktop.modelCatalog.upsertVendorApiKey('apimart', { apiKey: 'nomi-e2e-placeholder', enabled: true })
  })
  await session.win.reload({ waitUntil: 'domcontentloaded' })
  await expectVisible(newProjectEntry(session.win), 'library after APIMart key seed')
  return { ...session, world }
}

const summary = []
try {
  for (const { locale, scheme } of RUNS) {
    currentBalanceCredits = 50
    const suffix = scheme === 'dark' ? '-dark' : ''
    const shotPath = (name) => path.join(output, `${locale}-${name}${suffix}.png`)
    const { app, win, world } = await launchWithApimartKey(locale, scheme, 'main')
    const rec = { locale, scheme }
    try {
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1240, 840))
      // 拦截 window.open 记录充值外链，避免真弹窗打断测试。
      await win.evaluate(() => {
        window.__openedTopUpUrls = []
        window.open = (url) => {
          window.__openedTopUpUrls.push(String(url))
          return null
        }
      })
      await clickOrFail(newProjectEntry(win), 'new project')
      await switchWorkspace(win, 'generation')
      await addCanvasNode(win, 'video')
      const composer = win.locator('[data-composer-host="canvas"]:visible').last()
      await composer.locator('[data-prompt-box] .ProseMirror').first().fill(
        locale === 'en' ? 'An orange cat jumps down from the windowsill' : '橘猫从窗台跳下，镜头跟着落地',
      )

      const pickModel = async (pattern, label) => {
        const picker = composer.getByRole('button', { name: uiText(locale, 'generationCommon.parameters.model'), exact: true })
        const menu = win.locator('[data-nomi-select-dropdown]:visible').first()
        await clickOrFail(picker, `open model picker for ${label}`)
        const more = menu.getByRole('button', { name: uiText(locale, 'onboardingProviders.modelControls.more'), exact: true })
        const row = menu.getByRole('option').filter({ has: win.locator('[data-nomi-select-option-label]', { hasText: pattern }) }).first()
        const open = await proveProbe(menu, 'model menu open')
        if (!(await row.isVisible()) && await more.isVisible().catch(() => false)) await clickOrFail(more, 'expand more models')
        await clickOrFail(row, `pick ${label}`)
        await expectAbsent(menu, { provenBy: open, message: 'model menu closed' })
      }
      const setParam = async (key, value) => {
        await clickOrFail(composer.locator('[data-parameter-summary]').first(), `open params for ${key}`)
        const control = win.locator(`[data-agent-parameter-control="${key}"]`).first()
        await expectVisible(control, `param ${key}`)
        if (typeof value === 'number') {
          const thumb = control.getByRole('slider').first()
          if (Number(await thumb.getAttribute('aria-valuenow')) !== value) {
            const min = Number(await thumb.getAttribute('aria-valuemin'))
            const max = Number(await thumb.getAttribute('aria-valuemax'))
            const box = await control.locator('.mantine-Slider-track').first().boundingBox()
            await win.mouse.click(box.x + box.width * (value - min) / (max - min), box.y + box.height / 2)
            await expect(thumb).toHaveAttribute('aria-valuenow', String(value), { timeout: stationTimeout() })
          }
        } else {
          await control.getByRole('radio', { name: value, exact: true }).first().click()
        }
        await win.keyboard.press('Escape')
      }

      // 1) Seedance 2.0 Mini · 5s 720p → 1.95 积分 / ¥(0.195 × 参考汇率) / $0.195
      await pickModel(/^Seedance 2\.0 Mini$/, 'Seedance 2.0 Mini')
      await setParam('duration', 5)
      await setParam('resolution', '720p')

      const unitBtn = composer.locator('[data-send-cost="credits"]')
      const expectedCredits = '1.95'
      const cnyPure = `¥${(0.195 * FX_RATE).toFixed(2)}`
      const ratePair = `$1 ≈ ¥${FX_RATE}`
      await expect(unitBtn, 'board:ModelSurfaces/cost.send-pill').toHaveText(expectedCredits, { timeout: stationTimeout() })
      await expect(unitBtn).toHaveAttribute('data-send-cost-unit', 'credits')

      await screenshotSettled(win, { path: shotPath('credits') })

      // 2) 点开单位切换菜单（紧凑 3 行、顶部一次「预计/Estimated」、右侧蓝勾、无底部空分组长句、宽度 <= 180px）
      await clickOrFail(unitBtn, 'open send cost unit menu')
      await expect(unitBtn).toHaveAttribute('data-state', 'open')
      const menuPanel = win.locator('[role="menu"]').first()
      await expectVisible(menuPanel, 'unit menu panel')
      const cnyOption = win.locator('[data-menu-item="send-cost-unit-cny"]').first()
      const usdOption = win.locator('[data-menu-item="send-cost-unit-usd"]').first()
      const creditsOption = win.locator('[data-menu-item="send-cost-unit-credits"]').first()
      await expectVisible(cnyOption, 'CNY option in unit menu')
      await expectVisible(usdOption, 'USD option in unit menu')

      const heading = menuPanel.locator('[data-menu-label]')
      await expect(heading).toHaveCount(1)
      await expect(heading.first()).toHaveText(uiText(locale, 'generationCommon.composer.sendCost.unitMenuHeading'))
      await expect(menuPanel.locator('[role="separator"]')).toHaveCount(0)
      await expect(menuPanel.locator('[data-menu-shortcut]')).toHaveCount(0)
      await expect(creditsOption.locator('[data-menu-trailing]')).toHaveText('1.95')
      await expect(cnyOption.locator('[data-menu-trailing]')).toHaveText(cnyPure)
      await expect(usdOption.locator('[data-menu-trailing]')).toHaveText('$0.195')

      const menuMetrics = await menuPanel.evaluate((panel) => {
        const toRgba = (cssColor) => {
          const c = document.createElement('canvas')
          c.width = 1
          c.height = 1
          const ctx = c.getContext('2d')
          ctx.fillStyle = cssColor
          ctx.fillRect(0, 0, 1, 1)
          return [...ctx.getImageData(0, 0, 1, 1).data]
        }
        const box = panel.getBoundingClientRect()
        const rows = ['send-cost-unit-credits', 'send-cost-unit-cny', 'send-cost-unit-usd'].map((id) => {
          const el = panel.querySelector(`[data-menu-item="${id}"]`)
          const label = el.querySelector('[data-menu-label-text]').getBoundingClientRect()
          const trailing = el.querySelector('[data-menu-trailing]').getBoundingClientRect()
          const svg = el.querySelector('svg')
          const sr = svg ? svg.getBoundingClientRect() : null
          return {
            id,
            labelLeft: label.left,
            trailingRight: trailing.right,
            svgLeft: sr ? sr.left : null,
            svgWidth: sr ? sr.width : null,
            svgRgba: svg ? toRgba(getComputedStyle(svg).color) : null,
          }
        })
        const probe = document.createElement('span')
        probe.style.color = 'var(--nomi-accent)'
        document.body.appendChild(probe)
        const accentRgba = toRgba(getComputedStyle(probe).color)
        probe.remove()
        return { width: box.width, height: box.height, rows, accentRgba }
      })
      assert(menuMetrics.width <= 180, `unit menu width ${menuMetrics.width}px exceeds compact ceiling 180px`)
      assert(Math.abs(menuMetrics.rows[0].labelLeft - menuMetrics.rows[1].labelLeft) <= 0.5, 'selected and unselected labels align on left')
      assert(Math.abs(menuMetrics.rows[0].trailingRight - menuMetrics.rows[1].trailingRight) <= 0.5, 'selected and unselected trailing values align on right')
      assert(menuMetrics.rows[0].svgLeft >= menuMetrics.rows[0].trailingRight - 0.5, 'checkmark renders to the right of trailing value')
      assert(Math.abs(menuMetrics.rows[0].svgWidth - 14) <= 0.5, `checkmark SVG width is 14px (got ${menuMetrics.rows[0].svgWidth})`)
      assert(
        menuMetrics.rows[0].svgRgba.every((v, i) => Math.abs(v - menuMetrics.accentRgba[i]) <= 1),
        `checkmark RGBA ${JSON.stringify(menuMetrics.rows[0].svgRgba)} matches --nomi-accent ${JSON.stringify(menuMetrics.accentRgba)}`,
      )
      rec.unitMenuWidth = Math.round(menuMetrics.width * 10) / 10
      await screenshotSettled(win, { path: shotPath('unit-menu') })

      // 3) 切到人民币（紧凑 ≈¥1.31）+ 悬停核对（含参考汇率出处日期、3 短行、宽度 <= 460px、G7 按句换行）
      await clickOrFail(cnyOption, 'switch to CNY')
      const expectedCny = `≈${cnyPure}`
      await expect(unitBtn).toHaveText(expectedCny, { timeout: stationTimeout() })
      await expect(unitBtn).toHaveAttribute('data-send-cost-unit', 'cny')
      await win.mouse.move(20, 20, { steps: 2 })
      await unitBtn.hover()
      const tip = win.locator('[data-send-cost-hover]').first()
      await expect(tip, 'board:ModelSurfaces/cost.hover').toBeVisible({ timeout: stationTimeout() })
      await win.waitForTimeout(300)
      const cnyTip = await readTipLines(tip)
      const tipBox = await tip.boundingBox()
      const maxTipWidth = locale === 'en' ? 540 : 460
      assert(tipBox && tipBox.width <= maxTipWidth, `CNY tooltip width ${tipBox?.width}px exceeds ceiling ${maxTipWidth}px`)
      assert.equal(
        cnyTip.visibleText,
        uiTextWith(locale, 'generationCommon.composer.sendCost.estimateCny', {
          cny: cnyPure,
          value: '1.95',
          date: FX_DATE,
          pair: ratePair,
        }),
      )
      assert(cnyTip.visibleText.includes(FX_DATE), `CNY tooltip includes rate date: ${cnyTip.visibleText}`)
      assert.deepEqual(badBreaks(cnyTip.lines), [], `CNY tooltip breaks cleanly at sentence boundaries: ${JSON.stringify(cnyTip.lines)}`)
      rec.cnyHover = cnyTip.visibleText
      rec.cnyHoverWidth = Math.round(tipBox.width * 10) / 10
      await screenshotSettled(win, { path: shotPath('cny-hover') })
      await win.mouse.move(20, 20, { steps: 4 })

      // 4) 切到美元（紧凑 ≈$0.195）
      await clickOrFail(unitBtn, 'reopen unit menu for USD')
      await clickOrFail(win.locator('[data-menu-item="send-cost-unit-usd"]').first(), 'switch to USD')
      const expectedUsd = '≈$0.195'
      await expect(unitBtn).toHaveText(expectedUsd, { timeout: stationTimeout() })
      await expect(unitBtn).toHaveAttribute('data-send-cost-unit', 'usd')
      await screenshotSettled(win, { path: shotPath('usd') })

      // 切回积分
      await clickOrFail(unitBtn, 'reopen unit menu for credits')
      await clickOrFail(win.locator('[data-menu-item="send-cost-unit-credits"]').first(), 'switch back to credits')
      await expect(unitBtn).toHaveText(expectedCredits, { timeout: stationTimeout() })

      // 5) 余额不足（board:ModelSurfaces/cost.low-balance）：
      //    余额设为 7.03 积分，切换到 Seedance 2.0 1080p 15s（14.625 积分）→ 差额 7.6 积分 → 「还差 7.6 积分 · 去充值 ↗」
      await pickModel(/^Seedance 2\.0$/, 'Seedance 2.0')
      await setParam('resolution', '1080p')
      await setParam('duration', 15)
      const fullCost = '14.63'
      await expect(unitBtn).toHaveText(fullCost, { timeout: stationTimeout() })
      if (locale === 'zh-CN') {
        const modeChipText = (await composer.locator('[data-bar-segment="model-params"] button[aria-haspopup="listbox"]').nth(1).innerText()).trim()
        assert(modeChipText.length > 0, `zh-CN mode chip stays visible alongside compact 14.63 pill (got "${modeChipText}")`)
        rec.zhModeChipWithLongestCredits = modeChipText
      }

      // 模拟余额掉到 7.03 积分并通过用户切回窗口触发重读（先标记或重新打开新卡场景：用新窗口或等余额刷新；
      // 这里走真实用户路径：把余额切到 7.03 并在第二段干净窗口里打开，再点「去充值」→ 余额补到 50 → focus 自动恢复！）
      currentBalanceCredits = 7.03
      await app.close()
      world.cleanup()

      const lowSession = await launchWithApimartKey(locale, scheme, 'low')
      try {
        const w2 = lowSession.win
        await lowSession.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1240, 840))
        await w2.evaluate(() => {
          window.__openedTopUpUrls = []
          window.open = (url) => {
            window.__openedTopUpUrls.push(String(url))
            return null
          }
        })
        await clickOrFail(newProjectEntry(w2), 'new project (low balance)')
        await switchWorkspace(w2, 'generation')
        await addCanvasNode(w2, 'video')
        const c2 = w2.locator('[data-composer-host="canvas"]:visible').last()
        await c2.locator('[data-prompt-box] .ProseMirror').first().fill(
          locale === 'en' ? 'An orange cat jumps down from the windowsill' : '橘猫从窗台跳下，镜头跟着落地',
        )
        const pick2 = async (pattern) => {
          const picker = c2.getByRole('button', { name: uiText(locale, 'generationCommon.parameters.model'), exact: true })
          const menu = w2.locator('[data-nomi-select-dropdown]:visible').first()
          await clickOrFail(picker, 'open model picker (low)')
          const more = menu.getByRole('button', { name: uiText(locale, 'onboardingProviders.modelControls.more'), exact: true })
          const row = menu.getByRole('option').filter({ has: w2.locator('[data-nomi-select-option-label]', { hasText: pattern }) }).first()
          const open = await proveProbe(menu, 'model menu open (low)')
          if (!(await row.isVisible()) && await more.isVisible().catch(() => false)) await clickOrFail(more, 'expand more (low)')
          await clickOrFail(row, 'pick Seedance 2.0 (low)')
          await expectAbsent(menu, { provenBy: open, message: 'model menu closed (low)' })
        }
        const setParam2 = async (key, value) => {
          await clickOrFail(c2.locator('[data-parameter-summary]').first(), `open params (low) ${key}`)
          const control = w2.locator(`[data-agent-parameter-control="${key}"]`).first()
          await expectVisible(control, `param (low) ${key}`)
          if (typeof value === 'number') {
            const thumb = control.getByRole('slider').first()
            const min = Number(await thumb.getAttribute('aria-valuemin'))
            const max = Number(await thumb.getAttribute('aria-valuemax'))
            const box = await control.locator('.mantine-Slider-track').first().boundingBox()
            await w2.mouse.click(box.x + box.width * (value - min) / (max - min), box.y + box.height / 2)
            await expect(thumb).toHaveAttribute('aria-valuenow', String(value), { timeout: stationTimeout() })
          } else {
            await control.getByRole('radio', { name: value, exact: true }).first().click()
          }
          await w2.keyboard.press('Escape')
        }
        await pick2(/^Seedance 2\.0$/)
        await setParam2('resolution', '1080p')
        await setParam2('duration', 15)

        const lowRow = c2.locator('[data-send-cost-low-balance]')
        const shortfall = c2.locator('[data-send-cost="shortfall"]')
        const topUpBtn = c2.locator('[data-send-cost-action="top-up"]')
        await expect(lowRow, 'board:ModelSurfaces/cost.low-balance').toBeVisible({ timeout: stationTimeout() })
        await expect(shortfall, 'board:ModelSurfaces/cost.low-balance').toHaveText(
          uiTextWith(locale, 'generationCommon.composer.sendCostLowBalance.shortfall', { value: '7.6' }),
          { timeout: stationTimeout() },
        )
        await expect(topUpBtn, 'board:ModelSurfaces/cost.low-balance').toHaveText(
          uiText(locale, 'generationCommon.composer.sendCostLowBalance.topUp'),
        )
        const shortfallColorOk = await shortfall.evaluate((el) => {
          const toRgba = (cssColor) => {
            const c = document.createElement('canvas')
            c.width = 1
            c.height = 1
            const ctx = c.getContext('2d')
            ctx.fillStyle = cssColor
            ctx.fillRect(0, 0, 1, 1)
            return [...ctx.getImageData(0, 0, 1, 1).data]
          }
          const probe = document.createElement('span')
          probe.style.color = 'var(--nomi-warning-ink)'
          document.body.appendChild(probe)
          const want = toRgba(getComputedStyle(probe).color)
          probe.remove()
          const actual = toRgba(getComputedStyle(el).color)
          return actual.every((v, i) => Math.abs(v - want[i]) <= 1)
        })
        assert(shortfallColorOk, 'shortfall uses --nomi-warning-ink for WCAG AA contrast')
        await screenshotSettled(w2, { path: shotPath('low-balance') })
        rec.lowBalance = {
          shortfall: (await shortfall.innerText()).trim(),
          topUp: (await topUpBtn.innerText()).trim(),
        }

        // 点「去充值」打开带邀请码外链；充值后余额升至 50 并触发 focus，自动切回正常发送键！
        await clickOrFail(topUpBtn, 'click top up button')
        const openedUrls = await w2.evaluate(() => window.__openedTopUpUrls)
        assert.deepEqual(openedUrls, ['https://apimart.ai/register?aff=t55VtP'], `top-up opened official affiliate URL: ${JSON.stringify(openedUrls)}`)
        currentBalanceCredits = 50
        await w2.evaluate(() => window.dispatchEvent(new Event('focus')))
        await expect(c2.locator('[data-send-cost="credits"]'), 'recovered to normal send pill after top-up focus').toHaveText(fullCost, { timeout: stationTimeout() })
        rec.recoveredAfterTopUp = true
      } finally {
        await lowSession.app.close()
        lowSession.world.cleanup()
      }
      summary.push(rec)
    } catch (error) {
      rec.error = String(error?.stack ?? error)
      summary.push(rec)
      await app.close().catch(() => undefined)
      world.cleanup()
      throw error
    }
  }
  assert.equal(calls.filter((c) => c.method !== 'GET').length, 0, 'zero non-GET generation requests during walkthrough')
} finally {
  server.closeAllConnections()
  server.close()
}
console.log('PASS send-cost-currency-topup walkthrough:', JSON.stringify(summary, null, 2))
