import console from 'node:console'
import { URL } from 'node:url'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { pages, features } from './catalog.mjs'
import { productView } from './views.mjs'

const read = (name) => readFileSync(new URL(name, import.meta.url), 'utf8')
const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const base = {
  connected: true,
  prompt: null,
  editPrompt: '',
  model: 'Nano Banana 2',
  resolution: '1K',
  job: 'Nano Banana 2',
  prepared: null,
  preparedVariant: '',
  preparedPrompt: '',
  overlay: null,
}
const render = (id, variant = '', extra = {}, lang = 'zh') =>
  productView(
    pages.find((p) => p.id === id),
    { state: { ...base, variant, ...extra }, t: (zh, en) => (lang === 'zh' ? zh : en), esc },
  )

assert.equal(new Set(pages.map((p) => p.id)).size, 18)
assert.equal(new Set(features.map((f) => f.id)).size, 14)
let renders = 0
for (const page of pages) {
  assert(
    pages.some((p) => p.id === page.next),
    `${page.id}: missing next screen`,
  )
  for (const id of page.features)
    assert(
      features.some((f) => f.id === id),
      `${page.id}: unknown ${id}`,
    )
  for (const lang of ['zh', 'en'])
    for (const variant of page.variants.length ? page.variants.map((v) => v[0]) : ['']) {
      const html = render(page.id, variant, {}, lang)
      assert(html.includes('class="frame"'), `${page.id}: no product frame`)
      assert(!/\bundefined\b/.test(html), `${page.id}/${variant}: unresolved text`)
      for (const [, src] of html.matchAll(/src="([^"]+)"/g))
        assert(existsSync(new URL(src, import.meta.url)), `Missing asset ${src}`)
      renders++
    }
}
for (const feature of features) {
  assert(read('contracts.md').includes(`## ${feature.id} `), `Missing contract ${feature.id}`)
  for (const id of feature.screens)
    assert(
      pages.some((p) => p.id === id),
      `${feature.id}: unknown screen ${id}`,
    )
}

// Different modes must never inherit the example image price or billing unit.
for (const extra of [
  { model: 'GPT Image 2 · official' },
  { resolution: '2K' },
  { prepared: 'S15', job: 'Seedance 2.5' },
  { prepared: 'S16', job: 'Flow Music' },
]) {
  assert(!render('S07', '', extra).includes('0.12 Credits'))
  assert(!render('S09', '', extra).includes('0.12 Credits'))
  if (extra.prepared) assert(!render('S09', '', extra).includes('按张'))
}
assert(render('S07', '', { prompt: '<script>unsafe</script>' }).includes('&lt;script&gt;unsafe&lt;/script&gt;'))
assert(render('S07', '', { prompt: '' }).includes('aria-label="提示词"></textarea>'))
assert(render('S14', 'empty').includes('data-action="prepare:S14" disabled'))
assert(render('S11', 'unknown').includes('data-action="uncertain"'))
assert(!render('S11', 'unknown').includes('data-action="recover"'))
assert(render('S16', 'import-failed').includes('data-action="archive-import"'))
assert(!render('S16', 'import-failed').includes('data-action="prepare:S16"'))
assert(render('S05', 'saved').includes('已保存'))
assert(read('preview.html').includes("connect-src 'none'"))
assert(render('S02').includes('readonly'))
assert(!/\b(fetch|XMLHttpRequest|WebSocket)\s*\(/.test(read('preview.mjs')))
console.log(
  `PASS: ${renders} bilingual state renders; 18 screens, 14 feature contracts; price, escaping, recovery and demo isolation checks.`,
)

assert.equal(
  (read('preview.mjs').match(/<select\b/g) || []).length,
  (read('preview.mjs').match(/<\/select>/g) || []).length,
  'Review selector must not swallow its following API notes',
)
