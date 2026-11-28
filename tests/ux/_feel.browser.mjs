import { test } from 'node:test'
import { expect } from '@playwright/test'
import { chromium } from 'playwright'
import { scanFeel } from './_feel.mjs'

test('AnchoredPopover owns Escape before React Flow selection, yielding to nested layers', async (t) => {
  const { createRequire } = await import('node:module')
  const { readFile } = await import('node:fs/promises')
  const require = createRequire(import.meta.url)
  const { build } = createRequire(require.resolve('vite/package.json'))('esbuild')
  const compiled = await build({
    stdin: { contents: `
      import React from 'react';
      import { createRoot } from 'react-dom/client';
      import { createPortal } from 'react-dom';
      import { ReactFlow, useNodesState } from '@xyflow/react';
      import { AnchoredPopover } from './src/design/AnchoredPopover';
      import { NOMI_OVERLAY_Z_INDEX } from './src/design/overlayLayers';
      function TestNode({ selected }) {
        const [open, setOpen] = React.useState(false);
        const [upper, setUpper] = React.useState(null);
        const [draft, setDraft] = React.useState('draft');
        React.useEffect(() => {
          if (!upper) return;
          const onKey = event => {
            if (event.key !== 'Escape') return;
            event.preventDefault(); event.stopPropagation(); setUpper(null);
          };
          document.addEventListener('keydown', onKey);
          return () => document.removeEventListener('keydown', onKey);
        }, [upper]);
        const anchor = React.useRef(null);
        const close = () => { setOpen(false); anchor.current?.focus(); };
        return <div style={{width: 240, height: 100}} data-testid="fixture-node" data-selected={selected}>
          <span>Canvas node</span>
          {selected && <div data-testid="fixture-composer">
            <button ref={anchor} onClick={() => setOpen(!open)}>Effects</button>
            {open && <AnchoredPopover anchorRef={anchor} onClose={close}>
              <div role="dialog" aria-label="Effects menu">
                <input aria-label="Search effects" autoFocus />
                {['prevent', 'stop'].map(mode => <input key={mode} aria-label={'Owned Escape ' + mode} value={draft}
                  onChange={event => setDraft(event.target.value)} onKeyDown={event => {
                    if (event.key !== 'Escape' || !draft) return;
                    if (mode === 'prevent') event.preventDefault();
                    else event.stopPropagation();
                    setDraft('');
                  }} />)}
                <button onClick={() => {}}>Effect category</button>
                <button aria-expanded={upper === 'listbox'} onClick={() => setUpper('listbox')}>Nested options</button>
                <button onClick={() => setUpper('dialog')}>Confirm effect</button>
              </div>
            </AnchoredPopover>}
            {upper && createPortal(<div role={upper} aria-label="Upper layer"
              style={{position: 'fixed', top: 350, left: 300, zIndex: NOMI_OVERLAY_Z_INDEX.confirmation}}
              onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setUpper(null); } }}>
              <button autoFocus>Upper action</button>
            </div>, document.body)}
          </div>}
        </div>;
      }
      const nodeTypes = { fixture: TestNode };
      function App() {
        const [nodes, , onNodesChange] = useNodesState([{id:'fixture',type:'fixture',position:{x:100,y:100},selected:true,data:{}}]);
        return <div style={{width: 800, height: 600}}><ReactFlow nodes={nodes} onNodesChange={onNodesChange} nodeTypes={nodeTypes} /></div>;
      }
      createRoot(document.getElementById('root')).render(<App />);
    `, resolveDir: process.cwd(), loader: 'tsx' },
    bundle: true, write: false, platform: 'browser', format: 'iife',
    define: { 'process.env.NODE_ENV': '"development"' },
  })
  const css = await readFile(require.resolve('@xyflow/react/dist/style.css'), 'utf8')
  const browser = await chromium.launch({ headless: true })
  const withFixture = async (action) => {
    const page = await browser.newPage()
    try {
      await page.setContent('<button>Outside control</button><main id="root"></main>')
      await page.addStyleTag({ content: css })
      await page.addScriptTag({ content: compiled.outputFiles[0].text })
      await page.getByRole('button', { name: 'Effects', exact: true }).click()
      await expect(page.getByRole('dialog', { name: 'Effects menu' })).toBeVisible()
      await action(page)
    } finally { await page.close() }
  }
  const expectSelected = async (page) => {
    await expect(page.getByTestId('fixture-node')).toHaveAttribute('data-selected', 'true')
    await expect(page.getByTestId('fixture-composer')).toBeVisible()
  }
  try {
    for (const mode of ['prevent', 'stop']) {
      await t.test(`inner input ${mode} handles its own Escape before popover dismissal`, () => withFixture(async (page) => {
        const input = page.getByRole('textbox', { name: `Owned Escape ${mode}` })
        await input.click()
        await page.keyboard.press('Escape')
        await expect(page.getByRole('dialog', { name: 'Effects menu' })).toBeVisible()
        await expect(input).toHaveValue('')
        await expectSelected(page)
        await page.keyboard.press('Escape')
        await expect(page.getByRole('dialog', { name: 'Effects menu' })).toBeHidden()
        await expectSelected(page)
      }))
    }
    await t.test('native input handler can prevent Escape before the portal bubble handler', () => withFixture(async (page) => {
      const input = page.getByRole('textbox', { name: 'Search effects' })
      await input.evaluate(input => input.addEventListener('keydown', event => {
        if (event.key === 'Escape') { event.preventDefault(); input.value = 'handled'; }
      }, { once: true }))
      await input.click()
      await page.keyboard.press('Escape')
      await expect(page.getByRole('dialog', { name: 'Effects menu' })).toBeVisible()
      await expect(input).toHaveValue('handled')
      await expectSelected(page)
    }))
    for (const focus of ['natural', 'trigger', 'menu-button', 'input']) {
      await t.test(`Escape from ${focus} closes only the popover`, () => withFixture(async (page) => {
        if (focus === 'trigger') await page.getByRole('button', { name: 'Effects', exact: true }).focus()
        if (focus === 'menu-button') await page.getByRole('button', { name: 'Effect category' }).click()
        if (focus === 'input') await page.getByRole('textbox', { name: 'Search effects' }).click()
        const active = await page.evaluate(() => ({ tag: document.activeElement?.tagName, text: document.activeElement?.textContent, label: document.activeElement?.getAttribute('aria-label') }))
        console.log('POPOVER_ESCAPE_FOCUS', JSON.stringify({ focus, active }))
        await page.keyboard.press('Escape')
        await expect(page.getByRole('dialog', { name: 'Effects menu' })).toBeHidden()
        await expectSelected(page)
      }))
    }
    for (const upper of ['listbox', 'dialog']) {
      await t.test(`upper ${upper} still receives Escape when focus remains in the lower input`, () => withFixture(async (page) => {
        await page.getByRole('button', { name: upper === 'listbox' ? 'Nested options' : 'Confirm effect' }).click()
        await expect(page.getByRole(upper, { name: 'Upper layer' })).toBeVisible()
        await page.getByRole('textbox', { name: 'Search effects' }).focus()
        await page.keyboard.press('Escape')
        await expect(page.getByRole(upper, { name: 'Upper layer' })).toBeHidden()
        await expect(page.getByRole('dialog', { name: 'Effects menu' })).toBeVisible()
        await expectSelected(page)
      }))
      await t.test(`upper ${upper} receives the first Escape`, () => withFixture(async (page) => {
        await page.getByRole('button', { name: upper === 'listbox' ? 'Nested options' : 'Confirm effect' }).click()
        await expect(page.getByRole(upper, { name: 'Upper layer' })).toBeVisible()
        await page.keyboard.press('Escape')
        await expect(page.getByRole(upper, { name: 'Upper layer' })).toBeHidden()
        await expect(page.getByRole('dialog', { name: 'Effects menu' })).toBeVisible()
        await expectSelected(page)
        await page.getByRole('textbox', { name: 'Search effects' }).click()
        await page.keyboard.press('Escape')
        await expect(page.getByRole('dialog', { name: 'Effects menu' })).toBeHidden()
        await expectSelected(page)
      }))
    }
    for (const condition of ['composing', 'prevented']) {
      await t.test(`${condition} Escape leaves the current popover open`, () => withFixture(async (page) => {
        // Chromium keyboard automation cannot set IME/defaultPrevented; dispatch just these event contracts.
        await page.getByRole('textbox', { name: 'Search effects' }).evaluate((input, condition) => {
          const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true, isComposing: condition === 'composing' })
          if (condition === 'prevented') event.preventDefault()
          input.dispatchEvent(event)
        }, condition)
        await expect(page.getByRole('dialog', { name: 'Effects menu' })).toBeVisible()
        await expectSelected(page)
      }))
    }
    await t.test('ordinary outside click still closes the popover', () => withFixture(async (page) => {
      await page.getByRole('button', { name: 'Outside control' }).click()
      await expect(page.getByRole('dialog', { name: 'Effects menu' })).toBeHidden()
    }))
  } finally { await browser.close() }
})

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

test('production shot role badge, mounted names and overflow exceed 4.5 over any media in light/dark', async () => {
  const { createRequire } = await import('node:module')
  const require = createRequire(import.meta.url)
  const { build } = createRequire(require.resolve('vite/package.json'))('esbuild')
  const { measureMediaBadgeContrast } = await import('./_feel.mjs')
  const compiled = await build({
    stdin: { contents: `const React = require('react'); const { renderToStaticMarkup } = require('react-dom/server');
      const { ShotPreviewOverlays } = require('./src/workbench/generationCanvas/nodes/ConvertShotToVideoButton.tsx');
      const ShotMountBadges = require('./src/workbench/generationCanvas/nodes/render/ShotMountBadges.tsx').default;
      module.exports = renderToStaticMarkup(React.createElement('div', null,
        React.createElement(ShotPreviewOverlays, {shotRole: 'first_frame'}),
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

test('duplicate-nearby-header catches double brand/dialog headers while sparing sibling nodes and chat streams', async () => {
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
    const icon = '<svg width="16" height="16" viewBox="0 0 24 24"><rect width="20" height="20" rx="5" fill="black"/></svg>'

    // Positive 1: Dock header [icon + Brand] + body card [icon + Brand] 22px underneath (real 1440x900 bug shape)
    await page.setContent(`
      <div style="display:flex;width:1400px;height:860px">
        <main style="flex:1">Workspace</main>
        <section style="width:390px;display:flex;flex-direction:column;border-left:1px solid #ddd">
          <header style="height:40px;display:flex;align-items:center;padding:0 12px;border-bottom:1px solid #eee">
            <div style="display:inline-flex;align-items:center;gap:6px">${icon}<span>Studio<span>m</span>i</span></div>
          </header>
          <div style="padding:12px">
            <div style="display:flex;flex-direction:column;gap:8px">
              <div style="display:flex;align-items:center;gap:6px">${icon}<span>Studio<span>m</span>i</span></div>
              <p style="margin:0">Connect a model provider first.</p>
              <button type="button">Connect provider</button>
            </div>
          </div>
        </section>
      </div>
    `)
    const dockDup = await scanFeel(page)
    expect(dockDup.findings.filter((f) => f.rule === 'duplicate-nearby-header')).toHaveLength(1)

    // Positive 2: Dialog <header> title repeated as <h2> immediately underneath
    await page.setContent(`
      <div role="dialog" style="width:640px;border:1px solid #ccc">
        <header style="height:44px;display:flex;align-items:center;padding:0 16px"><strong>模型设置</strong></header>
        <div style="padding:12px 16px"><h2 style="margin:0;font-size:16px">模型设置</h2><p>Body</p></div>
      </div>
    `)
    expect((await scanFeel(page)).findings.filter((f) => f.rule === 'duplicate-nearby-header')).toHaveLength(1)

    // Negative 1: Fixed dock (single header, body goes straight to guidance + action card)
    await page.setContent(`
      <section style="width:390px;display:flex;flex-direction:column">
        <header style="height:40px;display:flex;align-items:center;padding:0 12px">
          <div style="display:inline-flex;align-items:center;gap:6px">${icon}<span>Studiomi</span></div>
        </header>
        <div style="padding:12px">
          <p style="margin:0">Connect a model provider first.</p>
          <button type="button">Connect provider</button>
        </div>
      </section>
    `)
    expect((await scanFeel(page)).findings.filter((f) => f.rule === 'duplicate-nearby-header')).toEqual([])

    // Negative 2: Two stacked sibling empty canvas cards both labeled "图片" (peer domain items, not header+body)
    await page.setContent(`
      <main style="position:relative;width:900px;height:700px">
        <div style="position:absolute;left:200px;top:120px;width:220px;height:60px;border:1px solid #ddd">
          <div style="display:inline-flex;align-items:center;gap:6px">${icon}<span>图片</span></div>
        </div>
        <div style="position:absolute;left:200px;top:200px;width:220px;height:60px;border:1px solid #ddd">
          <div style="display:inline-flex;align-items:center;gap:6px">${icon}<span>图片</span></div>
        </div>
      </main>
    `)
    expect((await scanFeel(page)).findings.filter((f) => f.rule === 'duplicate-nearby-header')).toEqual([])
  } finally {
    await browser.close()
  }
})

test('duplicate-action-bar catches empty-canvas twin 7-button bars while sparing zoom bar, context menus, and item rows', async () => {
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
    const intents = [
      ['Add image item', 'Image', 'M3 6h18v12H3z'],
      ['Add video item', 'Video', 'M3 6h12v12H3zM15 10l6-3v10l-6-3z'],
      ['Add audio item', 'Audio', 'M3 12h4l3-6 4 12 3-6h4'],
      ['Add text item', 'Text', 'M5 20l7-16 7 16M8 14h8'],
      ['Add clip item', 'Clip', 'M6 7a3 3 0 1 0 0 .1M6 17a3 3 0 1 0 0 .1M8.6 8.6L19 19'],
      ['Import local file', 'Import', 'M4 17v2h16v-2M12 4v12M7 9l5-5 5 5'],
    ]
    const starterTiles = intents
      .map(([aria, label, d]) => `<button type="button" aria-label="${aria}" style="width:68px;height:64px"><svg width="20" height="20" viewBox="0 0 24 24"><path d="${d}"/></svg><span>${label}</span></button>`)
      .join('') + `<button type="button" aria-haspopup="menu" style="width:68px;height:64px"><svg width="20" height="20" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg><span>More</span></button>`
    const moreLabel = 'More items'
    const bottomDock = intents
      .map(([aria, , d]) => `<button type="button" aria-label="${aria}" style="width:32px;height:32px"><svg width="18" height="18" viewBox="0 0 24 24"><path d="${d}"/></svg></button>`)
      .join('') + `<button type="button" aria-label="${moreLabel}" aria-haspopup="menu" style="width:32px;height:32px"><svg width="18" height="18" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg></button>`
    const zoomButtons = [
      ['Fit stage', 'fit', true],
      ['Zoom out stage', '-', false],
      ['Zoom in stage', '+', false],
      ['Stage view options', '...', false],
    ]
    const zoomDock = `
      <div style="position:absolute;left:16px;bottom:16px;display:inline-flex;gap:4px">
        <button type="button" aria-label="${zoomButtons[0][0]}" disabled style="width:32px;height:32px">${zoomButtons[0][1]}</button>
        <button type="button" aria-label="${zoomButtons[1][0]}" style="width:32px;height:32px">${zoomButtons[1][1]}</button>
        <span style="font-size:12px">100%</span>
        <button type="button" aria-label="${zoomButtons[2][0]}" style="width:32px;height:32px">${zoomButtons[2][1]}</button>
        <button type="button" aria-label="${zoomButtons[3][0]}" style="width:32px;height:32px">${zoomButtons[3][1]}</button>
      </div>
    `

    // Positive: Empty canvas has BOTH central 7 starter tiles AND bottom 7-icon dock
    await page.setContent(`
      <section style="position:relative;width:1000px;height:800px">
        <div style="position:absolute;left:260px;top:300px;display:flex;flex-direction:column;align-items:center">
          <strong>Empty stage</strong>
          <div style="display:flex;gap:8px;margin-top:16px">${starterTiles}</div>
        </div>
        <div style="position:absolute;left:360px;bottom:16px;display:inline-flex;gap:4px">${bottomDock}</div>
        ${zoomDock}
      </section>
    `)
    expect((await scanFeel(page)).findings.filter((f) => f.rule === 'duplicate-action-bar')).toHaveLength(1)

    // Negative 1: Fixed empty canvas (central 7 tiles + bottom-left zoom bar ONLY)
    await page.setContent(`
      <section style="position:relative;width:1000px;height:800px">
        <div style="position:absolute;left:260px;top:300px;display:flex;flex-direction:column;align-items:center">
          <strong>Empty stage</strong>
          <div style="display:flex;gap:8px;margin-top:16px">${starterTiles}</div>
        </div>
        ${zoomDock}
      </section>
    `)
    expect((await scanFeel(page)).findings.filter((f) => f.rule === 'duplicate-action-bar')).toEqual([])

    // Negative 2: Populated canvas with bottom 7-icon dock + open right-click context menu (role="menu")
    await page.setContent(`
      <section style="position:relative;width:1000px;height:800px">
        <div role="menu" style="position:absolute;left:400px;top:220px;display:grid;gap:4px">
          ${intents.map(([aria, label, d]) => `<button type="button" role="menuitem" aria-label="${aria}"><svg width="16" height="16" viewBox="0 0 24 24"><path d="${d}"/></svg><span>${label}</span></button>`).join('')}
        </div>
        <div style="position:absolute;left:360px;bottom:16px;display:inline-flex;gap:4px">${bottomDock}</div>
        ${zoomDock}
      </section>
    `)
    expect((await scanFeel(page)).findings.filter((f) => f.rule === 'duplicate-action-bar')).toEqual([])

    // Negative 3: Repeating message cards / table rows each carrying 4 item-scoped action buttons
    const rowActions = ['Copy item', 'Retry item', 'Continue item', 'Rate item']
      .map((label) => `<button type="button" aria-label="${label}">${label}</button>`)
      .join('')
    const msgActions = `<div style="display:flex;gap:6px">${rowActions}</div>`
    await page.setContent(`
      <div style="display:flex;flex-direction:column;gap:16px;width:380px">
        <div class="msg-item"><p>第一段分镜草稿已经写好，共 6 镜。</p>${msgActions}</div>
        <div class="msg-item"><p>已把第 2 镜改成雨夜近景。</p>${msgActions}</div>
      </div>
    `)
    expect((await scanFeel(page)).findings.filter((f) => f.rule === 'duplicate-action-bar')).toEqual([])
  } finally {
    await browser.close()
  }
})

test('duplicate-persona-stage catches twin live personas while sparing stage handoff and hidden portals', async () => {
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
    const liveFace = '<span data-persona-stage="live" style="display:inline-block;width:24px;height:24px;background:#111;border-radius:6px"></span>'
    const toggleIcon = '<svg width="18" height="18" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2" fill="none" stroke="currentColor"/></svg>'

    // Positive: Topbar right AND open panel header both show a visible live persona at once
    await page.setContent(`
      <div style="display:flex;flex-direction:column;width:1400px;height:860px">
        <header style="height:40px;display:flex;justify-content:flex-end;align-items:center;padding:0 8px">
          <button type="button" style="width:28px;height:28px">${liveFace}</button>
        </header>
        <section style="margin-left:auto;width:390px;height:800px">
          <header style="height:48px;display:flex;align-items:center;padding:0 12px">${liveFace}<span>Assistant</span></header>
        </section>
      </div>
    `)
    expect((await scanFeel(page)).findings.filter((f) => f.rule === 'duplicate-persona-stage')).toHaveLength(1)

    // Negative 1 (Panel open): Topbar steps back to linear toggle icon, open panel header owns sole live persona
    await page.setContent(`
      <div style="display:flex;flex-direction:column;width:1400px;height:860px">
        <header style="height:40px;display:flex;justify-content:flex-end;align-items:center;padding:0 8px">
          <button type="button" style="width:28px;height:28px">${toggleIcon}</button>
        </header>
        <section style="margin-left:auto;width:390px;height:800px">
          <header style="height:48px;display:flex;align-items:center;padding:0 12px">${liveFace}<span>Assistant</span></header>
        </section>
      </div>
    `)
    expect((await scanFeel(page)).findings.filter((f) => f.rule === 'duplicate-persona-stage')).toEqual([])

    // Negative 2 (Panel collapsed): Topbar owns sole live persona, collapsed portal is hidden
    await page.setContent(`
      <div style="display:flex;flex-direction:column;width:1400px;height:860px">
        <header style="height:40px;display:flex;justify-content:flex-end;align-items:center;padding:0 8px">
          <button type="button" style="width:28px;height:28px">${liveFace}</button>
        </header>
        <div hidden>
          <section style="width:390px;height:800px"><header>${liveFace}</header></section>
        </div>
      </div>
    `)
    expect((await scanFeel(page)).findings.filter((f) => f.rule === 'duplicate-persona-stage')).toEqual([])
  } finally {
    await browser.close()
  }
})
