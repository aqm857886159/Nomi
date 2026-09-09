import { test } from 'node:test'
import { expect } from '@playwright/test'
import { chromium } from 'playwright'
import { scanFeel } from './_feel.mjs'

const cases = [
  ['text-overlap', '<div><span style="position:absolute;left:20px;top:20px">alpha</span></div><section><span style="position:absolute;left:20px;top:20px">bravo</span></section>', '<div>alpha</div><section>bravo</section>'],
  ['out-of-viewport', '<style>html,body{overflow:hidden}</style><span style="position:absolute;left:310px;width:100px">outside</span>', '<div style="overflow:auto;width:100px;height:60px"><div style="width:800px;height:400px;position:relative"><button style="position:absolute;left:500px">node</button></div></div>'],
  ['clipped-content', '<div style="height:5px;overflow:hidden">clipped text</div>', '<div style="height:5px;overflow:auto">scrollable text</div>'],
  ['font-size', '<span style="font-size:8px">tiny</span>', '<span style="font-size:16px">readable</span>'],
  ['unreachable-interaction', '<button style="pointer-events:none">go</button>', '<button>go</button>'],
  ['blocked-interaction', '<button style="position:absolute;left:20px;top:20px">go</button><div style="position:absolute;left:0;top:0;width:200px;height:100px;background:white"></div>', '<button>go</button>'],
]

for (const [rule, red, green] of cases) {
  test(`${rule}: red defect / green correction`, async () => {
    const browser = await chromium.launch({ headless: true })
    try {
      const page = await browser.newPage({ viewport: { width: 320, height: 200 } })
      await page.setContent(red)
      const failed = await scanFeel(page)
      expect(failed.findings.some((finding) => finding.rule === rule), `missing ${rule}`).toBe(true)
      await page.setContent(green)
      const passed = await scanFeel(page)
      expect(passed.findings.some((finding) => finding.rule === rule), `false positive ${rule}`).toBe(false)
    } finally {
      await browser.close()
    }
  })
}

test('locator root excludes unrelated defects; ancestor text is not duplicated', async () => {
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage()
    await page.setContent('<main><p>readable <span>nested text</span></p></main><aside style="font-size:8px">tiny</aside>')
    const result = await scanFeel(page.locator('main'))
    expect(result.findings).toEqual([])
  } finally {
    await browser.close()
  }
})


test('text clipped by its own box cannot overlap the next control', async () => {
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage()
    await page.setContent('<div style="height:8px;overflow:hidden">Clipped content</div><button>Next</button>')
    const result = await scanFeel(page)
    expect(result.findings.some((finding) => finding.rule === 'clipped-content')).toBe(true)
    expect(result.findings.some((finding) => finding.rule === 'text-overlap')).toBe(false)
  } finally {
    await browser.close()
  }
})


test('ordinary document scrolling is not an out-of-viewport defect', async () => {
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 320, height: 200 } })
    await page.setContent('<main style="height:1000px"><button style="margin-top:800px">Later</button></main>')
    const result = await scanFeel(page)
    expect(result.findings.some((finding) => finding.rule === 'out-of-viewport')).toBe(false)
    expect(result.findings.some((finding) => finding.rule === 'blocked-interaction')).toBe(false)
  } finally {
    await browser.close()
  }
})

// C66 class regression: nested ordinary text, equal hierarchy and semantic exceptions.
test('disclosure hierarchy compares computed lightness and weight', async () => {
  const { measureDisclosureHierarchy } = await import('./_feel.mjs')
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage()
    await page.setContent('<details open><summary style="color:oklch(.68 .01 80)">Process</summary><div style="color:oklch(.3 .01 80);font-weight:500">Read document</div></details>')
    expect((await measureDisclosureHierarchy(page.locator('details'))).violations).toHaveLength(1)
    await page.setContent('<details open style="color:oklch(.5 .01 80);font-weight:400"><summary>Process</summary><div><span>Read document</span></div><span data-status style="color:oklch(.3 .1 140)">Done</span></details>')
    expect((await measureDisclosureHierarchy(page.locator('details'), { exclude: '[data-status]' })).violations).toEqual([])
    await page.locator('details > div').evaluate(el => { el.style.fontWeight = '500' })
    expect((await measureDisclosureHierarchy(page.locator('details'), { exclude: '[data-status]' })).violations).toHaveLength(1)
  } finally { await browser.close() }
})

// C75: verify the browser's computed colors, not token names or class strings.
test('media badges: transparent and translucent text fail; OKLCH overlay passes in both themes', async () => {
  const { measureMediaBadgeContrast } = await import('./_feel.mjs')
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage()
    await page.setContent('<span style="color:oklch(.5 .01 80)">Shot 1</span>')
    expect((await measureMediaBadgeContrast(page.locator('span'))).violations).toHaveLength(1)
    await page.locator('span').evaluate(el => { el.style.background = 'oklch(1 0 0 / .9)'; el.style.color = 'oklch(.22 .01 80 / .2)' })
    expect((await measureMediaBadgeContrast(page.locator('span'))).violations).toHaveLength(1)
    for (const [background, foreground] of [['oklch(1 0 0 / .9)', 'oklch(.22 .01 80)'], ['oklch(.235 .007 80 / .9)', 'oklch(.93 .006 85)']]) {
      await page.locator('span').evaluate((el, colors) => { el.style.background = colors[0]; el.style.color = colors[1] }, [background, foreground])
      expect((await measureMediaBadgeContrast(page.locator('span'))).violations).toEqual([])
    }
  } finally { await browser.close() }
})

test('production shot number, mounted names and overflow exceed 4.5 over any media in light/dark', async () => {
  const { createRequire } = await import('node:module')
  const require = createRequire(import.meta.url)
  const { build } = createRequire(require.resolve('vite/package.json'))('esbuild')
  const { measureMediaBadgeContrast } = await import('./_feel.mjs')
  const compiled = await build({
    stdin: { contents: `const React = require('react'); const { renderToStaticMarkup } = require('react-dom/server');
      const { ShotPreviewOverlays } = require('./src/workbench/generationCanvas/nodes/ConvertShotToVideoButton.tsx');
      const ShotMountBadges = require('./src/workbench/generationCanvas/nodes/render/ShotMountBadges.tsx').default;
      module.exports = renderToStaticMarkup(React.createElement('div', null,
        React.createElement(ShotPreviewOverlays, {shotIndex: 1}),
        React.createElement(ShotMountBadges, { cards: [{id:'a',title:'Actor',kind:'character'}, {id:'b',title:'Scene',kind:'scene'}, {id:'c',title:'Prop',kind:'scene'}] })));`, resolveDir: process.cwd() },
    bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external',
    plugins: [{ name: 'translation-fixture', setup(builder) {
      builder.onResolve({ filter: /^react-i18next$/ }, () => ({ path: 'translation', namespace: 'fixture' }))
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: 'exports.useTranslation = () => ({ t: (key, args) => args?.title || args?.index || key })' }))
    } }],
  })
  const module = { exports: {} }
  new Function('require', 'module', 'exports', compiled.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports)
  const config = require('tailwindcss/loadConfig')(`${process.cwd()}/tailwind.config.ts`)
  const css = (await require('postcss')([require('tailwindcss')({ ...config, content: [
    './src/workbench/generationCanvas/nodes/ConvertShotToVideoButton.tsx',
    './src/workbench/generationCanvas/nodes/render/ShotMountBadges.tsx',
  ] })]).process('@tailwind base; @tailwind utilities;', { from: undefined })).css
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage()
    await page.setContent(`<style>${css}</style>${module.exports}`)
    for (const theme of ['light', 'dark']) {
      await page.locator('html').evaluate((el, theme) => el.setAttribute('data-mantine-color-scheme', theme), theme)
      const result = await measureMediaBadgeContrast(page.locator('[data-shot-number], [data-node-mount-badges] > span'))
      expect(result.rows).toHaveLength(4)
      expect(result.violations, `${theme}: ${JSON.stringify(result.rows)}`).toEqual([])
    }
  } finally { await browser.close() }
})
