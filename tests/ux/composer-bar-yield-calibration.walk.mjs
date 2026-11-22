// 每个生产宿主/语言/每种收法组合：文字与外框算出的宽等于真画宽；闭根只能含文字。
// 收法从屏上读（方式格有没有字、摘要是哪一档、钮上有没有字、模型名截没截），不读组件内部的级数。
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
    // 排版占的宽 = 画出来的宽 + 左右外边距（约价胶囊 -mr-0.5 往右探出、不占行宽）。
    const occupied = el => el ? rect(el) + (parseFloat(getComputedStyle(el).marginLeft) || 0) + (parseFloat(getComputedStyle(el).marginRight) || 0) : 0
    const gap = el => parseFloat(getComputedStyle(el).columnGap) || 0
    const identity = bar.querySelector('[data-yield-item]')
    const selects = identity.querySelectorAll('button[aria-haspopup="listbox"]')
    const model = selects[0], mode = selects[1]
    const modelText = model?.querySelector('span.truncate')
    const summary = bar.querySelector('[data-parameter-summary]')
    const send = footer.querySelector('[data-bar-segment="generate"]')
    const fixed = [...footer.children].filter(el => !el.hasAttribute('data-yield-action') && el.getAttribute('data-bar-segment') !== 'model-params')
    const modeLabel = mode?.querySelector('span.truncate')
    const words = [...(ruler?.children || [])].map(el => ({ text: el.textContent, width: rect(el) }))
    return {
      width: rect(footer), words,
      structure: roots.length === 1 && ruler.mode === 'closed' && ruler.host.shadowRoot === null && ruler.host.getAttribute('aria-hidden') === 'true'
        && [...ruler.childNodes].every(el => el.nodeType === Node.ELEMENT_NODE && el.tagName === 'SPAN' && [...el.childNodes].every(n => n.nodeType === Node.TEXT_NODE) && ![...el.attributes].some(a => a.name === 'role' || a.name.startsWith('data-'))),
      model: rect(model), hiddenModel: modelText ? modelText.scrollWidth - modelText.clientWidth : 0,
      mode: rect(mode), modeText: modeLabel ? modeLabel.textContent.trim() : null, modeCollapsible: Boolean(mode?.querySelector(':scope > span[aria-hidden]')), modeGap: mode ? gap(mode) : 0, identityGap: gap(identity), identity: rect(identity),
      summary: rect(summary), summaryText: summary?.textContent.trim(), paramGap: gap(bar),
      send: occupied(send), sendText: send?.textContent.trim(),
      fixed: fixed.reduce((n, el) => n + occupied(el), 0) + gap(footer) * (fixed.length + (send ? 1 : 0)),
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
    const frames = await p.evaluate(async () => (await import('/src/workbench/generationCanvas/nodes/ComposerSendButton.tsx')).COMPOSER_SEND_FRAME)
    const hasLabel = Boolean(full.sendText), modeCollapsible = full.modeCollapsible
    const expectedOf = step => full.identity - (step.modeIconOnly ? modeText.width + full.modeGap : 0)
      + full.summary - summaries[0].width + summaries[step.summaryIndex].width + full.paramGap
      + (hasLabel ? step.sendIconOnly ? frames.icon : sendText.width + frames.label : full.send) + full.fixed
    // 屏上画的是哪种收法。
    const drawnStep = actual => ({
      modeIconOnly: modeCollapsible && actual.modeText === null,
      summaryIndex: summaries.findIndex(word => word.text === actual.summaryText),
      sendIconOnly: hasLabel && !actual.sendText,
      modelEllipsis: actual.hiddenModel > .5,
    })
    // 每种组合都去它刚好放得下的宽度上看一次；末尾再看一次「模型名都放不下」。
    const probes = []
    for (const modeIconOnly of modeCollapsible ? [false, true] : [false]) for (let summaryIndex = 0; summaryIndex < summaries.length; summaryIndex++) for (const sendIconOnly of hasLabel ? [false, true] : [false]) probes.push({ modeIconOnly, summaryIndex, sendIconOnly, modelEllipsis: false })
    const collapsed = { modeIconOnly: modeCollapsible, summaryIndex: summaries.length - 1, sendIconOnly: hasLabel, modelEllipsis: false }
    probes.push({ ...collapsed, modelEllipsis: true })
    for (const probe of probes) {
      const at = probe.modelEllipsis ? expectedOf(collapsed) - 12 : expectedOf(probe) + .25
      const actual = await width(at)
      const label = `${host}/${lang}/${JSON.stringify(probe)}`
      assert.ok(actual.structure, `${label}: ruler structure`)
      const step = drawnStep(actual)
      assert.ok(step.summaryIndex >= 0, `${label}: summary on screen is not a whole candidate ${JSON.stringify(actual)}`)
      // 最省地方的样子 + 0.25 只放得下它自己；再窄 12 就只剩模型名省略。
      if (probe.modelEllipsis) assert.deepEqual(step, probe, `${label}: model name must clip only when nothing else is left`)
      if (JSON.stringify(probe) === JSON.stringify(collapsed)) assert.deepEqual(step, collapsed, `${label}: tightest whole shape`)
      const expected = expectedOf(step)
      if (!step.modelEllipsis) assert.ok(expected <= at + .5, `${label}: drawn shape ${JSON.stringify(step)} needs ${expected} > ${at}`)
      const drawn = actual.identity + (step.modelEllipsis ? actual.hiddenModel : 0) + actual.summary + actual.paramGap + actual.send + actual.fixed
      const result = { host, lang, probe, step, at, expected, drawn, error: drawn - expected }
      results.push(result)
      assert.ok(Math.abs(result.error) <= .5, JSON.stringify(result))
    }
    // 同一宽度从两侧到达，屏上形状一致；每个宽度连续三帧稳定。
    const first = new Map()
    for (const w of [...Array.from({ length: 96 }, (_, i) => 470 + i * 2), ...Array.from({ length: 96 }, (_, i) => 660 - i * 2)]) {
      const f = await width(w)
      const shape = JSON.stringify([f.hiddenModel > .5, f.summaryText, f.sendText, f.modeText, f.mode])
      if (first.has(w)) assert.equal(shape, first.get(w), `${host}/${lang}/${w}: width direction changes shape`)
      else first.set(w, shape)
      await settle(p)
      const next = await read()
      assert.equal(JSON.stringify([next.hiddenModel > .5, next.summaryText, next.sendText, next.modeText, next.mode]), shape, `${host}/${lang}/${w}: oscillation`)
    }
    console.log('PASS calibration/structure/drag', host, lang, probes.length)
  }
} finally {
  await surface.lab?.close()
  fs.writeFileSync(path.join(out, 'calibration-report.json'), JSON.stringify({ results, errors }, null, 2))
}
assert.equal(errors.length, 0, JSON.stringify(errors))
