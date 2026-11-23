# 方向检查：画布拖线松手捕获阶段穿透前景卡片误连底层编组（2026-11-23）

> 独立复盘：由未参与 `#1625` 前序落点修复轮次的独立线（`Codex 6.2 Astra`）基于公开 CI 失败样本、源码、截图与本地命中栈独立核查完成。

**这一处的全图在哪**：表外（手势收尾边界由 `tests/ux/canvas-drag-pan-gestures.walk.mjs`、`tests/ux/group-ports.walk.mjs`、`tests/ux/group-reference-direction.walk.mjs` 共同覆盖）。

### 0. 一句话根因

画布拖线收尾同时挂了两套落点裁决：`useGenerationCanvasReactFlowMenus.ts:279` 的 React Flow `onConnectEnd` 已经按「先前景节点、后底层编组、再空白派生菜单」正确排好优先级，但旧迁移遗留的捕获监听 `handlePendingGroupPointerUp`（`:378-400` + `GenerationCanvasReactFlow.tsx:677-678`）在捕获阶段用 `document.elementsFromPoint()` 穿透前景卡片直取底层 `[data-group-id]` 并抢先清空 `connectionStartRef.current`，导致只要前景目标卡叠在编组框上方，拖线松手就会跳过前景卡、误连底层编组成员。

### 1. 归类表：bug → 直接原因 → 类

| 提交 / bug | 直接原因 | 类 |
|---|---|---|
| `42beea3ad` 遗留捕获监听 | 在 React Flow `onConnectEnd` 之外额外挂了舞台 `onPointerUpCapture` / `onMouseUpCapture` 与全局 `pointerup` / `mouseup`，直接扫 `elementsFromPoint` 找 `[data-group-id]` | 同一手势存在两套落点裁决，捕获层绕过框架标准收尾 |
| `#1625` CI `Core Flow Smoke (used)` 红灯（`targetBoundaryError: 3.50px`, `targetWithinHeight: false`） | `#1625` 让新建视频卡出生即定形后，在 `used` 夹具里视频卡恰好叠在底层编组框上方；图片拖向视频卡松手时被 `handlePendingGroupPointerUp` 穿透截胡，连出 3 条指向旧角色/旧场景的组连线、指定视频卡收到 0 条边，旧走查只判 `edgeCount >= 1` 并拿第 1 条错边的终点去比对视频卡边界 | 体验铁律 ⑫（点了/拖到哪张卡 = 连上哪张卡）被底层穿透破坏 |

### 2. 为什么这一类会一直出现

`09-03` 卡身落点合同已经在 `handleConnectEnd`（`useGenerationCanvasReactFlowMenus.ts:290-303`）里把「先判前景 `.generation-canvas-v2-node[data-node-id]`，未命中节点再判 `[data-group-id]`」收成一份，但当时没有同步删掉更早遗留的 `handlePendingGroupPointerUp` 捕获捷径。只要一套手势保留「捕获阶段旁路抢跑 + 框架回调兜底」双入口，任何改变卡片初始尺寸或落点的正常改动一旦让前景卡与背景组框在屏幕上发生重叠，旁路监听就会穿透前景层劫持用户手势。

#### 三条体验铁律

- **命中铁律 ⑫（点了=以为的）**：创作者把连接线拖到前景视频卡松手，预期是「恰好连上这张前景视频卡」，实际观察却是「前景视频卡 0 条边、背后编组里的 3 个旧成员被悄悄连上 3 条边」。

### 3. 不改结构的话，接下来会冒出什么（可验证预测）

| 预测 | 怎么验证（命令或步骤） |
|---|---|
| 1. 创作者在任意已有编组的画布上把新生成卡拖到编组框上方（哪怕未入组），再拖参考图连向该卡，参考图会被静默灌进底下整组节点而目标卡收不到参考 | 在 `tests/ux/canvas-drag-pan-gestures.walk.mjs` 将目标视频卡置于任意 `[data-group-id]` 矩形内执行拖线，观察新增边 `target` 集合 |
| 2. 若不删捕获监听而只在捕获里再补一份 `.generation-canvas-v2-node` 判断，触控 `changedTouches`、把手直连 `onConnect` 与 `onConnectEnd` 仍各算一份命中，后续改卡壳类名或折叠组端口会再次分叉 | 对比 `useGenerationCanvasReactFlowMenus.ts:292-303` 与 `:378-389` 两处 DOM 选择器与事件源 |

### 4. 靶子独立性检查

- 本次标红的 CI 量具 `tests/ux/canvas-drag-pan-gestures.walk.mjs` 是主干既有冒烟（非 `#1625` 同一条线编写），它的几何边界断言（`targetBoundaryError <= 2` 且 `targetWithinHeight === true`）立了真功——抓出了旧走查 `edgeCount >= 1` 漏放的错连真缺陷。
- 靶子几何容差无需放宽，只需补严「新增边必须恰好是 `sourceImageId -> targetVideoId` 这一条」，防止错连到别处凑够边数蒙混过关。

### 5. 这一整块归谁（P0）

这一整块：画布从节点握把按下拖线到松手完成连接（连前景节点、连编组框或弹派生菜单）的唯一落点裁决
归谁：`@xyflow/react@12.11.5` 的 `onConnect` / `onConnectEnd` 事件链（https://reactflow.dev/examples/interaction/connection-events）与仓内唯一落点翻译器 `src/workbench/generationCanvas/reactFlow/useGenerationCanvasReactFlowMenus.ts:279`
我们哪里绕开了它：`src/workbench/generationCanvas/reactFlow/useGenerationCanvasReactFlowMenus.ts:378` 的 `handlePendingGroupPointerUp` 在舞台捕获阶段（`src/workbench/generationCanvas/reactFlow/GenerationCanvasReactFlow.tsx:677`）及全局 `pointerup`/`mouseup` 用 `document.elementsFromPoint()` 穿透前景节点直取底层 `[data-group-id]`，抢在 `handleConnectEnd` 跑「先节点、后编组」前提交整组连接并清空 `connectionStartRef.current`

### 6. 三条路对比表 + 推荐

| 选项 | 做什么 | 代价 | 选了以后同一类还会不会出现、从哪出现 | 风险 | 推荐 |
|---|---|---|---|---|---|
| 沿原方向修 | 在 `handlePendingGroupPointerUp` 捕获回调里再补一份「若 `elementsFromPoint` 含前景节点则放行」特例分支 | 小 | **会**：捕获监听与 `handleConnectEnd` 两处各自维护节点/编组命中选择器与输入设备分支，后续改节点壳或触控事件仍会漂移 | 中 | 不推荐 |
| 换一种做法 | 回退 `#1625` 已获用户点头的新建卡片尺寸或改初始落点避开 `used` 夹具里的组框 | 中 | **会**：只挪开了夹具里的重叠坐标，创作者平时在画布上把任何卡片摆在编组上方拖线依旧必现错连 | 高（掩盖真缺陷且破坏已批外观） | 不推荐 |
| **删掉（推荐）** | **只删重复抢跑的 `handlePendingGroupPointerUp` 捕获监听**（删 `useGenerationCanvasReactFlowMenus.ts:378-400` 及其导出，删 `GenerationCanvasReactFlow.tsx:677-678` 两行捕获挂载；全仓已核实交互式拖线 100% 经 `handleConnectStart` → `handleConnect` / `handleConnectEnd`，`handleConnectEnd:292-303` 原生已具备「先前景节点、未中节点再连编组框、再空白派生菜单」，老工程与编组露白处批连 100% 原样保留，#1625 已批外观一像素不动） | 极小（净删 ~30 行旧旁路代码，零新分支） | **不会**：拖线松手收尾全仓只剩 `onConnect` + `handleConnectEnd` 唯一入口，前景节点永远优先于底层组框 | 低（用组框露白批连走查 + 前景卡叠组框走查双向锁死） | **推荐** |

### 7. 用户要权衡的核心

当一张卡片叠在编组框上方、创作者把连接线拖到这张卡片上松手时，是应该连上眼前这张卡（删掉穿透前景卡的旧捕获旁路，交回 `onConnectEnd`「先卡后组」唯一入口；组框露白处松手仍连整组），还是保留只要底下有组框就穿透前景卡连整组的旧旁路？

## 特征测试清单（动结构前先锁住）

- `tests/ux/canvas-drag-pan-gestures.walk.mjs`（收紧断言新增边恰好为指定图片→指定视频 1 条，并保留 `sourceBoundaryError` / `targetBoundaryError <= 2px` 与 `targetWithinHeight === true` 几何硬断言）
- `tests/ux/group-ports.walk.mjs` 与 `tests/ux/group-reference-direction.walk.mjs`（锁住组框露白处松手批连全部可接成员与双向组端口原行为不退化）
