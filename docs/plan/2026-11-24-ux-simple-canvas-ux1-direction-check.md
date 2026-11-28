# UX1 方向检查 · 选中节点之后能直接生成

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

基线 `8ac07cffb`。独立复盘依据为 Phase 1 的 J05、J07、J09 真窗记录、两次协调裁决（7126279479、7126560423）和改前源码。

**全图**　取景交接在 `docs/engineering/seams.json` 表外。创作选句 → 建卡、选中、切工作区 → 打开分类适应 → React Flow 设置视口。另一条路径为右环 → `createConnectedNode` → 选中新卡 → 显示生成框。两条路的生成框都经 `ComposerAnchor` 锚在卡片下方。首帧画幅另属于已登记的 `archetype-panel-request` 交接。[档案到请求的现有全图](2026-11-15-archetype-single-entry.md)

### 0. 一句话根因

画布取景验收长期量卡片的外接盒，创作者要点的发送键却在盒外，且生成框采用屏幕单位，缩放后和卡片占的空间变化不同。

### 1. 历史与这次的直接原因

| 样本 | 直接原因 | 所属问题 |
| --- | --- | --- |
| `37acfd6d5` | 新卡落点把底部停靠区也算进可用区 | 空地区域 |
| `129f1bdec` | 新卡计算落点时采用的尺寸与第一次渲染尺寸不同 | 卡片真实占地 |
| `3b07518b8` | 松开连线时背景编组抢先拿到事件 | 同宿主的手势问题，和取景分别验证 |
| UX1 J05 / J09 | 首进适应只量卡和编组；派生选中后缺少检查整个生成框的入口 | 实际可操作区域 |

`fix-churn.mjs` 在宿主 `GenerationCanvasReactFlow.tsx` 和「画布高频位置投影」概念均报近 14 天 3 个 fix；候选路径还命中 `quickActions/`（2 个）和 `nodes/controls/`（8 个）目录。此次扫描未单列 `BaseGenerationNode.tsx` 文件热点。

### 2. 为何重复

对焦、落点已分别知道底栏占地和空地，首进仍把整个舞台传给外接盒算法。⑫「点了＝以为的」要求选完就能操作；J05 放大 188%，J09 右边发送键中心超过窗口宽。⑩「说的＝摆的」还要读回下游连的首帧和有效模型画幅，⑪的可选值交给原模型档案。右环与浮条应同写一份免费建卡事务；已出图的入边是否要等须读取源节点结果。

### 3. 可证伪预测

| 保留旧实现会看到什么 | 检查办法 |
| --- | --- |
| 把 188% 上限单改成 100%，窄窗的长卡仍可能把发送键推过底栏 | 对比生成框完整矩形与扣除停靠区的舞台矩形，单验缩放百分比不足 |
| 给派生按钮单独加平移，直接点一张左沿的已有卡仍会裁掉模型名 | 分别从右环派生、从空白处单击左沿已有卡，读回相同边界 |
| 监听每次节点或生成框尺寸变更会在拖卡或写提示词时抢镜头 | 选中后拖动和改文本，再多选，核对用户手势以外的视口写入次数 |

### 4. 量具独立性

Phase 1 先在真窗留下裁切坐标与动作表，随后用户明确单选时容许一次平移。验收量发送键、完整生成框的 DOM 矩形与实际导出文件，点击与决定分别按基线动作表记。只核截图里出现生成框会漏掉右端裁切。上述三个历史提交未给出「修对后评测掉分」的证据。

### 5. 归属

这一整块：打开画布、派生节点或选中已有节点时，把卡片和操作面放进可操作的舞台。

归谁：React Flow 12.11.5 管节点几何与视口变换；Nomi 的空地及对焦计算在 `src/workbench/generationCanvas/reactFlow/focusViewportRecovery.ts:48`，画布动画入口在 `src/workbench/generationCanvas/reactFlow/useReactFlowViewportAnimation.ts:25`，固定宽度取 `src/workbench/generationCanvas/nodes/nodeSizing.ts:92`。

我们哪里绕开了它：基线 `src/workbench/generationCanvas/reactFlow/GenerationCanvasReactFlow.tsx:350` 直接以舞台宽高、节点和编组外接盒取景。PR 的第一版又用 store 写入先后判定卡片是否已挂载，素材导入分两次写入时会误判。

`canvas-selection-composer-viewport` 保留混合编辑占地适配。React Flow 的取景 API 接收画布单位的矩形，Nomi 的生成框始终保留固定屏幕宽度，还需扣除停靠区域。当前由 React Flow 提供已提交的节点投影、缩放范围和坐标变换，适配只计算混合占地和何时允许自动取景。2026-12-08 复查，生成框改为舞台标准停靠层或 React Flow 支持混合单位取景时，删除该适配并迁回内置 `fitView`。复查沿用双语走查和首次取景、三侧越界、派生与独立建卡的定向用例。[React Flow 12 的 getViewportForBounds](https://reactflow.dev/api-reference/utils/get-viewport-for-bounds)

### 6. 三条路

| 选项 | 做法 | 代价与风险 |
| --- | --- | --- |
| 接入 React Flow 12.11.5 的内置 `fitView` | 用内核的节点和编组矩形完成整块取景 | 可以复用缩放和矩形取景。固定屏幕宽的生成框与停靠区域仍需适配，否则下一步按钮可能出界 |
| **共享取景（推荐）** | 首进使用现有空地和生成框足迹。单选基于上次已提交的节点投影，已有卡只平移，右环和图片浮条派生在第一帧有入边才取景 | 同一个边界覆盖工具条、粘贴、分步导入和派生。固定宽度超过可用宽度时，纯平移在几何上不能全包 |
| 删掉首进适应 | 打开时沿用当前视口 | 未保存视口或节点都在屏外的老项目会打开一张空白舞台 |

### 7. 用户已定的取舍

允许在用户单选且操作面溢出的瞬间移动视口一次，保留固定宽、钉在节点正下方的手感。以能点下一步、拖动时画布听手、右环和浮条均零提交为验收结果。

**现有特征测试**　`useAutoFitOnLoad.test.ts` 锁住打开时机，`canvasFitBounds.test.ts` 锁住编组边界，`composerCanvasPlacement.test.ts` 锁住锚点及占地，`focusViewportRecovery.test.ts` 验证焦点避开浮层，`connectionMenuModel.test.ts` 验证右环的建卡方向。基线 `tests/ux/new-node-composer-in-view.walk.mjs` 覆盖舞台内的新建落点；创作切屏和派生单选的实际结果须由本次旅程补证。
