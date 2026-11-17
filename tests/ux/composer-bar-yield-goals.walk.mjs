// G2–G4：从屏上样子和叶子余量判「不多让」，不读取产品梯子/量层宽来当答案。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { openDesignLabScreen } from './uiDriverLab.mjs'

const out = path.resolve(process.env.SHOTS_DIR || '.tmp/bar-yield-goals')
fs.mkdirSync(out, { recursive: true })
const surface = {}, results = [], errors = []
const settle = p => p.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve)))))
const shape = f => JSON.stringify([f.model, f.modelClipped, f.mode, f.summary, f.send])
const read = p => p.evaluate(() => {
  const root = document.querySelector('[data-yield-history]')
  const footer = root.querySelector('[data-node-composer-footer]')
  const bar = footer.querySelector('[data-bar-segment="model-params"] > *')
  const items = [...bar.querySelectorAll('[data-yield-item]')]
  const selects = [...bar.querySelectorAll('button[aria-haspopup="listbox"]')]
  const model = selects[0], mode = selects[1]
  const summary = footer.querySelector('[data-parameter-summary]')
  const send = footer.querySelector('[data-bar-segment="generate"]')
  const visible = el => {
    const b = el.getBoundingClientRect()
    return b.width > 0 && b.height > 0 && getComputedStyle(el).visibility !== 'hidden' && getComputedStyle(el).display !== 'none'
  }
  const count = selector => {
    const all = [...root.querySelectorAll(selector)]
    return { all: all.length, visible: all.filter(visible).length }
  }
  const clipped = el => Boolean(el) && [el, ...el.querySelectorAll('*')].some(n => n.scrollWidth > n.clientWidth + .5)
  const counts = {
    generate: count('[data-bar-segment="generate"]'),
    model: count(`[aria-label="${CSS.escape(model?.getAttribute('aria-label') || '')}"]`),
    storyboard: count('[data-storyboard-generate-state]'),
    summary: count('[data-parameter-summary]'),
  }
  return {
    width: footer.getBoundingClientRect().width,
    level: footer.getAttribute('data-bar-yield-level'),
    model: model?.textContent.trim() || '', modelClipped: clipped(model),
    mode: mode?.textContent.trim() || '', summary: summary?.textContent.trim() || '', full: summary?.title || '',
    send: send?.textContent.trim() || '',
    slack: bar.getBoundingClientRect().right - items.at(-1).getBoundingClientRect().right,
    counts, dropdowns: document.querySelectorAll('[data-nomi-select-dropdown]').length,
    selects: [...document.querySelectorAll('button[aria-haspopup="listbox"]')].filter(visible).length,
  }
})
async function check(goal, label, fn) {
  try { const detail = await fn(); results.push({ goal, label, passed: true, detail }); console.log('PASS', goal, label) }
  catch (error) {
    results.push({ goal, label, passed: false, error: String(error) })
    console.error('FAIL', goal, label, String(error))
    await surface.lab.page.screenshot({ path: path.join(out, `${goal}-${label}.png`) })
  }
}
try {
  await openDesignLabScreen(surface, { screen: 'node-composer-bar', state: 'cp-matrix', viewport: { width: 1900, height: 1100 } })
  const p = surface.lab.page
  p.on('pageerror', e => errors.push(String(e)))
  await p.context().addInitScript(() => performance.setResourceTimingBufferSize(20000))
  await p.goto(surface.lab.url + '&yield-history=1')
  await p.waitForFunction(() => window.__yieldHistory)
  await p.evaluate(() => document.fonts.ready)
  const width = async value => { await p.evaluate(width => window.__yieldHistory.set({ width }), value); await settle(p); return read(p) }
  for (const host of ['canvas', 'list', 'shot', 'anchor']) for (const lang of ['en', 'zh-CN']) {
    await p.evaluate(async ({ host, lang }) => {
      const resource = performance.getEntriesByType('resource').map(r => r.name).find(u => /\/deps\/i18next\.js(\?|$)/.test(u))
      await (await import(resource)).default.changeLanguage(lang)
      window.__yieldHistory.set({ host, width: 1200, model: host === 'anchor' ? 'seedream-5-5' : 'seedance-2.5-apimart', mode: host === 'anchor' ? 't2i' : 't2v', duration: 5, resolution: host === 'anchor' ? '2K' : '720p', busy: false })
      window.__yieldHistory.remount()
    }, { host, lang })
    await settle(p)
    const label = `${host}-${lang}`
    await check('G2', label, async () => {
      const facts = []
      for (const w of host === 'canvas' && lang === 'en' ? [650, 1200] : [1200]) {
        const f = await width(w); facts.push(f)
        assert.ok(f.mode.length > 0 && f.model.length > 0 && !f.modelClipped && f.summary === (host === 'anchor' ? '16:9 · 2K' : '16:9 · 720p · 5s') && f.summary === f.full && (!['shot', 'anchor'].includes(host) || f.send.length > 0), JSON.stringify(f))
      }
      return facts
    })
    await check('G3', label, async () => {
      const transitions = []
      let previous = await width(400), previousWidth = 400
      for (let w = 408; w <= 1200; w += 8) {
        const next = await width(w)
        let start = previous, startWidth = previousWidth
        // 一档采样里可能有多个换点，逐个找最早变样子的宽，不漏掉窄档。
        while (shape(start) !== shape(next)) {
          let low = startWidth, high = w
          while (high - low > .125) {
            const mid = (low + high) / 2
            const candidate = await width(mid)
            if (shape(candidate) === shape(start)) low = mid
            else high = mid
          }
          const tight = await width(high)
          const narrower = await width(low)
          transitions.push({ low, high, narrower, tight })
          assert.notEqual(shape(narrower), shape(tight), `bisection must straddle a displayed change: ${JSON.stringify(transitions.at(-1))}`)
          assert.ok(tight.slack >= -.5 && tight.slack <= 2, `leaf slack at displayed boundary: ${JSON.stringify(transitions.at(-1))}`)
          start = tight; startWidth = high
        }
        previous = next; previousWidth = w
      }
      // 模型名自然解除裁切不算恢复了被藏的值；本夹具必须覆盖至少一次字的恢复。
      assert.ok(transitions.some(({ narrower, tight }) => ['mode', 'summary', 'send'].some(key => narrower[key] !== tight[key])), '400–1200 never restores a mode, summary value or send label; model unclipping alone cannot prove minimal yielding')
      return transitions
    })
    await check('G4', label, async () => {
      const f = await width(650)
      for (const [name, count] of Object.entries(f.counts)) {
        const expected = name === 'storyboard' && ['canvas', 'list'].includes(host) ? 0 : 1
        assert.equal(count.all, expected, `${name}: ${JSON.stringify(f)}`)
        assert.equal(count.visible, expected, `${name} visible: ${JSON.stringify(f)}`)
      }
      assert.equal(f.dropdowns, f.selects, `document dropdowns vs drawn selects: ${JSON.stringify(f)}`)
      return f
    })
  }
} finally {
  await surface.lab?.close()
  fs.writeFileSync(path.join(out, 'goals-report.json'), JSON.stringify({ results, errors }, null, 2))
}
assert.equal(errors.length, 0, JSON.stringify(errors))
assert.equal(results.filter(r => !r.passed).length, 0, 'G2–G4 goal failures (see goals-report.json)')
