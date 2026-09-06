// 设计实验室走查的**取页面通道**——「一个状态一个浏览上下文」这条不变量的唯一 owner（2026-09-06）。
//
// 立项根因：走查原来为整趟只建一个 BrowserContext 和一个 Page，然后在这一个 page 上逐态
// `goto`。`design-lab.html` 在 vite dev 下是**未打包**的应用入口，每加载一次就要拉一整张
// 模块图；同一个上下文累积到第 34 次加载之后就再也启动不起来，`waitForFunction`
// 等不到 `__designLabReady`，于是整趟走查停在那里——而报出来的是「第 35 个状态渲染不出来」，
// 冤枉的是碰巧排在那个位置的那一态（换 ONLY 单独跑它，好得很）。
//
// 那一刻测到的现场，四条一起看才指得准：
//   · 文档响应 200，node 直接 fetch 同一个 URL 也是 200、长度正常  → 服务器没事；
//   · vite 进程还活着（前一版把 `npx vite` 的 wrapper 句柄当成 vite 本体，才误以为它死了）；
//   · 浏览器进程还在，**同一个 browser 里新建 context 立刻就能加载成功**  → 浏览器没事；
//   · 堆内存前 34 次恒定 56.8MB                                        → 不是页面里的泄漏。
// 坏掉的就是那个被复用了太多次的上下文本身。
//
// 判据还有一条独立旁证：本仓另一条渲染**同一批页面**的实现——视觉基线
// `design-lab.visual.spec.mjs`——跑完 112+ 个状态从不失败，因为 Playwright Test 的 `page`
// fixture 本来就是每条用例一个全新 context。同服务器、同页面、同状态，唯一差别是上下文生命周期。
//
// 所以修法不是「把超时调大」，也不是「每 N 态重建一次」（那只是把撞墙推远，仍然是无上界复用）：
// 把「用完即弃」做成**取页面的唯一方式**，累积在源头就不成立。
// 实测对照（同一个 URL 连导 60 次）：复用单 page 34/60 挂；每次新 context 60/60，共 28.5s。

/**
 * 在一个专属的、用完即关的浏览上下文里跑一段用页面的活。
 *
 * `run` 拿到的 page 只在回调期间有效——**不要把它带出去**：回调一返回上下文就关了，
 * 带出去的 page 下一次操作会当场抛（这正是想要的，比静默复用一个废页面强）。
 *
 * @template T
 * @param {import('playwright').Browser} browser
 * @param {import('playwright').BrowserContextOptions} options 取景参数，原样交给 newContext
 * @param {(page: import('playwright').Page) => Promise<T>} run
 * @returns {Promise<T>}
 */
export async function withFreshLabPage(browser, options, run) {
  const context = await browser.newContext(options)
  try {
    return await run(await context.newPage())
  } finally {
    // 回调抛错也得关：漏一个上下文，下一趟就少一分余量，而且失败现场会被上一态的浏览器状态污染。
    await context.close()
  }
}
