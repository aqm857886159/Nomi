# 画布拖拽与 Escape 的方向检查

全图在概念登记 `docs/engineering/concept-owners/canvas.gesture-lifetime.json` 和所有权审计 `docs/audit/2026-09-25-generation-canvas-ownership-review.md`。此手势不在 `docs/engineering/seams.json` 的交接处表内。

### 0. 一句话根因

6C 把撤销何时记账和拖拽何时结束绑在一起，使共享指针租约反向依赖快捷键路由，并把既有的松手提交改成由 Escape 提前终止。

### 1. 归类

| 提交或问题 | 直接原因 | 类 |
|---|---|---|
| `a0cbd550d`，CI 45281591359 Contracts | 租约从快捷键路由引入全局输入适配，路由已引用租约的取消接口 | 领域生命周期反向依赖输入路由 |
| `a0cbd550d`，CI 45281591359 Unit (1) | 共享租约截获 Escape，组框清掉 moved，节点取消租约 | 跨入口改变已开始手势的结束语义 |
| `e57081ef0` | 活动面负责快捷键路由和资产删除防护，同时调用租约的取消接口 | 同一交接边界的既有单向调用 |

`fix-churn.mjs` 报目录第 8 次、画布分组概念第 3 次。两个手势文件均未命中文件级阈值。为合并后的体积上限调整的节点外壳亦未命中阈值。

### 2. 为什么会再出现

同一租约被节点、组和时间轴等多种手势持有，失焦和丢失松手由租约发现后交各宿主收尾。只要把某一宿主的键盘行为塞进租约，语义就可能扩散到其他宿主。对应铁律 ⑫ 的交互结果已有独立判据。按 Escape 后松手，位移应落在 (40, 45)，版本只增一次，再 Undo 回起点。修复前实际停在 (10, 20)，节点的新特征用例也观测到活动标志被清空。

### 3. 可验证预测

| 预测 | 量具 |
|---|---|
| 再引入租约到快捷键路由的静态边会复现硬环 | `node scripts/check-boundaries.mjs` |
| 再让 Escape 终止正在进行的节点或组拖拽，会失去一次有效提交 | 节点特征测试与 `tests/ux/selection-drag-lifecycle.test.mjs`，检查松手前无写入、松手后只一步、Undo 恢复 |
| 正常松手与受宿主控制的中断仍各按既有路径收尾 | 同一浏览器套件中的正常拖拽和中断场景 |

2026-12-24 复查两条回归用例和静态边界门岗，任一再红即重开。

### 4. 靶子独立性

浏览器组用例先于 6C，和 6C 的撤销特征测试不同源。旧 6C 特征测试断言取消，目标与独立用例冲突。修正的节点断言在原实现上因活动标志被清空而变红；只屏蔽全部拖拽写入也会在松手后的坐标与提交次数判据上失败。

### 5. 这一整块归谁

这一整块：画布拖动租约的存续和结束，以及宿主在租约结束时的提交。
归谁：`src/workbench/generationCanvas/components/canvasDraggingFlag.ts:129` 的 `beginCanvasDragging` 持有租约，组框的提交由 `useCanvasSelectionDrag.ts:155` 的 `settleDrag` 执行。
我们哪里绕开了它：`a0cbd550d` 的 `src/workbench/generationCanvas/components/canvasDraggingFlag.ts:180` 加了共享 Escape 处理，组框回调又清掉待提交位移。快捷键路由到租约的现有调用由此形成双向依赖。

### 6. 三条路

| 选项 | 做法与代价 | 复发面 |
|---|---|---|
| 沿原方向修 | 保留 Escape 取消，拆开静态依赖 | 环能消失，既有拖拽契约仍失败 |
| 换一种做法 | 在快捷键路由按活动面分发 Escape，另由节点和组消费 | 需要新定义多个宿主的取消语义。宿主分歧仍可进入边界 |
| 删掉 · 推荐 | 删除 6C 加入的租约监听和组回调，沿用松手提交。历史和项目数据无需迁移 | 删除引入两处红灯的连接。两条拖拽测试和静态边界门岗覆盖重新引入 |

### 7. 用户要权衡的核心

保住已经开始的拖拽和一次 Undo 的可预测性，还是给它增加一种会丢弃当前位移的键盘终止方式。本次任务已指定前者。

### 特征测试

- `tests/ux/selection-drag-lifecycle.test.mjs` 锁定原有组拖拽流程。
- `src/workbench/generationCanvas/store/canvasPatchHistory.characterization.test.ts` 在实现修正前复现节点取消，要求松手提交一次，再 Undo 回起点。
