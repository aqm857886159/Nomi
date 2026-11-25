import { createRequire } from 'node:module'
import { chromium } from 'playwright'
import { expect, it } from 'vitest'

it('adds a 3D node through More while the selected node composer clips the dock, and closes when canvas hides', async () => {
  const require = createRequire(import.meta.url)
  const { build } = createRequire(require.resolve('vite/package.json'))('esbuild')
  const bundle = await build({
    stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
      import React from 'react'
      import { createRoot } from 'react-dom/client'
      import CanvasToolbar from './src/workbench/generationCanvas/components/CanvasToolbar'
      import { GenerationPageLayerProvider } from './src/workbench/generation/pageLayerContext'
      import { useGenerationCanvasStore } from './src/workbench/generationCanvas/store/generationCanvasStore'

      useGenerationCanvasStore.getState().addNode({ kind: 'video' })
      function Canvas() {
        const nodes = useGenerationCanvasStore(s => s.nodes)
        const [active, setActive] = React.useState(true)
        const [escaped, setEscaped] = React.useState(0)
        React.useEffect(() => {
          const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape' && !event.defaultPrevented) setEscaped((n) => n + 1)
          }
          window.addEventListener('keydown', onKeyDown)
          return () => window.removeEventListener('keydown', onKeyDown)
        }, [])
        React.useEffect(() => {
          (window as unknown as { __hideCanvas?: () => void }).__hideCanvas = () => setActive(false)
        }, [])
        return <GenerationPageLayerProvider value={{ host: null, active }}>
          <main data-shortcut-surface="canvas">
            <div className="generation-canvas-v2-node__composer" />
            <CanvasToolbar getInsertionPosition={() => ({ x: 0, y: 0 })} />
            <output>{nodes.map(node => node.kind).join(',')}:{escaped}</output>
          </main>
        </GenerationPageLayerProvider>
      }
      createRoot(document.getElementById('root')).render(<Canvas />)
    ` },
    bundle: true, write: false, platform: 'browser', jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env': '{}', 'import.meta.url': '"http://localhost/"' },
    loader: { '.css': 'empty', '.glb': 'dataurl', '.hdr': 'dataurl', '.svg': 'dataurl' },
  })
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage()
    await page.route('http://localhost/', route => route.fulfill({ contentType: 'text/html', body: `
      <style>
        .generation-canvas-v2-toolbar { position:absolute; display:flex; top:350px; left:100px; }
        .generation-canvas-v2-node__composer { position:absolute; top:300px; left:80px; width:30px; height:80px; }
      </style><div id="root"></div>
    ` }))
    await page.goto('http://localhost/')
    await page.addScriptTag({ content: bundle.outputFiles[0].text })
    const dock = page.locator('.generation-canvas-v2-toolbar')
    const trigger = dock.locator('[data-canvas-add-more="true"]')
    const menu = page.locator('.generation-canvas-v2-toolbar__more-menu')
    await trigger.waitFor()
    await expect.poll(() => dock.evaluate(el => getComputedStyle(el).clipPath)).toMatch(/^path\(/)
    await trigger.click()
    await menu.waitFor()
    expect(await dock.locator('[role="menu"]').count()).toBe(0)
    await trigger.click()
    await menu.waitFor({ state: 'detached' })
    await trigger.click()
    await menu.locator('[data-node-kind="model3d"]').click()
    await expect.poll(() => page.locator('output').textContent()).toBe('video,model3d:0')
    expect(await menu.count()).toBe(0)
    await trigger.click()
    await menu.waitFor()
    await page.evaluate(() => {
      (document.activeElement as HTMLElement | null)?.blur?.()
      ;(window as unknown as { __hideCanvas: () => void }).__hideCanvas()
    })
    await menu.waitFor({ state: 'detached' })
    await expect.poll(() => trigger.getAttribute('aria-expanded')).toBe('false')
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.())
    await page.keyboard.press('Escape')
    await expect.poll(() => page.locator('output').textContent()).toBe('video,model3d:1')
  } finally {
    await browser.close()
  }
})
