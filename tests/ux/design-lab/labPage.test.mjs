// 「一个状态一个浏览上下文」这条不变量的回归测试（2026-09-06）。
//
// 立项根因：走查原来为整趟只建一个 context / 一个 page，然后在这一个 page 上逐态 goto。
// design-lab.html 在 vite dev 下是**未打包**的应用入口，每次加载都要拉一整张模块图；
// 同一个上下文累积到第 34 次加载就再也启动不起来。实测（同一个 URL 连导 60 次）：
//   复用单 page  → 34/60，第 34 次 waitForFunction 恒超时；
//   每次新 context → 60/60，共 28.5s。
// 那一刻服务器对 node fetch 照答 200、浏览器进程健在、同一浏览器里新建 context 立刻成功——
// 所以坏掉的既不是服务器也不是浏览器，是那个被复用了太多次的上下文。
//
// 这里不起真浏览器：要钉住的不是「Chromium 能撑几次」，而是**我们这一侧的生命周期契约**——
// 每次取页面都新建上下文、用完必关、回调抛错也得关。拿假 browser 断言这三件事，
// 比起真跑 34 次快而且不看机器脸色。
import { describe, expect, it } from 'vitest'
import { withFreshLabPage } from './labPage.mjs'

function fakeBrowser() {
  const contexts = []
  return {
    contexts,
    async newContext(options) {
      const context = {
        options,
        closed: false,
        pages: [],
        async newPage() {
          const page = { id: `${contexts.length - 1}:${context.pages.length}` }
          context.pages.push(page)
          return page
        },
        async close() { context.closed = true },
      }
      contexts.push(context)
      return context
    },
  }
}

describe('走查取页面的生命周期', () => {
  it('每次调用都新建一个上下文，不跨调用复用', async () => {
    const browser = fakeBrowser()
    const first = await withFreshLabPage(browser, { viewport: { width: 10, height: 10 } }, async (page) => page)
    const second = await withFreshLabPage(browser, { viewport: { width: 10, height: 10 } }, async (page) => page)
    expect(browser.contexts).toHaveLength(2)
    expect(first).not.toBe(second)
    expect(browser.contexts.map((c) => c.pages.length)).toEqual([1, 1])
  })

  it('回调正常结束就关掉上下文，并把回调的返回值透传出来', async () => {
    const browser = fakeBrowser()
    const value = await withFreshLabPage(browser, {}, async () => '截好了')
    expect(value).toBe('截好了')
    expect(browser.contexts[0].closed).toBe(true)
  })

  it('回调抛错也必须关掉上下文，错照样往外抛', async () => {
    const browser = fakeBrowser()
    await expect(withFreshLabPage(browser, {}, async () => { throw new Error('这一态挂了') }))
      .rejects.toThrow('这一态挂了')
    expect(browser.contexts[0].closed).toBe(true)
  })

  it('取景参数原样交给 newContext（视口/缩放/配色不能在这一层被改写）', async () => {
    const browser = fakeBrowser()
    const options = { viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1, colorScheme: 'light' }
    await withFreshLabPage(browser, options, async () => {})
    expect(browser.contexts[0].options).toEqual(options)
  })
})

describe('走查主体不许留跨状态的页面', () => {
  it('walkScreen 只经由 withFreshLabPage 取页面', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const url = await import('node:url')
    const here = path.dirname(url.fileURLToPath(import.meta.url))
    const source = fs.readFileSync(path.join(here, 'walkScreen.mjs'), 'utf8')
      .replace(/^\s*\/\/.*$/gm, '')
    // 直接 newPage/newContext 就意味着又出现了一条不受生命周期约束的取页面路径。
    expect(source).not.toMatch(/\.newPage\(/)
    expect(source).not.toMatch(/\.newContext\(/)
    expect(source).toMatch(/withFreshLabPage/)
  })
})
