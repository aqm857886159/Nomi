# 画面小窗与小地图默认收起（2026-09-26）

> 来源：PR #880 走查发现 1280×800、Agent 面板开着时，节点浮框的 ↑ 被右下「画面小窗」整颗盖住、模型钮被左下小地图压住（证据 `D:\tmp\pip-evidence\1280x800-agent-open-pip-covers-send-81162cce2.png`）。协调会话给出三个方案，用户选 B：「不是默认是收起的吗？不是的话肯定是 B」。

## 范围

- 画面小窗（`timeline/TimelineMiniPreview.tsx`）：没表过态（没有存储值）时收起成小签；用户明确展开过（`'0'`）才展开。沿用已上线的键 `nomi.timelineMiniPreview.collapsed`，已表态的用户不重置。
- 小地图（`generationCanvas/reactFlow/GenerationCanvasReactFlow.tsx`）：默认隐藏；开合记住（新键 `nomi.canvasMinimap.collapsed`）。「至少 N 个节点才出现」的门槛不动。
- 三样同类偏好（时间轴面板、画面小窗、小地图）并到一个 owner：`generation/dockCollapsePrefs.ts`（一张表：键 + 默认值）。删 `timeline/timelinePanelPrefs.ts`、删组件里就地的 localStorage 读写。

## 不动什么

浮框位置 / 宽度（#880 已定）；小地图的出现门槛与交互；时间轴面板的默认值（本来就是收起）；「浮框画到停靠层之上」「浮框压住时自动收起」两个备选方案（用户未选）。

## 先查别人

| 查了什么 | 结论 |
|---|---|
| 仓库里已有的同类偏好：`src/workbench/timeline/timelinePanelPrefs.ts:1`（时间轴面板收起，键 + 默认常量 + try/catch 读写） | 形状正好，扩成三项的表，不另起第二种存储 |
| 画面小窗现状：`src/workbench/timeline/TimelineMiniPreview.tsx:24`（组件内就地读写，只有 `'1'` 才收起 → 默认展开） | 改为读 owner，默认收起；键沿用 |
| 小地图现状：`src/workbench/generationCanvas/reactFlow/GenerationCanvasReactFlow.tsx:108`（`useState(true)`，不记） | 改为读 owner，默认隐藏、开合记住 |
| 用户级界面偏好的既有写法：`src/workbench/preview/editingPanelLayoutSlice.ts:67`（`nomi.agentDockHidden`）、`src/workbench/creation/creationResourceTreeCollapse.ts:18`（三态：null 用默认） | 同样是 localStorage + 「没设过用默认」，本次三态语义与之一致 |

## 验收

- 单测：`dockCollapsePrefs.test.ts`（三项默认收起、明确展开保持、往返、存储抛错退默认、老键延续、类级：全 src 无别处直接读写这三个键）。
- 真机：最终构建、Agent 面板开着、时间轴有片段的项目；1280×800 与 1280×720（Windows 1920×1080 @150%）、zh 与 en：浮框 ↑ 与模型钮 elementFromPoint 命中自己；展开画面小窗 / 小地图后重开项目仍展开。
- 核心冒烟 used / empty。

## 回滚

单独一个 PR；回滚即恢复三处各自的读写与默认值。
