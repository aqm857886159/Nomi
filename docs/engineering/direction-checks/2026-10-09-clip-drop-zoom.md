# 剪辑节点第二片：拖放接收 / 窄片段命中 / 同类手势迁移（方向检查，RW）

> 触发：`fix-churn` 对 `ClipNodeTimeline.tsx`（近 14 天 5 个 fix）、`ClipNode.tsx`（6 个）、`timelineGesture.ts` 等报「第 N 个 fix」。
> 如实交代：这些 fix 绝大多数是第一片（#1145）自己的提交，同一类根因的同一条线，不是别的线在补同一处。第一片的类根因复盘见
> `docs/engineering/direction-checks/2026-10-09-clip-gesture-ownership.md`；本片沿用它，不重开一份新结论，只写本片多出来的判断。

## 0. 一句话根因

第一片只收了「一次手势的生命周期」；这一类的另外三格——**拖放接收口**（轴不认素材载荷、被上层元素和画布舞台抢走）、**命中下限**（窄片段按设计像素算、缩小后点不中）、**自动滚动**（滚动不产生指针事件，拖到边缘停住）——同样没有共享边界，各调用者各写各的或根本没写。

## 1. 归类表

| 卡点 / 同类入口 | 直接原因 | 类 |
|---|---|---|
| 4 素材拖进剪辑节点没反应 | `ClipNodeTimeline` 没有 dragover / drop；事件冒泡到画布舞台被当成「新建素材节点」 | 接收口只有全局 `TimelineTrack` 一处，剪辑节点没有 |
| 5 拖放把手要悬停才可点 | `pointer-events-none` 到 group-hover 才开 | 可点性依赖视觉状态 |
| 6 窄片段点不中 / 拖不过屏 | 命中宽度 = 视觉宽度；拖动只看指针位移 | 命中与换算不按屏幕像素 |
| 全局时间轴手柄要先选中 | `isSelected ? 手柄 : null` | 同一个控件两处规矩不一致 |
| 预览取景 / 叠加层拖动被打断 | 元素级 pointercancel 当松手提交，没有 blur / 丢 capture 处理 | 手势生命周期各写一份（第一片没迁到这两处） |
| V-1149 素材节点选着时落不下 | 参数浮板盖在剪辑节点上，拖放期间照常吃命中 | 拖放进行中画布浮层仍吃命中、挡住接收目标（浮层 × 接收目标，不只是参数浮板） |

## 2. 为什么这一类会一直出现

每个新入口（全局轨道、剪辑节点轴、预览浮层）各自实现接收 / 命中 / 打断。第一片把生命周期收成一个入口并用结构测试守住；本片把接收口（`clipNodeDrop.ts`，MIME 与全局轨道同一对）、命中几何（`clipNodeGestureModel.ts`）、边缘滚动（`clipNodeEdgeScroll.ts`）也各收一处，并把预览区两处拖动迁进同一会话、扩大结构测试的扫描范围。三条铁律：⑫「点了 = 以为的」（走查 `clip-drop-zoom.walk.mjs` 按卡点 × 缩放 50 / 100 / 150% 断言；类检查 `timelineGesture.structure.test.ts`）。⑩ ⑪ 不适用。

## 3. 不改结构的话，接下来会冒出什么

| 预测 | 怎么验证 |
|---|---|
| 下一个手势入口（转场手柄、文字轨拖动）再各自处理打断 / 边缘 | `pnpm exec vitest run src/workbench/timeline/timelineGesture.structure.test.ts`（扫描 timeline、ClipNode*、preview 两处） |
| 缩放档变化后窄片段再次点不中 | `node tests/ux/clip-drop-zoom.walk.mjs`（P6A，50 / 100 / 150%） |

## 4. 靶子独立性检查

走查读 DOM 状态与持久化帧；拖放的「落下」一半用同 MIME 的事件派发（Electron 里 Playwright 的鼠标驱动不了原生拖放，已在走查里写明），「拖出」一半是真鼠标。基线在 main 上先跑红再修绿。

## 5. P0：这些是我们独有的吗？现成方案

自写登记仍是 `timeline-pointer-session`（第一片已评估 use-gesture，本片不改结论）。拖放接收评估 dnd-kit（https://github.com/clauderic/dnd-kit ）：来源是原生 `draggable`、接收只有全局轨道与剪辑轴两处，接 dnd-kit 要两端都换成它的传感器，且它不懂帧、插入位置与撤销栈；不接。落点语义（吸最近边、只在重叠时后推）是时间轴领域规则，自写在 `clipNodeSequence.insertClipNodeSourceAt`。

## 6. 接入 / 补 / 重写 / 删 对比表 + 推荐

| 选项 | 做什么 | 代价 | 风险 | 推荐 |
|---|---|---|---|---|
| 接入 dnd-kit | 两端换传感器 | 重写全局轨道与素材库 / 节点的拖出 | 与 React Flow 冲突、仍要自写落点语义 | 否 |
| 补 | 剪辑轴再补一份 dragover / drop | 与全局轨道再多一份 | 第三个入口继续各写一份 | 否 |
| 换（本片） | 接收口 + 几何 + 边缘滚动各收一处，旧的不留并行版 | 迁移预览区两处拖动 | 走查 + 单测覆盖 | 是 |

## 7. 用户要权衡的核心

窄片段的命中垫只在有空档处生效（相邻片段紧挨时垫在邻居下面）：要不要进一步把窄片段在视觉上也放大到可点宽度（改变外观）。

## 特征测试清单

`tests/ux/clip-gesture-ownership.walk.mjs`（第一片，全绿）、`src/workbench/timeline/timelineGesture.test.ts`、`clipNodeGestureModel.test.ts`、`clipNodeSequence.test.ts`。
