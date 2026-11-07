# 设计卡：打开项目的渲染段——媒体占位扫光只给正在加载的

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

```
改动名：打开项目渲染段（第一张图提前）      线/负责人：L-perf      类别：[其他：性能][改交互：加载态外观]
```

来源：用户 10-05 反馈 #1「进项目卡」；逃逸 FB-20261005-01 一族（前两刀：#1041 打开零写盘、#1044 Agent 运行时按需加载）。

### 功能分类
- [x] 新界面 / 改交互（只改加载占位的外观：排队中不再扫光）
- [x] 大数据量 / 画布 / 长列表
- [ ] 花钱 / 长跑 / 可打断 / Agent 行为 / 生成效果 / 数据格式

## 定位（开发版只做定位，非正式数字）

I300（300 图）冷开，渲染层两段：

| 段 | 时长 | 谁在耗 |
|---|---|---|
| 画布可见 → 节点挂上 | 约 700–850ms | React 首次挂载可见的 180 个节点约 420ms（其中 react-i18next 每个组件实例首挂都 `createI18nWrapper` + 文案解析约 100ms；Agent 输入框的 `useLayoutEffect` 量高度触发整页强制布局约 80ms）；样式 / 布局约 160ms；CSS 动画更新约 100ms |
| 节点挂上 → 第一张图 | 约 750–900ms | **不是 JS**：主线程 `LayerTree::WaitForCommitCompletion` 等 GPU 栅格约 350ms——可见 180 张卡每张都挂一条无限扫光（渐变伪元素 + transform/opacity 动画），第一帧栅格它们；而媒体调度（`scheduleAfterCanvasShellPaint`）按设计等「画布壳画完两帧」才放第一张图 |

现成能力核对（React Flow 官方性能指南 https://reactflow.dev/learn/advanced-use/performance）：`onlyRenderVisibleElements` 已开（300 个节点只挂 180 个）；视口外节点已不挂；图片已按需（IntersectionObserver + 4 个槽位的队列 + 画壳后再放）。都已接入，不是这两段的瓶颈。

A/B（开发版，同机各 2 次，「节点挂上 → 第一张图」）：原样 911 / 889ms；去掉扫光伪元素 449 / 515ms；整个占位改纯色 412 / 438ms。→ 大头就是扫光。

## 改法

扫光只给**拿到加载槽位**的占位（`data-media-state='loading'`，图最多 4、视频最多 1）；排队中的只画静态底（渐变底 + 中心圆点）。全局 CSS 只改一个选择器（行数不增）。

## 界面 / 交互变化（单列）

- **排队中的媒体卡不再扫光**，只显示静态底和中心圆点；正在加载的那几张照旧扫光。打开大项目时画布上同时扫光的从上百条变成最多 5 条。
- 不改占位的尺寸、颜色、失败 / 超时态、重试按钮。

| 格 | 结论 | 证据 |
|---|---|---|
| ★1 用户怎么用 | 当我点开一个几百张图的项目，我想图尽快出来。不做：不改媒体调度的槽位数与「画壳后再放」的节奏，不改节点挂载。真实任务：I300 冷开、回库重开。主指标：节点挂上 → 第一张图；护栏：渲染层长任务总时长。 | `node tests/ux/project-open-stages.e2e.mjs <label> --runs 5 --warmup 1 --exe release/win-unpacked/Nomi.exe` |
| ★2 谁说了算 | 占位外观 owner = `DeferredNodeMedia.tsx` 的 `DeferredNodeMediaPlaceholder`（唯一渲染点，门表 1 扇）；状态来自 `deferredNodeMediaQueue` 的 `DeferredNodeMediaState`，不新增状态。 | `node scripts/door-map.mjs DeferredNodeMediaPlaceholder` |
| ★3 一致与复用 | 复用已有的媒体状态（idle / queued / loading / ready / error / timeout），只把它作为 data 属性给样式。没有第二份定义。 | — |
| ★4 全状态 | queued：静态底；loading：静态底 + 扫光；ready：图；error / timeout：原失败卡 + 重试；idle：无占位。文案不变。 | `mediaPlaceholderShimmer.test.ts` |
| ★9 验收与回滚 | 验收：同一台 Windows 打包版跑上面的跑器，对照 PR 前后表；看一眼打开大项目时排队卡是静态底。回滚：revert 实现提交。 | PR `## 测试` |

格 5–8 不适用（不碰花钱、长跑、可打断；外观变化见上，需协调会话 / 用户确认）。

## 没做的（另一刀）

「画布可见 → 节点挂上」那一段：react-i18next 17.0.15（最新）每个组件实例首挂都复制一次 i18n 实例的属性描述符（`createI18nWrapper`），可见 180 个节点里每张卡有好几个组件用 `useTranslation`；Agent 输入框挂载时量高度强制整页布局。这两项要么改上游、要么改一批节点组件取文案的方式，量不小，留给下一刀。
