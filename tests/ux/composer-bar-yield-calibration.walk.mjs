// 每个生产宿主/语言/让级：文字与外框算出的宽等于真画宽；闭根只能含文字。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
const nativeFetch = globalThis.fetch
globalThis.fetch = (input, init) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url)
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) throw new Error('NON_LOOPBACK_BLOCKED')
  return nativeFetch(input, init)
}
assert.throws(() => fetch('https://probe.invalid'), /NON_LOOPBACK_BLOCKED/)
console.log('CANARY PASS: non-loopback fetch blocked')
const { openDesignLabScreen } = await import('./uiDriverLab.mjs')
const out = path.resolve(process.env.SHOTS_DIR || '.tmp/bar-yield-calibration')
fs.mkdirSync(out, { recursive: true })
const surface = {}, results = [], errors = []
const settle = p => p.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r)))))
try {
  await openDesignLabScreen(surface, { screen: 'node-composer-bar', state: 'cp-matrix', viewport: { width: 1900, height: 1100 } })
  const p = surface.lab.page
  p.on('pageerror', e => errors.push(String(e)))
  await p.context().addInitScript(() => {
    performance.setResourceTimingBufferSize(20000)
    window.__rulerRoots = []
    const attach = Element.prototype.attachShadow
    Element.prototype.attachShadow = function (options) {
      const root = attach.call(this, options)
      window.__rulerRoots.push(root)
      return root
    }
  })
  await p.goto(surface.lab.url + '&yield-history=1')
  await p.waitForFunction(() => window.__yieldHistory)
  await p.evaluate(() => document.fonts.ready)
  const read = () => p.evaluate(() => {
    const scope = document.querySelector('[data-yield-history]')
    const footer = scope.querySelector('[data-node-composer-footer]')
    const bar = footer.querySelector('[data-bar-segment="model-params"] > *')
    const roots = window.__rulerRoots.filter(r => r.host.isConnected && scope.contains(r.host))
    const ruler = roots[0]
    const rect = el => el?.getBoundingClientRect().width || 0
    const gap = el => parseFloat(getComputedStyle(el).columnGap) || 0
    const identity = bar.querySelector('[data-yield-item]')
    const selects = identity.querySelectorAll('button[aria-haspopup="listbox"]')
    const model = selects[0], mode = selects[1]
    const modelText = model?.querySelector('span.truncate')
    const summary = bar.querySelector('[data-parameter-summary]')
    const send = footer.querySelector('[data-bar-segment="generate"]')
    const fixed = [...footer.children].filter(el => !el.hasAttribute('data-yield-action') && el.getAttribute('data-bar-segment') !== 'model-params')
    const words = [...(ruler?.children || [])].map(el => ({ text: el.textContent, width: rect(el) }))
    return {
      level: Number(footer.dataset.barYieldLevel), width: rect(footer), words,
      structure: roots.length === 1 && ruler.mode === 'closed' && ruler.host.shadowRoot === null && ruler.host.getAttribute('aria-hidden') === 'true'
        && [...ruler.childNodes].every(el => el.nodeType === Node.ELEMENT_NODE && el.tagName === 'SPAN' && [...el.childNodes].every(n => n.nodeType === Node.TEXT_NODE) && ![...el.attributes].some(a => a.name === 'role' || a.name.startsWith('data-'))),
      model: rect(model), hiddenModel: modelText ? modelText.scrollWidth - modelText.clientWidth : 0,
      mode: rect(mode), modeCollapsible: Boolean(mode?.querySelector(':scope > span[aria-hidden]')), modeGap: mode ? gap(mode) : 0, identityGap: gap(identity), identity: rect(identity),
      summary: rect(summary), summaryText: summary?.textContent.trim(), paramGap: gap(bar),
      send: rect(send), sendText: send?.textContent.trim(),
      fixed: fixed.reduce((n, el) => n + rect(el), 0) + gap(footer) * (fixed.length + (send ? 1 : 0)),
    }
  })
  const width = async w => { await p.evaluate(width => window.__yieldHistory.set({ width }), w); await settle(p); return read() }
  for (const host of ['canvas', 'list', 'shot', 'anchor']) for (const lang of ['en', 'zh-CN']) {
    await p.evaluate(async ({ host, lang }) => {
      const url = performance.getEntriesByType('resource').map(r => r.name).find(u => /\/deps\/i18next\.js(\?|$)/.test(u))
      await (await import(url)).default.changeLanguage(lang)
      window.__yieldHistory.set({ host, width: 1200, model: host === 'anchor' ? 'seedream-5-5' : 'seedance-2.5-apimart', mode: host === 'anchor' ? 't2i' : 't2v', duration: 5, resolution: host === 'anchor' ? '2K' : '720p', busy: false })
      window.__yieldHistory.remount()
    }, { host, lang })
    await settle(p)
    const full = await read()
    assert.ok(full.structure, `${host}/${lang}: ruler must contain only text spans in a closed root`)
    const summaries = full.words.slice(0, -2), modeText = full.words.at(-2), sendText = full.words.at(-1)
    const { steps, frames } = await p.evaluate(async ({ hasLabel, modeCollapsible, candidates }) => {
      const { composerYieldLadder } = await import('/src/workbench/generationCanvas/nodes/composerBarYield.ts')
      const { COMPOSER_SEND_FRAME } = await import('/src/workbench/generationCanvas/nodes/ComposerSendButton.tsx')
      return { steps: composerYieldLadder({ sendCollapsible: hasLabel, modeCollapsible, summaryCandidates: candidates }), frames: COMPOSER_SEND_FRAME }
    }, { hasLabel: Boolean(full.sendText), modeCollapsible: full.modeCollapsible, candidates: summaries.length })
    for (const [level, step] of steps.entries()) {
      const expected = full.identity - (step.modeIconOnly ? modeText.width + full.modeGap : 0)
        + full.summary - summaries[0].width + summaries[step.summaryIndex].width + full.paramGap
        + (full.sendText ? step.sendIconOnly ? frames.icon : sendText.width + frames.label : full.send) + full.fixed
      const actual = await width(step.modelEllipsis ? expected - 12 : expected + .25)
      assert.ok(actual.structure, `${host}/${lang}/${level}: ruler structure`)
      assert.equal(actual.level, level, `${host}/${lang}: intended level ${level}, actual ${JSON.stringify(actual)}`)
      const drawn = actual.identity + (step.modelEllipsis ? actual.hiddenModel : 0) + actual.summary + actual.paramGap + actual.send + actual.fixed
      const result = { host, lang, level, expected, drawn, error: drawn - expected }
      results.push(result)
      assert.ok(Math.abs(result.error) <= .5, JSON.stringify(result))
    }
    // 同一宽度从两侧到达，屏上形状一致；每个宽度连续三帧稳定。
    const first = new Map()
    for (const w of [...Array.from({ length: 96 }, (_, i) => 470 + i * 2), ...Array.from({ length: 96 }, (_, i) => 660 - i * 2)]) {
      const f = await width(w)
      const shape = JSON.stringify([f.level, f.summaryText, f.sendText, f.mode])
      if (first.has(w)) assert.equal(shape, first.get(w), `${host}/${lang}/${w}: width direction changes shape`)
      else first.set(w, shape)
      await settle(p)
      const next = await read()
      assert.equal(JSON.stringify([next.level, next.summaryText, next.sendText, next.mode]), shape, `${host}/${lang}/${w}: oscillation`)
    }
    console.log('PASS calibration/structure/drag', host, lang, steps.length)
  }
} finally {
  await surface.lab?.close()
  fs.writeFileSync(path.join(out, 'calibration-report.json'), JSON.stringify({ results, errors }, null, 2))
}
assert.equal(errors.length, 0, JSON.stringify(errors))
