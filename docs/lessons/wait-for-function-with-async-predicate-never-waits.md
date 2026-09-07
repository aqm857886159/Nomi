# `waitForFunction` 配 async 判据 = 一个从不等待的等待

> 📎 教训 · 首次记录 2026-09-07 · 状态：现行
> **触发场景**：走查里「等到某个异步状态成立」的地方；读到 `waitForFunction(async (…) => …)`；或者某一步拿到 `null` 就炸，而它本该等到有值为止。

**结论**：Playwright 的 `page.waitForFunction()` **不 await** 判据返回的 Promise——它把那个 Promise 对象本身当成 truthy，于是第一次轮询就"成功"返回，`handle.jsonValue()` 拿到 `null`。判据里只要有 `await`，这个等待就是空的。要等异步状态用 `expect.poll(async () => …, { timeout })`（它真的 await 取样器），不要自己写 `Date.now()` 截止轮询（`check:test-waits` 拦）。

**为什么会踩**：写法看着完全合理——判据要读磁盘上的项目（`window.nomiDesktop.projects.readAsync`），自然写成 async。红灯出现的位置也在下游，长得像业务 bug：

```
TypeError: Cannot read properties of null (reading 'nodes')
  at tests/ux/video-depth-real-task.walk.mjs:261
```

于是第一反应是「派生节点没建出来」，去查产品代码。真相是那一行 `await win.waitForFunction(...)` 在 0ms 就返回了 `null`，60 秒超时一秒都没用上。

阳性对照（决定性证据，playwright 1.60，仓库根目录跑）：

```js
// A：async 判据永远返回 null → 本该超时
const h = await p.waitForFunction(async () => { await new Promise(r => setTimeout(r, 20)); return null }, undefined, { timeout: 2500 })
console.log(await h.jsonValue())   // 实测：A resolved with null（**没有超时**）
```

同样的写法在 `tests/ux/` 里还有 6 处（`mcp-client-activation` / `narrowed-mode-guidance` / `production-budget-recovery` / `agent-vertical-spine-m0-m5.red` / `storyboard-agent-canonical-patch`）。它们不一定都露馅：判据后面紧跟的那句只要不解引用返回值，这个空等待就完全静默——**它只在下一步碰巧需要那个值时才现形**，其余时候表现为「这条走查跑得真快」。

**怎么用**：
- 判据里出现 `await` = 立刻换 `expect.poll`：`await expect.poll(async () => (await read())?.x ?? null, { timeout }).not.toBeNull()`。
- `waitForFunction` 只留给**同步**判据（DOM 里某个东西出现/消失）。
- 判「它真的等了吗」用阳性对照：让判据永远不成立，看它是不是**超时**。秒回 = 空等待。
- 走查跑得比预期快，先怀疑等待是空的，别当成「今天机器快」。

**出处**：PR #602（「提取深度」收尾）真机走查；阳性对照命令见上；修法参照 `tests/ux/agent-runtime-production.walk.mjs:54` 已有的 `expect.poll` 用法。
