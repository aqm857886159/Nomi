import { createRequire } from 'node:module'
import { chromium } from 'playwright'
import { expect, it } from 'vitest'

// 守卫（I-persona-guards）：形象脸的眨眼计时器认「减弱动效」。
// 验收时发现：把 useAgentBlink 里的 `prefersReducedMotion()` 判断删掉，没有任何单测红
// （CSS 里的 motion-reduce:animate-none 只管动画，计时器照样每 20 秒给脸根加 data-blink）。
// 这里在真浏览器里用假时钟走 20 秒：减弱动效 → 脸根上不出现 data-blink；正常 → 出现、600ms 后摘掉。

async function bundle(contents: string): Promise<string> {
  const require = createRequire(import.meta.url)
  const { build } = createRequire(require.resolve('vite/package.json'))('esbuild')
  const result = await build({ stdin: { contents, resolveDir: process.cwd(), loader: 'tsx' }, bundle: true, write: false, platform: 'browser', format: 'iife', loader: { '.css': 'empty', '.svg': 'dataurl', '.png': 'dataurl' }, logLevel: 'error', define: { 'process.env.NODE_ENV': '"development"', 'import.meta.url': '"http://localhost/"', 'import.meta.env': '{}' } })
  return result.outputFiles[0].text
}

it('眨眼计时器：系统开了减弱动效就不眨；正常时约 20 秒眨一次、600ms 后摘掉', async () => {
  const script = await bundle(`
    import React from 'react'; import { createRoot } from 'react-dom/client';
    import { NomiAgentFace } from './src/design/identity';
    createRoot(document.getElementById('root')).render(<NomiAgentFace pose="idle" size={44} />);
  `)
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage({ viewport: { width: 400, height: 300 }, reducedMotion: 'reduce' })
    const pageErrors: string[] = []
    page.on('pageerror', (error) => pageErrors.push(error.message))
    await page.clock.install()
    await page.setContent('<main id="root"></main>')
    await page.addScriptTag({ content: script })
    await page.waitForSelector('[data-nomi-agent-face]', { timeout: 5000 }).catch((error: Error) => {
      throw new Error(`${error.message}\n页面错误：${pageErrors.join(' / ')}`)
    })
    const blinking = (): Promise<boolean> => page.evaluate(() => document.querySelector('[data-nomi-agent-face]')?.hasAttribute('data-blink') ?? false)

    // 减弱动效：走过两个 20 秒周期，一次都不眨（逐秒推进，免得恰好跳过 600ms 的窗口）。
    let sawBlinkWhileReduced = false
    for (let second = 0; second < 41; second += 1) {
      await page.clock.runFor(1000)
      if (await blinking()) sawBlinkWhileReduced = true
    }
    expect(sawBlinkWhileReduced, '系统开了减弱动效，眨眼计时器还在给脸加 data-blink').toBe(false)

    // 正常动效：下一个周期点上出现，600ms 后摘掉。
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    let saw = false
    for (let second = 0; second < 21; second += 1) {
      await page.clock.runFor(1000)
      if (await blinking()) saw = true
    }
    expect(saw, '正常动效下 20 秒内没眨过眼，测试本身测不到东西').toBe(true)
    await page.clock.runFor(1000)
    expect(await blinking(), '眨完 data-blink 没摘掉').toBe(false)
    expect(pageErrors).toEqual([])
  } finally { await browser.close() }
}, 60_000)
