// 约价真窗口两格：G7（悬停提示）和 G6 的约价 600 宽那一格（真窗口版）。目标测试，改法动手前由不实现的线写好。
//
// G7 要的结果（用户 11-21 看约价截图的原话：「你的文字换行有问题 设计的很丑」）：真窗口里把鼠标移到约价发送键上，
// 弹出的提示每一个换行点都落在句子边界（句号 / 。/ ! / ！/ ? / ？ 之后），提示整块在窗口里，文字和产品文案全文一致、一个字不少。
// 拍板图 M4 ① 的断行位置不算合同（D-1121-tooltip-multiline-shared）；提示的样子只认共用组件 src/design/tooltip.tsx 出的那一份
// （读 [data-send-cost-hover]，和提示内容同一个节点，不读调用方的类名当答案）。
//   读法（读屏上的样子，不读组件属性）：真把鼠标移到发送键上让提示弹出来；逐字用 Range 取屏上矩形，按行切开；
//   每个换行点前的那个字必须是句末标点（英文「.」要是行尾；数字里的小数点不算句末）。
//   「提示全藏 / 不出提示」：提示必须出现（超时记进判决，是断言红不是加载红）、字必须全在（和登记文案逐字相等），所以这两种改法也过不了。
//   期望文案由假价目（0.039 美元 / 秒 × 5 秒）和登记文案算出来，不拿屏上的数反推。
//
// G6 约价 600 宽（真窗口、Seedance 2.0 Mini、节点默认 600 宽、5 秒 720P）：摘要缩成了更短的一档时，下一个更宽的摘要值放回要的宽
// （从屏上叶子取：同样式的探针节点量下一档字的宽，减去现在摘要元素的宽）必须大于当时叶子余量；放得下却没放回就红。
// 实验室里按宽度扫的全表在 composer-bar-fit-goals.walk.mjs；这里只判真窗口默认宽这一格，中英各判。
//
// 分镜行的带字发送键没有约价、也不接共用提示（原生 title），没有弹出的提示可读；这里不判它，报告里照实写。
// 免费：APIMart 地址经测试出网重定向指到本机回环假服务，非 GET 一律 405，不产出媒体、不花钱。
// 用法：先 pnpm run build；NOMI_TEST_NETWORK_GUARD=1 node tests/ux/composer-bar-send-hover.walk.mjs
//   NOMI_SEND_HOVER_EVIDENCE=<目录> 截图和报告目录（缺省 .tmp/send-hover-goals）；NOMI_SEND_HOVER_LOCALE=en|zh-CN 只跑一种语言。
import assert from 'node:assert/strict'
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
import { uiText, uiTextWith } from './full-walk/invariants.mjs'
import { badBreaks } from './_sentenceBreaks.mjs'

const output = path.resolve(process.env.NOMI_SEND_HOVER_EVIDENCE || '.tmp/send-hover-goals')
fs.mkdirSync(output, { recursive: true })
const only = process.env.NOMI_SEND_HOVER_LOCALE
const LOCALES = only ? [only] : ['zh-CN', 'en']
const RATES = { '480P': 0.02, '720P': 0.039 }
const FIVE_SECONDS_USD = 0.039 * 5
const calls = []
const server = http.createServer((req, res) => {
  const target = new URL(req.url, 'http://127.0.0.1')
  calls.push({ method: req.method, path: target.pathname })
  if (req.method !== 'GET') { res.statusCode = 405; res.end('{"success":false}'); return }
  let payload = { success: false }
  if (target.pathname === '/api/pricing/model' && target.searchParams.get('model') === 'seedance-2.0-mini') {
    payload = { success: true, data: { model_name: 'seedance-2.0-mini', billing_type: 'per_second', membership: { category: 'video' }, resolution_enabled: true, resolution_paid_prices: RATES } }
  } else if (target.pathname === '/v1/models') res.statusCode = 401
  else if (target.pathname !== '/api/pricing/model') res.statusCode = 404
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(payload))
})
server.listen(0, '127.0.0.1')
await once(server, 'listening')
const origin = `http://127.0.0.1:${server.address().port}`
const credits = usd => String(Math.round(usd * 10 * 100) / 100)

/** 在页面里把提示每个字的屏上矩形取出来，按行切开；同时量整块和窗口的关系。 */
const readTip = tip => tip.evaluate(el => {
  const copy = el.cloneNode(true)
  for (const hidden of copy.querySelectorAll('[role="tooltip"]')) hidden.remove()
  const visibleText = (copy.textContent ?? '').replace(/\s+/g, ' ').trim()
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, { acceptNode: n => n.parentElement?.closest('[role="tooltip"]') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT })
  const chars = []
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    for (let i = 0; i < n.data.length; i++) {
      const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + 1)
      const b = r.getClientRects()[0]
      chars.push({ ch: n.data[i], rect: b ? { l: b.left, r: b.right, t: b.top, b: b.bottom, w: b.width, h: b.height } : null })
    }
  }
  const lines = []
  for (const c of chars) {
    if (!c.rect || (c.rect.w === 0 && /\s/.test(c.ch))) { if (lines.length) lines.at(-1).trail += c.ch; continue }
    const last = lines.at(-1)
    // 新一行：这个字的竖直位置整体落在上一行下面（行高的一半以外）；行尾挂着的空格并回上一行。
    if (!last || c.rect.t >= last.b - c.rect.h / 2) {
      if (last) { last.text += last.trail; last.trail = '' }
      lines.push({ text: '', trail: '', b: c.rect.b })
    }
    const line = lines.at(-1)
    line.text += line.trail + c.ch
    line.trail = ''
    line.b = Math.max(line.b, c.rect.b)
  }
  for (const l of lines) l.text += l.trail
  const box = el.getBoundingClientRect()
  const inside = chars.filter(c => c.rect && c.rect.w > 0).every(c => c.rect.l >= box.left - .5 && c.rect.r <= box.right + .5 && c.rect.t >= box.top - .5 && c.rect.b <= box.bottom + .5)
  return {
    visibleText, lines: lines.map(l => l.text),
    box: { l: box.left, r: box.right, t: box.top, b: box.bottom, w: box.width, h: box.height },
    window: { w: window.innerWidth, h: window.innerHeight },
    scroll: { w: el.scrollWidth, cw: el.clientWidth, h: el.scrollHeight, ch: el.clientHeight }, charsInsideBox: inside,
  }
})

/**
 * 摘要缩着时，下一档更宽的摘要值放回要多宽：候选值取摘要自己的 title（全值，「16:9 · 720p · 5s」）从后往前的段；
 * 字的宽用和摘要同样式的探针节点量（不插进底栏，免得动到产品自己的量层）；余量 = 底栏叶子余量。
 */
const readSummaryFit = composer => composer.evaluate(owner => {
  const footer = owner.querySelector('[data-node-composer-footer]')
  const bar = footer.querySelector('[data-bar-segment="model-params"] > *')
  const last = [...bar.querySelectorAll('[data-yield-item]')].at(-1)
  const summary = footer.querySelector('[data-parameter-summary]')
  const sel = [...bar.querySelectorAll('button[aria-haspopup="listbox"]')]
  const slack = bar.getBoundingClientRect().right - last.getBoundingClientRect().right
  const base = { row: footer.getBoundingClientRect().width, slack, mode: sel[1]?.textContent.trim() ?? '', summary: summary?.textContent.trim() ?? '', title: summary?.title ?? '', html: summary?.outerHTML.slice(0, 400) ?? '' }
  if (!summary || base.summary === '') return { ...base, next: null, hidden: true }
  const parts = base.title.split(' · ')
  const candidates = parts.map((_, i) => parts.slice(parts.length - 1 - i).join(' · '))
  const at = candidates.indexOf(base.summary)
  if (at < 0) return { ...base, next: null, notACandidate: true }
  if (at === candidates.length - 1) return { ...base, next: null } // 已经是全值
  const next = candidates[at + 1]
  // 探针：深拷贝摘要节点，把存字的那个文字节点换成要量的字，挂在底栏所在的生成框里（不进底栏，免得动产品自己的量层）。
  const measure = text => {
    const probe = summary.cloneNode(true)
    const walker = document.createTreeWalker(probe, NodeFilter.SHOW_TEXT)
    let node = walker.nextNode()
    while (node && node.data.trim() === '') node = walker.nextNode()
    if (node) node.data = text
    else probe.textContent = text
    Object.assign(probe.style, { position: 'fixed', left: '-9999px', top: '0', visibility: 'hidden', width: 'auto', maxWidth: 'none', flex: 'none' })
    owner.appendChild(probe)
    const width = probe.getBoundingClientRect().width
    probe.remove()
    return width
  }
  const currentWidth = summary.getBoundingClientRect().width
  const calibration = measure(base.summary) - currentWidth // 量具校准：量「现在的字」要和屏上摘要一样宽
  const nextWidth = measure(next)
  return { ...base, next, need: nextWidth - currentWidth, nextWidth, currentWidth, calibration }
})

const results = []
try {
  for (const locale of LOCALES) {
    const root = makeTempDir('nomi-send-hover-')
    const settingsDir = path.join(root, 'settings')
    fs.mkdirSync(settingsDir, { recursive: true })
    const options = {
      name: `send-hover-goals-${locale}`, userDataDir: settingsDir, settingsDir, projectsDir: path.join(root, 'projects'),
      syntheticCredentialStorage: true,
      env: { NOMI_TEST_NETWORK_REDIRECTS: JSON.stringify([{ from: 'https://api.apimart.ai', to: origin }]) },
      initialLocalStorage: { 'nomi-color-scheme': 'light', 'nomi:locale:v1': locale, 'nomi:splash:v1': 'seen', 'nomi:journey-tour:v1': 'seen', 'nomi-onboarding-checklist:v1': 'seen', 'nomi:canvas-gesture-hint:v1': 'seen' },
    }
    fs.mkdirSync(options.projectsDir, { recursive: true })
    await seedSavedFixtureCredentials(options, ['apimart'])
    const { app, win } = await launchNomiApp(options)
    const record = { locale, g6: null, g7: null }
    results.push(record)
    try {
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1220, 840))
      await clickOrFail(newProjectEntry(win), 'new project')
      await switchWorkspace(win, 'generation')
      await addCanvasNode(win, 'video')
      const composer = win.locator('[data-composer-host="canvas"]:visible').last()
      const send = composer.locator('[data-bar-segment="generate"]')
      const picker = composer.getByRole('button', { name: uiText(locale, 'generationCommon.parameters.model'), exact: true })
      const menu = win.locator('[data-nomi-select-dropdown]:visible').first()
      await clickOrFail(picker, 'open model picker')
      const more = menu.getByRole('button', { name: uiText(locale, 'onboardingProviders.modelControls.more'), exact: true })
      const row = menu.getByRole('option').filter({ has: win.locator('[data-nomi-select-option-label]', { hasText: /^Seedance 2\.0 Mini$/ }) }).first()
      const open = await proveProbe(menu, 'model menu is open')
      if (!(await row.isVisible()) && await more.isVisible().catch(() => false)) await clickOrFail(more, 'expand more models')
      await clickOrFail(row, 'pick Seedance 2.0 Mini')
      await expectAbsent(menu, { provenBy: open, message: 'model menu closes' })
      const setParam = async (key, value) => {
        await clickOrFail(composer.locator('[data-parameter-summary]').first(), `open parameters for ${key}`)
        const control = win.locator(`[data-agent-parameter-control="${key}"]`).first()
        await expectVisible(control, `parameter control ${key}`)
        if (typeof value === 'number') {
          const thumb = control.getByRole('slider').first()
          if (Number(await thumb.getAttribute('aria-valuenow')) !== value) {
            const min = Number(await thumb.getAttribute('aria-valuemin')), max = Number(await thumb.getAttribute('aria-valuemax'))
            const box = await control.locator('.mantine-Slider-track').first().boundingBox()
            await win.mouse.click(box.x + box.width * (value - min) / (max - min), box.y + box.height / 2)
            await expect(thumb).toHaveAttribute('aria-valuenow', String(value), { timeout: stationTimeout() })
          }
        } else await control.getByRole('radio', { name: value, exact: true }).first().click()
        await win.keyboard.press('Escape')
      }
      await setParam('duration', 5)
      await setParam('resolution', '720p')
      const pill = send.locator('[data-send-cost="credits"]')
      await expect(pill, 'price shown on the send key').toHaveText(credits(FIVE_SECONDS_USD), { timeout: stationTimeout() })
      await win.mouse.move(20, 20, { steps: 4 })
      await win.waitForTimeout(500)

      // —— G6 约价 600 宽（真窗口）——
      const fit = await readSummaryFit(composer)
      record.g6 = fit
      // 量具坏了不能当判决：现在的字量出来和屏上摘要差超过 0.5px，记加载红。
      if (fit.calibration !== undefined && Math.abs(fit.calibration) > .5) throw new Error(`summary probe is off by ${fit.calibration}px; cannot judge: ${fit.html}`)
      const g6Problems = []
      if (fit.hidden) g6Problems.push('the parameter summary is hidden (empty) at the default width although values are set: the full value always fits somewhere')
      if (fit.notACandidate) g6Problems.push(`summary text "${fit.summary}" is not a tail of its own full value "${fit.title}"`)
      if (fit.title !== '16:9 · 720p · 5s') g6Problems.push(`full value is "${fit.title}", expected "16:9 · 720p · 5s" (5 s, 720p set by the walk)`)
      if (fit.next && fit.need <= fit.slack) g6Problems.push(`summary shown as "${fit.summary}" but the next step "${fit.next}" needs ${fit.need.toFixed(1)}px and the slack is ${fit.slack.toFixed(1)}px`)
      record.g6Problems = g6Problems
      console.log(g6Problems.length === 0 ? 'PASS' : 'FAIL', 'G6 priced-default', locale, JSON.stringify({ summary: fit.summary, mode: fit.mode, slack: +fit.slack.toFixed(1), next: fit.next, need: fit.need && +fit.need.toFixed(1) }), g6Problems.join(' | '))
      await screenshotSettled(win, { path: path.join(output, `${locale}-priced-default.png`) })

      // —— G7 悬停提示 ——
      const expected = uiTextWith(locale, 'generationCommon.composer.sendCost.estimate', { value: credits(FIVE_SECONDS_USD), usd: `$${FIVE_SECONDS_USD}` })
      await send.hover()
      const tip = win.locator('[data-send-cost-hover]').first()
      const problems = []
      const shown = await expect(tip).toBeVisible({ timeout: stationTimeout() }).then(() => true, () => false)
      if (!shown) problems.push('no tooltip appeared when the pointer rested on the priced send key')
      else {
        await win.waitForTimeout(400) // 出现动画停稳
        await screenshotSettled(win, { path: path.join(output, `${locale}-send-hover.png`) })
        const read = await readTip(tip)
        record.read = read
        if (read.visibleText !== expected) problems.push(`text differs from the registered wording: ${JSON.stringify(read.visibleText)} vs ${JSON.stringify(expected)}`)
        if (read.lines.join('').replace(/\s+/g, ' ').trim() !== expected) problems.push(`lines do not add up to the wording: ${JSON.stringify(read.lines)}`)
        const breaks = badBreaks(read.lines)
        if (breaks.length) problems.push(`${read.lines.length} lines; line breaks inside a sentence: ${JSON.stringify(breaks)}; lines=${JSON.stringify(read.lines)}`)
        const b = read.box
        if (!(b.l >= -.5 && b.t >= -.5 && b.r <= read.window.w + .5 && b.b <= read.window.h + .5)) problems.push(`tooltip box leaves the window: ${JSON.stringify({ box: b, window: read.window })}`)
        if (!read.charsInsideBox || read.scroll.w > read.scroll.cw + .5 || read.scroll.h > read.scroll.ch + .5) problems.push(`some characters stick out of the tooltip box: ${JSON.stringify(read.scroll)}`)
      }
      record.problems = problems
      console.log(problems.length === 0 ? 'PASS' : 'FAIL', 'G7', locale, problems.join(' | '))
    } catch (error) {
      record.error = String(error?.stack ?? error)
      console.error('LOAD-ERROR (not a goal verdict)', locale, record.error)
      await screenshotSettled(win, { path: path.join(output, `${locale}-failure.png`) }).catch(() => undefined)
    } finally {
      fs.writeFileSync(path.join(output, `${locale}-record.json`), JSON.stringify(record, null, 2))
      await app.close()
      fs.rmSync(root, { recursive: true, force: true })
    }
  }
} finally {
  fs.writeFileSync(path.join(output, 'priced-real-report.json'), JSON.stringify({ results, nonGet: calls.filter(c => c.method !== 'GET').length }, null, 2))
  server.closeAllConnections()
  server.close()
}
assert.equal(calls.filter(c => c.method !== 'GET').length, 0, 'hovering sent no generation request')
const broken = results.filter(r => r.error)
assert.equal(broken.length, 0, `walk could not run (load error, not a goal verdict): ${broken.map(r => `${r.locale}: ${r.error}`).join(' || ')}`)
const failed = results.filter(r => r.problems?.length || r.g6Problems?.length)
assert.equal(failed.length, 0, `goal failures: ${failed.map(r => `${r.locale}: ${[...(r.g6Problems ?? []).map(p => `G6 ${p}`), ...(r.problems ?? []).map(p => `G7 ${p}`)].join(' | ')}`).join(' || ')}`)
