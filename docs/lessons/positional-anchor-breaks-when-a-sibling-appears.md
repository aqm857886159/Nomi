# 按「位置」认对象的锚点，多一个兄弟就变成掷硬币

> 📎 教训 · 首次记录 2026-09-06 · 状态：现行
> **触发场景**：某条走查/旅程间歇性红，报错落在一条「等某个元素出现」的超时上，而它前面的断言全过；或者你正准备给一份走查的隔离环境里再加一个同类对象（第二个项目、第二个节点、第二个素材）。

**结论**：走查里凡是 `.first()` / `.nth()` / `.last()` 指认对象，用的都是**位置**这个派生坐标。只要哪天多出一个兄弟，它不报错、不变红，只是安静地指向另一个东西；失败随后出现在**下游**，顶着一个完全无关的名字。**加大超时永远修不好它。**

## 实例（2026-09-05 CI 两次红）

`production-mcp` 旅程重启后用 `locator('[data-project-card="true"]').first().click()` 打开项目。

自 `c73db10ef`（2026-09-04）起，这条旅程在同一个隔离库里有**两个**项目：GUI 建的制作项目，和 MCP `nomi_project_create` 建的语义夹具。库卡顺序由 `sortByLibraryUsage` 按最近使用/`updatedAt` 倒序派生，两者时间戳落在**同一秒**内——`.first()` 于是在两者之间掷硬币。

点错那次：任务中心正常打开，但里面是空的（「没有在跑的任务」），制作卡永不出现。报错却是

```
locator.waitFor: Timeout 10000ms exceeded.
  waiting for locator('[data-production-task-card]') to be visible
```

——一条指向「等太短 / 卡不渲染 / 机器慢」的假线索。两个 PR 上各红一次，main 恒绿（同一枚硬币，正面多）。

## 怎么定位（阳性对照 > 反复重跑）

别等它再掷一次。**把硬币按到反面**：在重启前给另一个对象补一次写入，让它成为「最近」。

- 强制翻转后：`.first()` 点进语义项目，10s 超时，报错与调用栈**与 CI 逐字一致** → 机制坐实。
- 不翻转：58/58 全绿，探针打出的卡序两张都显示「刚刚」→ 证实同秒、顺序本就是掷硬币。
- 修复后再翻转：58/58 全绿 → 证明修的是这个，不是碰巧。

## 怎么修

1. **按身份选**，不按位置：`[data-project-card="true"][data-project-id="${id}"]`。产品侧要给对象在 DOM 上留身份锚点（`data-*` id），否则走查只能退回位置或可变文案。
2. **加一道现场屏障**：点完立刻证明进的就是那个对象（等 hash 里出现**那个具体的** id，而不是只等 `projectId=` 前缀）。这样「点错」当场按它真实的名字失败，不再伪装成下游超时。
3. **别顺手收紧超时**：这次把 click 收成 10s 就撞上开屏动画（`SplashIntro` 5 段 × 2600ms ≈ 13.5s），换来另一种抖动。修身份问题不要连带改等待预算。

## 门岗

`scripts/check-walkthroughs.mjs` 的 `positional-project-open` 规则（判定逻辑在 `scripts/lib/positionalProjectOpen.mjs`，阳性对照单测在 `scripts/check-walkthroughs.node-test.mjs`）：一份走查只要自己调了 `nomi_project_create`（= 库里不止一个项目），就不许再按位置点 `[data-project-card]`。基线 0。单项目走查的 `.first()` 是正当写法，不误伤。

**出处**：`tests/ux/production-mcp-journey.e2e.mjs`；CI run 33991470467 / 33993567585；根因合同 `docs/fixes/2026-09-06-production-mcp-taskcard-timeout.root-cause.json`。

**相关**：[dead-selector-lies-both-ways](dead-selector-lies-both-ways.md)、[assert-you-are-in-the-situation-you-claim](assert-you-are-in-the-situation-you-claim.md)、[repeated-timeout-means-check-the-assertion](repeated-timeout-means-check-the-assertion.md)、[race-repro-needs-positive-control](race-repro-needs-positive-control.md)
