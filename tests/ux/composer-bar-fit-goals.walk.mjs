// G6：底栏「缩过的东西，空位放得下就必须放回」。目标测试，由不实现的线在改法动手前写好。
//
// 要的结果（用户 11-21 看约价截图的原话：「明明有空位置 为什么缩小」）：每种样子下，每个缩过的东西
// （摘要值、方式名、钮上的字）放回一级要的宽，都大于当时剩下的空位。
//
// 判卷方式（和 G2–G4 一样，只读屏上看到的，不读产品的梯子 / 清单 / 层宽当答案）：
//   · 空位 = 底栏叶子余量（bar 右缘 − 最后一个让位件右缘），每个样子都读。
//   · 放回一级要的宽 = 走查自己看到的：在换点上（宽度只差 0.125px，只有这一个件变了）窄的一边余量 − 紧的一边余量。
//     换点由二分找出，所以「要的宽」是屏上的两次读数之差，包含件之间的空隙。
//   · 缩过的东西 = 这个样子里：方式名为空（别处有）、钮上的字为空（别处有）、摘要比最宽那档短。
//     其中任何一个「要的宽 ≤ 空位」就红。要的宽没在走查里见过的（一直没单独放回过）标 unknown，只有最宽处仍缩着才红。
//   · 最宽（1200）还有东西缩着 = 红（空位无限大，什么都放得下；「全部缩着」靠这条也过不了）。
//
// 格子：四宿主（画布节点 / 列表详情 / 分镜行 / 锚点）× 中英 × 宽 400–1200（步长 8，换点二分）；
//       再加「约价」一遍（画布、列表详情的发送键带硬币 + 积分数，经桌面桥 vendorPricePreview 回一份写死价，和生产同一个取数口），
//       以及底栏行 574 这一格单独判一次（实验室夹具的模型名和真窗口的 Seedance 2.0 Mini 不一样宽，所以这一格不是任务书的「约价 600 宽」；
//       那一格在真窗口里判：composer-bar-send-hover.walk.mjs）。
//       分镜行 / 锚点发送键是带字钮，不接约价，约价那一遍它们和无价一样，不重复。
// 用法：node tests/ux/composer-bar-fit-goals.walk.mjs   （SHOTS_DIR=<目录> 放报告和红格截图；HOSTS=canvas,list 只跑部分宿主）
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { stationTimeout } from './_station-budget.mjs'
import { openDesignLabScreen } from './uiDriverLab.mjs'

const out = path.resolve(process.env.SHOTS_DIR || '.tmp/bar-fit-goals')
fs.mkdirSync(out, { recursive: true })
const HOSTS = (process.env.HOSTS || 'canvas,list,shot,anchor').split(',')
const surface = {}, results = [], errors = []
const DEFAULT_ROW = 574 // 画布节点默认 600 宽时底栏行宽（约价胶囊在行右端、已算进右侧固定宽）
const settle = p => p.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve)))))
const shape = f => JSON.stringify([f.model, f.modelClipped, f.mode, f.summary, f.label])
const read = p => p.evaluate(() => {
  const root = document.querySelector('[data-yield-history]')
  const footer = root.querySelector('[data-node-composer-footer]')
  const bar = footer.querySelector('[data-bar-segment="model-params"] > *')
  const items = [...bar.querySelectorAll('[data-yield-item]')]
  const selects = [...bar.querySelectorAll('button[aria-haspopup="listbox"]')]
  const model = selects[0], mode = selects[1]
  const summary = footer.querySelector('[data-parameter-summary]')
  const send = footer.querySelector('[data-bar-segment="generate"]')
  const clipped = el => Boolean(el) && [el, ...el.querySelectorAll('*')].some(n => n.scrollWidth > n.clientWidth + .5)
  const copy = send?.cloneNode(true)
  copy?.querySelectorAll('[data-send-cost]').forEach(n => n.remove())
  return {
    width: footer.getBoundingClientRect().width,
    model: model?.textContent.trim() || '', modelClipped: clipped(model),
    mode: mode?.textContent.trim() || '', summary: summary?.textContent.trim() || '',
    label: copy?.textContent.trim() || '',
    pill: send?.querySelector('[data-send-cost]')?.textContent.trim() || '',
    slack: bar.getBoundingClientRect().right - items.at(-1).getBoundingClientRect().right,
    // 叶子宽：方式钮、摘要、发送钮（去掉胶囊）自己的宽——放回一级要多宽，从这几次读数的差里取。
    mw: mode?.getBoundingClientRect().width ?? 0, sw: summary?.getBoundingClientRect().width ?? 0, lw: send?.getBoundingClientRect().width ?? 0,
  }
})

/**
 * 每个件放回一级要多宽，只用走查自己读到的数：
 *  · 摘要：读到过的各个摘要值，摘要元素的宽按值记；缩着的那一档放回 = 下一个更宽的值的宽 − 它现在的宽（元素缩着时宽 0）。
 *  · 方式名 / 钮上的字：有字和没字两种样子下，那个钮的宽之差。
 *  · 另外有换点读数（宽度只差 0.125px、只变这一个件）的，用「窄边余量 − 紧边余量」，更直接，优先。
 * 读不到的（那个件在 400–1200 里一直缩着、从没出现过）= unknown。
 */
function restoreCosts(samples, transitions) {
  const byValue = new Map()
  for (const s of samples) if (s.summary !== '') byValue.set(s.summary, s.sw)
  const widths = [...byValue.entries()].sort((a, b) => a[1] - b[1])
  const pick = (key, width) => {
    const withText = samples.filter(s => s[key] !== ''), without = samples.filter(s => s[key] === '')
    return withText.length && without.length ? Math.max(...withText.map(s => s[width])) - Math.min(...without.map(s => s[width])) : undefined
  }
  const cost = { mode: { '': pick('mode', 'mw') }, label: { '': pick('label', 'lw') }, summary: {} }
  const noSummary = samples.find(s => s.summary === '')
  if (noSummary && widths.length) cost.summary[''] = widths[0][1] - noSummary.sw
  for (let i = 0; i + 1 < widths.length; i++) cost.summary[widths[i][0]] = widths[i + 1][1] - widths[i][1]
  const direct = { mode: {}, label: {}, summary: {} }
  for (const { narrower: n, tight: t } of transitions) {
    const changed = ['mode', 'summary', 'label'].filter(k => n[k] !== t[k])
    if (changed.length === 1) direct[changed[0]][n[changed[0]]] = n.slack - t.slack
  }
  for (const k of Object.keys(direct)) for (const [v, c] of Object.entries(direct[k])) cost[k][v] = c
  return cost
}

/** 一个样子里：哪些件缩着（和夹具输入定的「全放出来」比）、它们放回要多宽、和空位比。 */
function wastes(f, full, cost) {
  if (f.modelClipped) return { wastes: [], unknown: [] }
  const yielded = []
  if (f.mode === '') yielded.push(['mode', ''])
  if (f.label === '' && full.label) yielded.push(['label', ''])
  if (f.summary !== full.summary) yielded.push(['summary', f.summary])
  const bad = [], unknown = []
  for (const [key, from] of yielded) {
    const need = cost[key][from]
    if (need === undefined || Number.isNaN(need)) unknown.push({ key, from })
    else if (need <= f.slack) bad.push({ key, from, need: +need.toFixed(1), slack: +f.slack.toFixed(1) })
  }
  return { wastes: bad, unknown }
}

async function check(goal, label, fn) {
  try { const detail = await fn(); results.push({ goal, label, passed: true, detail }); console.log('PASS', goal, label) }
  catch (error) {
    results.push({ goal, label, passed: false, error: String(error) })
    console.error('FAIL', goal, label, String(error))
    await surface.lab.page.screenshot({ path: path.join(out, `${goal}-${label.replace(/[^\w.-]+/g, '_')}.png`) }).catch(() => {})
  }
}
const QUOTE = { usd: 0.195, credits: 1.95, source: 'lab' }
try {
  await openDesignLabScreen(surface, { screen: 'node-composer-bar', state: 'cp-matrix', viewport: { width: 1900, height: 1100 } })
  const p = surface.lab.page
  p.on('pageerror', e => errors.push(String(e)))
  await p.context().addInitScript(() => performance.setResourceTimingBufferSize(20000))
  // 约价：桌面桥只给 vendorPricePreview 一个口（和 useNodePricePreview 同一个取数口）；实验室页里默认没有。
  await p.context().addInitScript(quote => { window.__priced = false; window.nomiDesktop = { onboarding: { vendorPricePreview: async () => (window.__priced ? quote : null) } } }, QUOTE)
  await p.context().route('**/*', route => {
    const url = new URL(route.request().url())
    return ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ? route.continue() : route.abort('blockedbyclient')
  })
  await p.goto(surface.lab.url + '&yield-history=1')
  await p.waitForFunction(() => window.__yieldHistory)
  await p.evaluate(() => document.fonts.ready)
  let priced = false
  const width = async value => {
    await p.evaluate(width => window.__yieldHistory.set({ width }), value)
    await settle(p)
    // 约价那一遍：等价回来（防抖 100ms 之后）硬币和数字长出来，宽才是带胶囊的宽。
    if (priced) await p.waitForFunction(() => document.querySelector('[data-yield-history] [data-send-cost="credits"]'), null, { timeout: stationTimeout() })
    return read(p)
  }
  for (const host of HOSTS) for (const lang of ['en', 'zh-CN']) for (const withPrice of host === 'canvas' || host === 'list' ? [false, true] : [false]) {
    priced = withPrice
    await p.evaluate(async ({ host, lang, withPrice }) => {
      window.__priced = withPrice
      const resource = performance.getEntriesByType('resource').map(r => r.name).find(u => /\/deps\/i18next\.js(\?|$)/.test(u))
      await (await import(resource)).default.changeLanguage(lang)
      window.__yieldHistory.set({ host, width: 1200, model: host === 'anchor' ? 'seedream-5-5' : 'seedance-2.5-apimart', mode: host === 'anchor' ? 't2i' : 't2v', duration: 5, resolution: host === 'anchor' ? '2K' : '720p', busy: false })
      window.__yieldHistory.remount()
    }, { host, lang, withPrice })
    await settle(p)
    const label = `${host}-${lang}${withPrice ? '-priced' : ''}`
    const samples = []
    const transitions = []
    let full
    // 扫宽：和 G3 同一取法（步长 8、每个换点二分到 0.125px），同时记每个样子的余量。
    await check('G6', `${label}-scan`, async () => {
      full = { ...await width(1200), summary: host === 'anchor' ? '16:9 · 2K' : '16:9 · 720p · 5s' }
      const labelHost = host === 'shot' || host === 'anchor'
      full.label = labelHost ? 'x' : ''
      if (withPrice) assert.ok(full.pill !== '', `priced run shows the cost pill: ${JSON.stringify(full)}`)
      let previous = await width(400), previousWidth = 400
      samples.push({ w: 400, ...previous })
      for (let w = 408; w <= 1200; w += 8) {
        const next = await width(w)
        samples.push({ w, ...next })
        let start = previous, startWidth = previousWidth
        while (shape(start) !== shape(next)) {
          let low = startWidth, high = w
          while (high - low > .125) {
            const mid = (low + high) / 2
            const candidate = await width(mid)
            if (shape(candidate) === shape(start)) low = mid
            else high = mid
          }
          const tight = await width(high), narrower = await width(low)
          transitions.push({ low, high, narrower, tight })
          samples.push({ w: low, ...narrower }, { w: high, ...tight })
          if (shape(narrower) === shape(tight)) break
          start = tight; startWidth = high
        }
        previous = next; previousWidth = w
      }
      return { samples: samples.length, transitions: transitions.length }
    })
    if (!full) continue
    const cost = restoreCosts(samples, transitions)
    fs.writeFileSync(path.join(out, `G6-${label}-data.json`), JSON.stringify({ full, cost, transitions, samples }, null, 1))
    await check('G6', `${label}-sweep`, async () => {
      // 最宽处还缩着东西：空位放得下一切，必红（挡住「全部缩着」）。
      const widest = await width(1200)
      const shrunk = wastes({ ...widest, slack: Infinity, modelClipped: false }, full, { mode: {}, label: {}, summary: {} }).unknown
      assert.deepEqual(shrunk, [], `widest 1200 still has yielded items although everything fits: ${JSON.stringify(widest)}`)
      const bad = [], unknown = []
      for (const s of samples) {
        const r = wastes(s, full, cost)
        if (r.wastes.length) bad.push({ w: +s.w.toFixed(2), mode: s.mode, summary: s.summary, label: s.label, fits: r.wastes })
        for (const u of r.unknown) unknown.push({ w: +s.w.toFixed(2), slack: s.slack, ...u })
      }
      // 红了就把页面停在第一个放得下却没放回的宽上，给红格的截图（不然截到的是扫完以后的 1200 宽）。
      if (bad.length) { await width(bad[0].w); await p.screenshot({ path: path.join(out, `G6-${label}-first-red-${Math.round(bad[0].w)}.png`) }) }
      assert.equal(unknown.length, 0, `a yielded item was never seen restoring in 400–1200 (restore width unknown, cannot prove it did not fit): ${JSON.stringify(unknown.slice(0, 3))}`)
      assert.equal(bad.length, 0, `${bad.length} samples left a yielded item out although its restore width fits the slack, e.g. ${JSON.stringify(bad.slice(0, 3))}`)
      return { cost, unknown: unknown.length }
    })
    await check('G6', `${label}-lab-row-${DEFAULT_ROW}`, async () => {
      const f = await width(DEFAULT_ROW)
      const r = wastes(f, full, cost)
      fs.appendFileSync(path.join(out, 'default-cells.jsonl'), JSON.stringify({ label, row: DEFAULT_ROW, mode: f.mode, summary: f.summary, label_: f.label, slack: +f.slack.toFixed(2), costs: cost, wastes: r.wastes, unknown: r.unknown }) + '\n')
      assert.deepEqual(r.unknown, [], `a yielded item at row ${DEFAULT_ROW} was never seen restoring (restore width unknown): ${JSON.stringify(r.unknown)}`)
      assert.equal(r.wastes.length, 0, `at the default width a shrunk item fits: ${JSON.stringify({ mode: f.mode, summary: f.summary, slack: f.slack, fits: r.wastes })}`)
      return { mode: f.mode, summary: f.summary, slack: f.slack, unknown: r.unknown }
    })
  }
} finally {
  await surface.lab?.close()
  fs.writeFileSync(path.join(out, 'goals-report.json'), JSON.stringify({ results, errors }, null, 2))
}
assert.equal(errors.length, 0, JSON.stringify(errors))
assert.equal(results.filter(r => !r.passed).length, 0, 'G6 goal failures (see goals-report.json)')
