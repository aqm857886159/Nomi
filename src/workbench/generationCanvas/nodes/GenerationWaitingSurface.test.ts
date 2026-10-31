import { createRequire } from 'node:module'
import { chromium } from 'playwright'
import { describe, expect, it } from 'vitest'

describe('waiting surface idle drawing', () => {
  it('12 real waiting surfaces produce zero canvas draws during a pending second', async () => {
    const require = createRequire(import.meta.url)
    const { build } = createRequire(require.resolve('vite/package.json'))('esbuild')
    const result = await build({ stdin: { contents: `
      import React from 'react'; import { createRoot } from 'react-dom/client';
      import { GenerationWaitingSurface } from './src/workbench/generationCanvas/nodes/GenerationWaitingSurface';
      let draws = 0;
      for (const proto of [CanvasRenderingContext2D.prototype, WebGLRenderingContext.prototype, WebGL2RenderingContext.prototype]) {
        for (const name of ['drawImage', 'drawArrays', 'drawElements']) {
          const real = proto[name]; if (!real) continue;
          proto[name] = function(...args) { draws++; return real.apply(this, args); };
        }
      }
      window.idleDraws = () => draws;
      createRoot(document.getElementById('root')).render(<>{Array.from({length:12}, (_, key) =>
        <div key={key} style={{position:'relative',width:120,height:90}}><GenerationWaitingSurface previewLabel="" percent={42}/></div>)}</>);
    `, resolveDir: process.cwd(), loader: 'tsx' }, bundle: true, write: false, format: 'iife', platform: 'browser', define: { 'process.env.NODE_ENV': '"production"' } })
    console.log('WAITING_PROBE bundle ready')
    const browser = await chromium.launch({ args: process.platform === 'darwin' ? ['--use-angle=metal'] : [] })
    try {
      console.log('WAITING_PROBE browser ready')
      const page = await browser.newPage({ reducedMotion: 'no-preference' })
      page.on('pageerror', error => console.error('WAITING_PROBE renderer', error.message))
      console.log('WAITING_PROBE page ready')
      await page.setContent('<style>:root{--nomi-ink:#000;--nomi-paper:#fff;--nomi-ink-05:#eee;--nomi-accent:#57f;--nomi-accent-soft:#aaf}</style><main id="root"></main>')
      await page.addScriptTag({ content: result.outputFiles[0].text })
      console.log('WAITING_PROBE mounted script')
      await page.waitForFunction(() => document.querySelectorAll('[data-generation-waiting]').length === 12)
      const samples = await page.evaluate(async () => {
        const draws = () => (window as unknown as { idleDraws: () => number }).idleDraws()
        const before = draws()
        await new Promise(resolve => setTimeout(resolve, 1100)) // measurement window, not a readiness sleep
        return { draws: draws() - before, static: document.querySelectorAll('[data-process-static-grid]').length }
      })
      console.log('WAITING_IDLE', JSON.stringify({ k: 12, seconds: 1.1, ...samples }))
      expect(samples.draws).toBe(0)
      expect(samples.static).toBe(12)
    } finally { await browser.close() }
  })
})
