import { createRequire } from 'node:module'
import { chromium } from 'playwright'
import { expect, it } from 'vitest'

// 设计卡 docs/plan/2026-10-27-agent-persona.md ★7 / ★9 反例「眼睛跟随引起整个外壳重渲染（React Profiler 看提交次数）」：
// 真浏览器里挂上生产的 AgentBallFace，用 React.Profiler 数提交，用包一层的 requestAnimationFrame 数请求的帧。
it('眼睛跟随：rAF 合并、只写 CSS 变量、零重渲染；离远归位，减弱动效不跟，卸载取消，空闲不请求帧', async () => {
  const require = createRequire(import.meta.url)
  const { build } = createRequire(require.resolve('vite/package.json'))('esbuild')
  const result = await build({ stdin: { contents: `
    import React from 'react'; import { flushSync } from 'react-dom'; import { createRoot } from 'react-dom/client';
    import { AgentBallFace } from './src/ui/app-shell/shell/AgentBallFace';
    let commits = 0, rafRequests = 0, rafCancels = 0;
    const realRaf = window.requestAnimationFrame.bind(window), realCancel = window.cancelAnimationFrame.bind(window);
    window.requestAnimationFrame = (cb) => { rafRequests++; return realRaf(cb) };
    window.cancelAnimationFrame = (id) => { rafCancels++; return realCancel(id) };
    function App() {
      const [show, setShow] = React.useState(true);
      window.unmountNow = () => flushSync(() => setShow(false));
      return <div style={{ position: 'fixed', right: 40, bottom: 40, width: 44, height: 44 }}>
        {show ? <React.Profiler id="ball" onRender={() => { commits++ }}><AgentBallFace status="idle" pendingCount={0} label="Nomi" /></React.Profiler> : null}
      </div>
    }
    window.stats = () => {
      const ball = document.querySelector('[data-agent-ball]');
      return { commits, rafRequests, rafCancels, x: ball?.style.getPropertyValue('--nomi-agent-look-x') ?? null, y: ball?.style.getPropertyValue('--nomi-agent-look-y') ?? null };
    };
    window.burst = (x, y, n) => { for (let i = 0; i < n; i++) window.dispatchEvent(new PointerEvent('pointermove', { clientX: x + i * 0.1, clientY: y })) };
    createRoot(document.getElementById('root')).render(<App />);
  `, resolveDir: process.cwd(), loader: 'tsx' }, bundle: true, write: false, platform: 'browser', format: 'iife', loader: { '.css': 'empty', '.svg': 'dataurl', '.png': 'dataurl' }, logLevel: 'error', define: { 'process.env.NODE_ENV': '"development"', 'import.meta.url': '"http://localhost/"', 'import.meta.env': '{}' } })
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage({ viewport: { width: 800, height: 600 }, reducedMotion: 'no-preference' })
    const pageErrors: string[] = []
    page.on('pageerror', (error) => pageErrors.push(error.message))
    // 没有 Tailwind 产物：手写按钮的 h-11 w-11（44px）好让命中区和真小球一样大。
    await page.setContent('<style>[data-agent-ball]{display:block;width:44px;height:44px;padding:0;border:0}</style><main id="root"></main>')
    await page.addScriptTag({ content: result.outputFiles[0].text })
    await page.waitForSelector('[data-agent-ball]', { timeout: 5000 }).catch((error: Error) => {
      throw new Error(`${error.message}\n页面错误：${pageErrors.join(' / ')}`)
    })
    type Stats = { commits: number; rafRequests: number; rafCancels: number; x: string | null; y: string | null }
    const stats = (): Promise<Stats> => page.evaluate('window.stats()') as Promise<Stats>
    const settle = () => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    await settle()
    const base = await stats()

    // 空闲：鼠标不动 1 秒，跟随不请求任何帧。
    await page.waitForTimeout(1000)
    const idle = await stats()
    expect(idle.rafRequests - base.rafRequests, '鼠标不动时还在请求动画帧').toBe(0)

    // 球心约在 (738, 538)。同一个任务里连发 50 次 pointermove：只请求 1 帧（rAF 合并）。
    await page.evaluate('window.burst(640, 538, 50)')
    const queued = await stats()
    expect(queued.rafRequests - idle.rafRequests, '50 次移动应合并成 1 帧').toBe(1)
    await settle()
    const looked = await stats()
    expect(Number.parseFloat(looked.x ?? ''), '鼠标在左边 100px，眼睛没往左看').toBeLessThan(0)
    expect(looked.commits, '跟随引起了 React 重渲染').toBe(base.commits)

    // 真鼠标绕着球转一圈（Playwright 的 mouse.move 走真指针事件）：照样零重渲染。
    for (let step = 0; step < 60; step += 1) {
      const angle = (step / 60) * Math.PI * 2
      await page.mouse.move(738 + Math.cos(angle) * 90, 538 + Math.sin(angle) * 60)
    }
    await settle()
    const circled = await stats()
    expect(circled.commits, '绕球转一圈引起了 React 重渲染').toBe(base.commits)
    expect(circled.rafRequests - looked.rafRequests, '60 次移动请求的帧不该超过移动次数').toBeLessThanOrEqual(60)

    // 鼠标停在身上：抬眼。
    await page.mouse.move(738, 538)
    await settle()
    expect(Number.parseFloat((await stats()).y ?? ''), '停在身上没抬眼').toBeLessThan(0)

    // 离远（> 160px）：归位（变量摘掉），之后再远也不再写。
    await page.mouse.move(100, 100)
    await settle()
    const rested = await stats()
    expect(rested.x, '离远了眼睛没归位').toBe('')

    // 减弱动效：不挂监听，移动不请求帧、不写变量。
    // （媒体查询的 change 事件在下一帧渲染时才派发，先等它落地再量。）
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await settle()
    const reducedBase = await stats()
    await page.evaluate('window.burst(640, 538, 20)')
    await settle()
    const reduced = await stats()
    expect(reduced.x, '减弱动效时眼睛还在跟').toBe('')
    expect(reduced.rafRequests - reducedBase.rafRequests - 2, '减弱动效时跟随还在请求帧（扣掉 settle 自己的 2 帧）').toBe(0)
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await settle()

    // 卸载：还没跑的那一帧被取消，之后的移动不再请求帧。移动和卸载放在同一个任务里同步做完（flushSync），
    // 免得机器忙时那一帧在两次 evaluate 之间先跑掉、没东西可取消。
    const beforeUnmount = await stats()
    await page.evaluate('window.burst(640, 538, 3); window.unmountNow()')
    await settle()
    const unmounted = await stats()
    expect(unmounted.rafRequests - beforeUnmount.rafRequests, '卸载前那 3 次移动应排了 1 帧').toBeGreaterThanOrEqual(1)
    expect(unmounted.rafCancels - beforeUnmount.rafCancels, '卸载时没取消排着的那一帧').toBeGreaterThanOrEqual(1)
    await page.evaluate('window.burst(640, 538, 10)')
    const after = await stats()
    expect(after.rafRequests - unmounted.rafRequests, '卸载后监听还挂着').toBe(0)
  } finally { await browser.close() }
}, 60_000)
