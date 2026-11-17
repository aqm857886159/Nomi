// 画布生成浮框底栏：开参数面板 → 改一个值 → Esc，连做 3 次，中英各一遍；每次关面板后底栏一行里相邻控件不相压、
// 参数条里没有东西出界（方向检查 docs/engineering/direction-checks/2026-11-17-bar-yield.md 第 8 节第 2 条）。
// 真 Electron、隔离资料目录、内置 APIMart 目录；APIMart 的地址指到本机回环假服务（什么都不回），不出网、不花钱、不发生成。
//
// 截图（SHOTS_DIR，缺省 .tmp/composer-bar-yield/app）：
//   a-<lang>-open-10s：600 宽底栏，面板开着、时长刚改成 10s 的那一刻；b-<lang>-closed：同上按 Esc 之后；
//   e-<lang>-after-three：连改三次之后的静止态。
// 用法：先 pnpm run build；node tests/ux/composer-bar-yield-cycle.walk.mjs   （COMPOSER_BAR_YIELD_LOCALE=en 只跑一种语言）
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { once } from 'node:events'
import { expect } from '@playwright/test'
import { makeTempDir } from '../../scripts/_test-temp.mjs'
import { launchNomiApp, seedSavedFixtureCredentials } from './_launchApp.mjs'
import { clickOrFail, expectAbsent, expectVisible, proveProbe, screenshotSettled } from './_assert.mjs'
import { stationTimeout } from './_station-budget.mjs'
import { addCanvasNode, newProjectEntry, switchWorkspace } from './_shell.mjs'
import { uiText } from './full-walk/invariants.mjs'

const output = path.resolve(process.env.SHOTS_DIR || '.tmp/composer-bar-yield/app')
fs.mkdirSync(output, { recursive: true })
const LOCALES = process.env.COMPOSER_BAR_YIELD_LOCALE ? [process.env.COMPOSER_BAR_YIELD_LOCALE] : ['en', 'zh-CN']
const lang = (locale) => (locale === 'en' ? 'en' : 'zh')

// 假 APIMart：目录是内置的，这里只把启动时的读请求接住（一律「没有」），保证整趟不出网。
const calls = []
const server = http.createServer((req, res) => {
  calls.push({ method: req.method, path: new URL(req.url, 'http://127.0.0.1').pathname })
  res.statusCode = req.method === 'GET' ? 404 : 405
  res.setHeader('Content-Type', 'application/json')
  res.end('{"success":false}')
})
server.listen(0, '127.0.0.1')
await once(server, 'listening')
const origin = `http://127.0.0.1:${server.address().port}`

/** 底栏一行的事实：参数条里出界的格、相邻控件相压的对、让级、摘要（一次读完）。 */
const readBar = (composer) => composer.locator('[data-node-composer-footer]').first().evaluate((footer) => {
  const bar = footer.querySelector('[data-bar-segment="model-params"] > *')
  const right = bar.getBoundingClientRect().right
  const items = [...bar.querySelectorAll('[data-yield-item]')]
  const named = (el) => el.getAttribute('data-bar-segment') ?? el.getAttribute('data-parameter-summary') ?? 'model+mode'
  const row = [...items, footer.querySelector('[data-bar-segment="prompt-tools"]'), footer.querySelector('[data-bar-segment="generate"]')].filter(Boolean)
    .map((el) => ({ name: named(el), box: el.getBoundingClientRect() })).sort((a, b) => a.box.left - b.box.left)
  return {
    level: footer.getAttribute('data-bar-yield-level'),
    summary: footer.querySelector('[data-parameter-summary]')?.getAttribute('data-parameter-summary') ?? null,
    out: items.filter((el) => el.getBoundingClientRect().right > right + 0.5).map(named),
    pressed: row.slice(1).filter((cur, index) => row[index].box.right > cur.box.left + 0.5).map((cur, index) => `${row[index].name} ⟂ ${cur.name}`),
    width: Math.round(footer.getBoundingClientRect().width),
  }
})

const results = []
let failed = false
try {
  for (const locale of LOCALES) {
    const root = makeTempDir('nomi-bar-yield-')
    const settingsDir = path.join(root, 'settings')
    fs.mkdirSync(settingsDir, { recursive: true })
    const options = {
      name: `composer-bar-yield-${locale}`, userDataDir: settingsDir, settingsDir, projectsDir: path.join(root, 'projects'),
      syntheticCredentialStorage: true,
      env: { NOMI_TEST_NETWORK_REDIRECTS: JSON.stringify([{ from: 'https://api.apimart.ai', to: origin }]) },
      initialLocalStorage: { 'nomi-color-scheme': 'light', 'nomi:locale:v1': locale, 'nomi:splash:v1': 'seen', 'nomi:journey-tour:v1': 'seen',
        'nomi-onboarding-checklist:v1': 'seen', 'nomi:canvas-gesture-hint:v1': 'seen' },
    }
    fs.mkdirSync(options.projectsDir, { recursive: true })
    await seedSavedFixtureCredentials(options, ['apimart'])
    const { app, win } = await launchNomiApp(options)
    const record = { locale, cycles: [], failures: [] }
    const shot = (name) => path.join(output, `${name}.png`)
    /** 截生成浮框（面板开着就连面板一起）。 */
    const shotComposer = async (name) => {
      const clip = await win.evaluate(() => {
        const boxes = [document.querySelector('.generation-canvas-v2-node__composer-card'), document.querySelector('[data-agent-parameter-panel]')]
          .filter(Boolean).map((el) => el.getBoundingClientRect()).filter((r) => r.width > 0)
        const left = Math.max(0, Math.min(...boxes.map((r) => r.left)) - 12); const top = Math.max(0, Math.min(...boxes.map((r) => r.top)) - 12)
        return { x: left, y: top, width: Math.min(window.innerWidth, Math.max(...boxes.map((r) => r.right)) + 12) - left, height: Math.min(window.innerHeight, Math.max(...boxes.map((r) => r.bottom)) + 12) - top }
      })
      await screenshotSettled(win, { path: shot(name), clip })
    }
    try {
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1220, 840))
      await clickOrFail(newProjectEntry(win), 'new project')
      await switchWorkspace(win, 'generation')
      await addCanvasNode(win, 'video')
      const composer = win.locator('[data-composer-host="canvas"]:visible').last()
      const summaryButton = composer.locator('[data-parameter-summary]').first()
      const panel = win.locator('[data-agent-parameter-panel]').first()
      const picker = composer.getByRole('button', { name: uiText(locale, 'generationCommon.parameters.model'), exact: true })
      const menu = win.locator('[data-nomi-select-dropdown]:visible').first()
      // Seedance 2.0 Mini：摘要三个值（比例 · 清晰度 · 时长），时长是滑杆。
      await clickOrFail(picker, 'open model picker')
      const menuOpen = await proveProbe(menu, 'model menu is open')
      const more = menu.getByRole('button', { name: uiText(locale, 'onboardingProviders.modelControls.more'), exact: true })
      const row = menu.getByRole('option').filter({ has: win.locator('[data-nomi-select-option-label]', { hasText: /^Seedance 2\.0 Mini$/ }) }).first()
      if (!(await row.isVisible()) && await more.isVisible().catch(() => false)) await clickOrFail(more, 'expand more models')
      await clickOrFail(row, 'pick Seedance 2.0 Mini')
      await expectAbsent(menu, { provenBy: menuOpen, message: 'model menu closes after picking' })

      let panelShown = null
      const openPanel = async () => {
        await clickOrFail(summaryButton, 'open parameters')
        await expectVisible(panel, 'parameter panel')
        panelShown = await proveProbe(panel, 'parameter panel is open')
      }
      const closePanel = async () => {
        await win.keyboard.press('Escape')
        await expectAbsent(win.locator('[data-agent-parameter-panel]'), { provenBy: panelShown, message: 'Esc closes the parameter panel' })
        await win.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
      }
      const setDuration = async (seconds) => {
        const control = win.locator('[data-agent-parameter-control="duration"]').first()
        const thumb = control.getByRole('slider').first()
        await expectVisible(thumb, 'duration slider')
        if (Number(await thumb.getAttribute('aria-valuenow')) === seconds) return
        const min = Number(await thumb.getAttribute('aria-valuemin'))
        const max = Number(await thumb.getAttribute('aria-valuemax'))
        const box = await control.locator('.mantine-Slider-track').first().boundingBox()
        await win.mouse.click(box.x + box.width * (seconds - min) / (max - min), box.y + box.height / 2)
        await expect(thumb).toHaveAttribute('aria-valuenow', String(seconds), { timeout: stationTimeout() })
      }
      const setRadio = async (text) => {
        const option = panel.getByRole('radio').filter({ hasText: text }).first()
        await clickOrFail(option, `pick ${text}`)
      }
      /** 关面板后的判据：不出界、不相压（没修让法的版本上英文红：面板开着时量的是冻结的旧字）。
       *  失败记下来接着做完三次（修前的证据图要三次都截到），最后统一报红。 */
      const assertClear = async (label) => {
        const clear = (facts) => facts.out.length === 0 && facts.pressed.length === 0
        let facts = await readBar(composer)
        const deadline = Date.now() + 1500
        while (!clear(facts) && Date.now() < deadline) {
          await win.waitForTimeout(100)
          facts = await readBar(composer)
        }
        if (!clear(facts)) record.failures.push(`${label}: ${JSON.stringify(facts)}`)
      }

      // 起点：16:9 · 720p · 5s（和用户那次一样）。
      await openPanel()
      await setRadio('16:9')
      await setRadio('720p')
      await setDuration(5)
      await closePanel()
      record.start = await readBar(composer)

      // 三次：时长 5 → 10（截 a / b）、清晰度 720p → 480p、时长 10 → 15。
      const cycles = [
        { label: 'duration 10s', apply: () => setDuration(10), shots: true },
        { label: 'resolution 480p', apply: () => setRadio('480p') },
        { label: 'duration 15s', apply: () => setDuration(15) },
      ]
      for (const cycle of cycles) {
        await openPanel()
        await cycle.apply()
        await win.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
        const open = await readBar(composer)
        if (cycle.shots) await shotComposer(`a-${lang(locale)}-open-10s`)
        await closePanel()
        const closed = await readBar(composer)
        record.cycles.push({ label: cycle.label, open, closed })
        if (cycle.shots) await shotComposer(`b-${lang(locale)}-closed`)
        await assertClear(`${locale} after ${cycle.label}`)
      }
      await shotComposer(`e-${lang(locale)}-after-three`)
      record.passed = record.failures.length === 0
      if (!record.passed) { failed = true; for (const failure of record.failures) console.error(`✗ ${locale} · 关面板后出界或相压 · ${failure}`) }
    } catch (error) {
      failed = true
      record.error = String(error?.stack ?? error).split('\n').slice(0, 3).join(' ')
      await screenshotSettled(win, { path: shot(`failure-${lang(locale)}`) }).catch(() => undefined)
      console.error(`✗ ${locale}: ${record.error}`)
    } finally {
      results.push(record)
      await app.close()
      fs.rmSync(root, { recursive: true, force: true })
    }
  }
} finally {
  fs.writeFileSync(path.join(output, 'receipt.json'), JSON.stringify({ results, calls }, null, 2))
  server.closeAllConnections()
  server.close()
}
const nonGet = calls.filter((call) => call.method !== 'GET').length
if (nonGet) { console.error(`✗ 走查期间出现了 ${nonGet} 个非 GET 请求`); failed = true }
for (const record of results) console.log(`${record.passed ? '✓' : '✗'} ${record.locale}: ${JSON.stringify(record.cycles.map((cycle) => ({ label: cycle.label, closed: cycle.closed })))}`)
process.exit(failed ? 1 : 0)
