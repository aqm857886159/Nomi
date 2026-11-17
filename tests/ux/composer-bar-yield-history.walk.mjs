// 走到哪都等于重开：真浏览器排版、四个生产宿主、固定种子；断言用户结果，不断言观察器实现。
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
const nativeFetch = globalThis.fetch
globalThis.fetch = (input, init) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url)
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) throw new Error('NON_LOOPBACK_BLOCKED')
  return nativeFetch(input, init)
}
assert.throws(() => fetch('https://probe.invalid'), /NON_LOOPBACK_BLOCKED/)
console.log('CANARY PASS: globalThis.fetch blocks non-loopback')
const { openDesignLabScreen } = await import('./uiDriverLab.mjs')
const out = path.resolve(process.env.SHOTS_DIR || '.tmp/bar-yield-history')
fs.mkdirSync(out, { recursive: true })
const surfaces = [{}, {}], results = [], failures = [], errors = []
let seed = 20261117
const random = n => { seed = (1664525 * seed + 1013904223) >>> 0; return seed % n }
const settle = p => p.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve)))))
async function open(surface) {
  await openDesignLabScreen(surface, { screen: 'node-composer-bar', state: 'cp-matrix', viewport: { width: 1600, height: 1100 }, theme: 'light' })
  const p = surface.lab.page
  p.on('pageerror', e => errors.push(String(e)))
  await p.evaluate(() => document.fonts.ready)
  return p
}
async function language(p, lang) {
  await p.evaluate(async lang => {
    const resource = performance.getEntriesByType('resource').map(r => r.name).find(u => /\/deps\/i18next\.js(\?|$)/.test(u))
    if (!resource) throw new Error('i18next resource missing')
    await (await import(resource)).default.changeLanguage(lang)
  }, lang)
  await settle(p)
}
const facts = p => p.evaluate(() => {
  const f = document.querySelector('[data-yield-history] [data-node-composer-footer]')
  if (!f) throw new Error('footer missing')
  const summary = f.querySelector('[data-parameter-summary]'), full = summary?.title ?? ''
  const text = summary?.getAttribute('data-parameter-summary') ?? ''
  const tokens = text.split(' · '), current = full.split(' · ')
  const controls = [...f.querySelectorAll('button, input, [role=slider], [role=combobox]')].filter(el => !el.disabled && el.getBoundingClientRect().width > 0 && getComputedStyle(el).visibility !== 'hidden')
  const blocked = controls.filter(el => { const b = el.getBoundingClientRect(), hit = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2); return !hit || (hit !== el && !el.contains(hit)) }).map(el => el.getAttribute('aria-label') ?? el.textContent)
  const truncated = summary && [...summary.querySelectorAll('span')].some(el => el.scrollWidth > el.clientWidth + 1)
  const bar = f.querySelector('[data-bar-segment="model-params"] > *')
  const out = [...bar.querySelectorAll('[data-yield-item]')].filter(el => el.getBoundingClientRect().right > bar.getBoundingClientRect().right + .5).map(el => el.textContent)
  return { busy: f.querySelector('[data-bar-segment="generate"]')?.getAttribute('aria-busy') === 'true', level: f.getAttribute('data-bar-yield-level'), width: f.getBoundingClientRect().width, text, full, blocked, out, truncated: Boolean(truncated), wholeCurrent: tokens.every(token => current.includes(token)) && summary?.textContent.trim() === text, controls: controls.length }
})
try {
  const current = await open(surfaces[0]), fresh = await open(surfaces[1])
  // PerformanceResourceTiming 默认仅250条；应用模块加载前扩大（lab launcher可能复用 context）。
  for (const p of [current, fresh]) {
    await p.context().addInitScript(() => performance.setResourceTimingBufferSize(20000))
    await p.goto(surfaces[[current, fresh].indexOf(p)].lab.url + '&yield-history=1'); await p.waitForFunction(() => window.__yieldHistory); await settle(p)
  }
  for (const host of ['canvas', 'list', 'shot', 'anchor']) for (const lang of ['en', 'zh-CN']) for (const width of [485, 574, 598, 600, 650]) {
    const state = { host, width, model: host === 'anchor' ? 'seedream-5-5' : 'seedance-2.5-apimart', mode: host === 'anchor' ? 't2i' : 't2v', duration: 5, resolution: host === 'anchor' ? '2K' : '720p', busy: false }
    await current.evaluate(s => { window.__yieldHistory.set(s); window.__yieldHistory.remount() }, state)
    await language(current, 'en')
    const actions = [ { lang }, { duration: 10 }, { width: width - 18 }, { width }, { busy: true }, { busy: false }, { resolution: host === 'anchor' ? '1K' : '1080p' }, { panel: true }, { panel: false }, { model: host === 'anchor' ? 'gpt-image-2' : 'seedance-2-apimart' }, { model: state.model }, { mode: host === 'anchor' ? 'edit' : 'first' }, { mode: state.mode },
      ...Array.from({ length: 5 }, () => [{ duration: [5, 10, 15][random(3)] }, { resolution: (host === 'anchor' ? ['1K', '2K'] : ['720p', '1080p'])[random(2)] }, { width: [485, 574, 598, 600, 650][random(5)] }, { lang: random(2) ? 'en' : 'zh-CN' }, { busy: Boolean(random(2)) }][random(5)]) ]
    let actualLang = 'en'
    for (const [step, action] of actions.entries()) {
      if (action.lang) { actualLang = action.lang; await language(current, actualLang) }
      else if ('panel' in action) {
        if (action.panel) await current.locator('[data-yield-history] [data-parameter-summary]').first().click()
        else await current.keyboard.press('Escape')
      } else { Object.assign(state, action); await current.evaluate(a => window.__yieldHistory.set(a), action); await settle(current) }
      const before = await facts(current)
      await language(fresh, actualLang)
      await fresh.evaluate(s => { window.__yieldHistory.set(s); window.__yieldHistory.remount() }, state)
      await settle(fresh)
      const reopened = await facts(fresh)
      const entry = { host, lang, width, step, action, before, reopened }
      results.push(entry)
      const ok = before.blocked.length === 0 && before.out.length === 0 && !before.truncated && before.wholeCurrent && before.busy === state.busy && (host === 'anchor' || before.full.includes(`${state.duration}s`)) && before.controls > 0 && before.level === reopened.level && before.text === reopened.text && before.full === reopened.full && Math.abs(before.width - reopened.width) < .5
      if (!ok) {
        failures.push(entry)
        console.error('FAIL', JSON.stringify(entry))
        await current.screenshot({ path: path.join(out, `failure-${failures.length}.png`) })
        if (process.env.YIELD_HISTORY_FAIL_FAST === '1') throw new Error('history invariant failed')
      }
    }
    console.log('CHECKED', host, lang, width)
  }
} finally {
  for (const surface of surfaces) await surface.lab?.close()
  fs.writeFileSync(path.join(out, 'history-report.json'), JSON.stringify({ seed: 20261117, steps: results.length, results, failures, errors }, null, 2))
}
assert.equal(errors.length, 0, JSON.stringify(errors))
assert.equal(failures.length, 0, `${failures.length} history invariant failures`)
console.log(`PASS ${results.length} steps: all controls hittable, current whole values, same as fresh mount`)
