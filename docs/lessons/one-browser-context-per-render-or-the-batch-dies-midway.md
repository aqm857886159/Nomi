# 跑批渲染必须一格一个浏览上下文，复用同一个到第 34 次就再也起不来

> 📎 教训 · 首次记录 2026-09-06 · 状态：✅ 已固化（由 `tests/ux/design-lab/labPage.mjs` 的 `withFreshLabPage` 接管，`labPage.test.mjs` 守着）
> **触发场景**：一个跑批的走查/截图程序，前面几十格都好好的，从某一格开始 `waitForFunction` 恒超时；单独用 `ONLY=` 跑那一格却完全正常。

**结论**：在一个 Playwright 上下文里**反复整页加载 vite dev 的应用入口**，累积到第 34 次左右那个上下文就废了。修法是每渲染一格开一个新 context、用完即关，不是把超时调大、也不是每 N 格重建一次。

## 症状长什么样（以及为什么会看错人）

`pnpm run design-lab:walk:v4` 停在第 35 个状态，报的是

```
page.waitForFunction: Timeout 30000ms exceeded.
```

读起来像「第 35 个状态渲染不出来」。**它是无辜的**：`ONLY=v4-dock-rail` 单独跑，好得很；把最后 30 个状态一起跑，也全过。真正决定成败的是「这个上下文之前已经加载过多少次」，与是哪一格无关——把**同一个 URL** 连导 60 次，同样停在第 34 次。

两屏受影响：`agent-panel`（45 态）与 `agent-panel-v4`（57 态）。状态少的几屏（editing 12、host-config 2）从来没露过马脚，因为够不到那条线。

## 排查时被排除掉的四个方向（别重走）

| 怀疑 | 实测 | 结论 |
|---|---|---|
| 页面内存泄漏 | 逐态读 `performance.memory`，前 34 次恒定 56.8MB | 不是 |
| vite 死了 | 给 spawn 出来的进程挂 `exit` 监听；失败时它还活着，node 直接 `fetch` 同一个 URL 拿到 200、长度正常 | 不是 |
| 机器负载 | load average 3 和 11 两种情况下都停在第 34 次 | 不是 |
| vite 的 HMR WebSocket | 控制台确实有一条 `WebSocket ... failed`，但 `NOMI_DISABLE_VITE_HMR=1` 关掉 HMR 之后**仍然**停在第 34 次 | 是伴生现象，不是原因 |

**一个把人带偏的坑**：走查当时是 `spawn('npx', ['vite', ...])`。拿到的句柄是 `npx` 那层壳，不是 vite 本体——vite 真死了这个 `exit` 也不一定响。要判断服务器死没死，别只信这个句柄，直接 `fetch` 一下。

## 定位到根因的那两条判据

1. **失败那一刻，在同一个 browser 里新建一个 context 加载同一个 URL，立刻成功。** 服务器没事、浏览器进程没事，坏的就是那个被复用太多次的上下文。
2. **本仓另一条渲染同一批页面的实现从不失败**：视觉基线 `design-lab.visual.spec.mjs` 跑完 112+ 个状态，用的是同一个 vite、同一批页面、同一台机器。差别只有一处——Playwright Test 的 `page` fixture 本来就是**每条用例一个全新 context**。

同服务器、同页面、同状态，唯一变量是上下文生命周期。到这儿判据就闭合了。

`design-lab.html` 在 dev 下是**未打包**的入口，每加载一次要拉一整张模块图；所以「加载次数」这个计数器涨得特别快。至于 Chromium 内部到底是哪一项资源在单个上下文里被耗尽，没有拆到那一层——不影响结论，因为要消除的是「无上界复用」这件事本身。

## 照做

跑批渲染取页面只走一条通道：

```js
export async function withFreshLabPage(browser, options, run) {
  const context = await browser.newContext(options)
  try {
    return await run(await context.newPage())
  } finally {
    await context.close()
  }
}
```

代价实测很小：同一个 URL 60 次，每次新建上下文共 28.5s（约 0.5s/格），换来的是 34/60 → 60/60。

**顺带**：`page.waitForFunction(fn, { timeout })` 是错的——第二个实参是传给页面函数的 `arg`，options 是第三个。写错的地方超时声明从来没生效过，实际用的是默认 30s。声明与实际不符的等待就是不可信的等待。
