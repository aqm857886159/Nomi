import { createRequire } from 'node:module'
import { chromium } from 'playwright'
import { expect, it } from 'vitest'

// 把一段挂着生产 AgentBallFace 的 tsx 打成能塞进页面的脚本（没有 Vite，直接用它带的 esbuild）。
async function bundle(contents: string): Promise<string> {
  const require = createRequire(import.meta.url)
  const { build } = createRequire(require.resolve('vite/package.json'))('esbuild')
  const result = await build({ stdin: { contents, resolveDir: process.cwd(), loader: 'tsx' }, bundle: true, write: false, platform: 'browser', format: 'iife', loader: { '.css': 'empty', '.svg': 'dataurl', '.png': 'dataurl' }, logLevel: 'error', define: { 'process.env.NODE_ENV': '"development"', 'import.meta.url': '"http://localhost/"', 'import.meta.env': '{}' } })
  return result.outputFiles[0].text
}

// 设计卡 docs/plan/2026-10-27-agent-persona.md ★7 / ★9 反例「眼睛跟随引起整个外壳重渲染（React Profiler 看提交次数）」：
// 真浏览器里挂上生产的 AgentBallFace，用 React.Profiler 数提交，用包一层的 requestAnimationFrame 数请求的帧。
it('眼睛跟随：rAF 合并、只写 CSS 变量、零重渲染；离远归位，减弱动效不跟，卸载取消，空闲不请求帧', async () => {
  const script = await bundle(`
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
  `)
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage({ viewport: { width: 800, height: 600 }, reducedMotion: 'no-preference' })
    const pageErrors: string[] = []
    page.on('pageerror', (error) => pageErrors.push(error.message))
    // 没有 Tailwind 产物：手写按钮的 h-11 w-11（44px）好让命中区和真小球一样大。
    await page.setContent('<style>[data-agent-ball]{display:block;width:44px;height:44px;padding:0;border:0}</style><main id="root"></main>')
    await page.addScriptTag({ content: script })
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

// 外壳普查「ref / button 属性透传、不抢焦点」：小球换了脸以后 ref 改成合并（自己要拿按钮给眼睛跟随用），
// 这里钉住宿主传的对象 ref、回调 ref 都还拿到那颗原生按钮，宿主的 className / data-* / aria-* / 事件照旧落在按钮上；
// 挂上、鼠标在旁边转，都不把焦点从别处（比如正在写的输入框）抢走。
it('ref 与 button 属性透传照旧，挂上和眼睛跟随都不抢焦点', async () => {
  const script = await bundle(`
    import React from 'react'; import { createRoot } from 'react-dom/client';
    import { AgentBallFace } from './src/ui/app-shell/shell/AgentBallFace';
    const objectRef = React.createRef();
    let callbackNode = null, clicks = 0, keys = 0, focusEvents = 0;
    function App() {
      return <div style={{ position: 'fixed', right: 40, bottom: 40, display: 'flex', gap: 8 }}>
        <AgentBallFace ref={objectRef} status="running" pendingCount={0} label="Nomi" className="host-class" data-testid="ball-object" aria-expanded={false} onClick={() => { clicks++ }} onKeyDown={() => { keys++ }} onFocus={() => { focusEvents++ }} />
        <AgentBallFace ref={(node) => { callbackNode = node }} status="idle" pendingCount={0} label="Nomi" data-testid="ball-callback" />
      </div>
    }
    window.probe = () => {
      const objectBall = document.querySelector('[data-testid="ball-object"]');
      const callbackBall = document.querySelector('[data-testid="ball-callback"]');
      return {
        objectIsButton: objectRef.current !== null && objectRef.current === objectBall && objectBall.tagName === 'BUTTON',
        callbackIsButton: callbackNode !== null && callbackNode === callbackBall && callbackBall.tagName === 'BUTTON',
        hostClass: objectBall?.classList.contains('host-class') ?? false,
        ariaExpanded: objectBall?.getAttribute('aria-expanded') ?? null,
        clicks, keys, focusEvents,
        active: document.activeElement?.id || document.activeElement?.tagName || null,
      };
    };
    createRoot(document.getElementById('root')).render(<App />);
  `)
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage({ viewport: { width: 800, height: 600 }, reducedMotion: 'no-preference' })
    const pageErrors: string[] = []
    page.on('pageerror', (error) => pageErrors.push(error.message))
    await page.setContent('<style>[data-agent-ball]{display:block;width:44px;height:44px;padding:0;border:0}</style><input id="draft" /><main id="root"></main>')
    // 先让输入框拿着焦点（创作者正在写字），再挂小球。
    await page.focus('#draft')
    await page.addScriptTag({ content: script })
    await page.waitForSelector('[data-testid="ball-callback"]', { timeout: 5000 }).catch((error: Error) => {
      throw new Error(`${error.message}\n页面错误：${pageErrors.join(' / ')}`)
    })
    type Probe = { objectIsButton: boolean; callbackIsButton: boolean; hostClass: boolean; ariaExpanded: string | null; clicks: number; keys: number; focusEvents: number; active: string | null }
    const probe = (): Promise<Probe> => page.evaluate('window.probe()') as Promise<Probe>
    const mounted = await probe()
    expect(mounted.objectIsButton, '对象 ref 没拿到原生按钮').toBe(true)
    expect(mounted.callbackIsButton, '回调 ref 没拿到原生按钮').toBe(true)
    expect(mounted.hostClass, '宿主的 className 没落到按钮上').toBe(true)
    expect(mounted.ariaExpanded, '宿主的 aria-* 没透传').toBe('false')
    expect(mounted.active, '挂上小球把焦点从输入框抢走了').toBe('draft')
    expect(mounted.focusEvents).toBe(0)

    // 鼠标在小球旁边转一圈（眼睛跟着看）：焦点还在输入框。
    const box = await page.locator('[data-testid="ball-object"]').boundingBox()
    if (!box) throw new Error('小球没有布局框')
    const cx = box.x + box.width / 2, cy = box.y + box.height / 2
    for (let step = 0; step < 24; step += 1) {
      const angle = (step / 24) * Math.PI * 2
      await page.mouse.move(cx + Math.cos(angle) * 80, cy + Math.sin(angle) * 60)
    }
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    const followed = await probe()
    expect(followed.active, '眼睛跟随把焦点抢走了').toBe('draft')
    expect(followed.focusEvents).toBe(0)

    // 宿主的事件照旧接得到：点一下、在按钮上按键。
    await page.click('[data-testid="ball-object"]')
    await page.keyboard.press('Shift')
    const used = await probe()
    expect(used.clicks, '宿主的 onClick 没接到').toBe(1)
    expect(used.keys, '宿主的 onKeyDown 没接到').toBe(1)
    expect(pageErrors).toEqual([])
  } finally { await browser.close() }
}, 60_000)
