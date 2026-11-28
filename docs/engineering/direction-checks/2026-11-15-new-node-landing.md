# 方向检查：新建节点出生即定形（视频 / 图片节点落点与默认尺寸）

> 2026-11-15 独立复盘（未参与前 3 轮的独立线）+ 用户拍板落地：**B1 出生即定形**（1A：`image 340×340`、`video 420×236`，两份注册表同改；2A：`addNode` 先构造节点，`visibleInsertionPoint` 读节点真实视觉尺寸 `resolveNodeVisualSize(node)`，去掉落点对 `getGenerationNodeFootprintSize` 的借用）。

**这一处的全图在哪**：表外（新建节点落点涉及 `nodes/registry.ts`、`electron/capabilityCore/nodeKindDomain.ts`、`nodes/nodeSizing.ts`、`store/canvasVisibleArea.ts`、`store/canvasNodeActions.ts`、`reactFlow/GenerationCanvasReactFlow.tsx`、`components/canvasAddIntentActions.tsx`）。

### 0. 一句话根因

节点刚出生时的尺寸不是它真正要画的尺寸，落点算式又拿「碰撞避让用的虚高足迹（名义尺寸 + 64px 安全余量）」来算落点，导致 1280×800 下视频被多顶上去约 168px、标题小标签被裁、1440×960 下被白白多提 79px。

### 1. 归类表：bug → 直接原因 → 类

| 提交 / bug | 直接原因 | 类 |
|---|---|---|
| 1280×800 空画布点「添加图片」，底栏最下一行被挡、加节点条被盖 | 落点曾按整个舞台高度的 28% 算，不扣底部停靠条、不给底栏留地方 | 同一事实两份说法：对焦读空地 + 底栏，新建读整舞台 |
| 第 3 轮修完图片后，1280×800 下视频仍顶到舞台上沿、标题标签被裁；1440×960 视频多提 79px | 视频注册默认尺寸 `420×340` 与默认 16:9 渲染高 `236` 差 104px，落点又叠加 `NODE_RENDER_SAFETY = 64` 当高，按 `404px` 算块高 | 出生尺寸失真 + 借用避让足迹算落点（一处猜、两处错） |
| 第 3 轮图片在 1280×800 靠 `280+64=344` 碰巧贴近真实 340 | 图片注册默认尺寸 `340×280` 比 1:1 真实高 `340` 矮 60px，靠避让足迹的 `+64` 歪打正着凑近 `344` | 两个错误相抵（脆弱巧合，一到视频就炸） |

### 2. 为什么这一类会一直出现

两个结构错位叠在一起：
1. **出生尺寸与默认比例脱节**：视频产品默认 16:9（`preferredVideoAspect([])` → `420×236`）、图片默认模型 Seedream 5.0 Pro 默认 1:1（`340×340`），但注册表仍写历史占位 `420×340` 和 `340×280`；节点落地瞬间是错尺寸，下一帧模型自动选好比例才突然跳形。
2. **落点借用避让足迹**：`visibleInsertionPoint` 在构造节点前只拿 `kind`，借碰撞避让用的 `getGenerationNodeFootprintSize(kind)`（自带 `NODE_RENDER_SAFETY = 64`）估高；64px 是防节点间相撞的间距，算进落点只会把单张新节点无故往上推 64px。

#### 三条体验铁律

不适用（不是意图抽取、模型参数清单或点击预期矩阵问题，而是画布新建节点几何与落点单一真相源问题）。

### 3. 不改结构的话，接下来会冒出什么

| 预测 | 怎么验证 |
|---|---|
| 以后改任一生成节点的默认比例或默认宽，注册尺寸悄悄失真，1280×800 下新节点再次顶出舞台或底栏落到停靠条后 | `npx vitest run src/workbench/generationCanvas/store/newNodeBornShape.test.ts`（钉死注册高 === 默认比例计算高 + 1280×800 / 1440×960 字面量落点） |
| `src` 注册表与 `electron` 镜像表只改一份，Agent / MCP 建出的节点尺寸与 UI 分叉 | `npx vitest run electron/capabilityCore/nodeKindDomain.equivalence.test.ts` |
| 有人在 `visibleInsertionPoint` 里按 `kind` 写特例分支或硬编码停靠条高度 | `npx vitest run src/workbench/generationCanvas/store/canvasVisibleArea.structure.test.ts` |

### 4. 靶子独立性检查

- 复盘由未参与前 3 轮的独立线给出「出生即定形（B1）」结论并经用户 2026-11-15 拍板。
- 特征测试 ① 用字面量期望（不调用被测函数反算）；真窗口走查 `tests/ux/new-node-composer-in-view.walk.mjs` 去掉了第 3 轮对视频的两处豁免（`kind !== 'video'`），用真实 DOM 矩形和 `elementFromPoint` 判四件全露。

### 5. 这一整块归谁（P0）

这一整块：画布新建节点出生尺寸与初始可见落点。
归谁：我们唯一的主人 —— 节点真实渲染尺寸归 `src/workbench/generationCanvas/nodes/nodeSizing.ts:352`（`resolveNodeVisualSize`），默认尺寸注册归 `src/workbench/generationCanvas/nodes/registry.ts:154,185`（镜像在 `electron/capabilityCore/nodeKindDomain.ts:19,21`），空地裁切归 `src/workbench/generationCanvas/reactFlow/focusViewportRecovery.ts:48`（`resolveFreeViewRect`），新建落点归 `src/workbench/generationCanvas/store/canvasVisibleArea.ts:94`（`visibleInsertionPoint`）。
我们哪里绕开了它：此前 `canvasVisibleArea.ts:105` 绕开了 `resolveNodeVisualSize`，改用避让足迹 `getGenerationNodeFootprintSize(kind)`；且 `registry.ts` 给 `image` / `video` 登记了与默认比例不符的占位高（280 / 340）。React Flow 的 `node.measured` + `useNodesInitialized`（`@xyflow/react` 12）要等节点挂载完成才测得到，属于「落地后再平移」——违背用户 2026-09-25「程序不主动平移 / 缩放画布」的领域约束，因此落点必须在入库前由同步纯函数 `resolveNodeVisualSize(builtNode)` 算清。

### 6. 三条路对比表 + 推荐

| 选项 | 做什么 | 代价 | 选了以后同一类还会不会出现、从哪出现 | 风险 | 推荐 |
|---|---|---|---|---|---|
| 沿原方向修 | 在 `visibleInsertionPoint` 里继续借避让足迹，或给 `video` 加特例扣掉 104+64px | 违反结构测试，视频卡未选中时仍显示 420×340 假比例，选中再跳 | 会：每个比例变动的节点都要再补特例 | 补丁越叠越多 | 否 |
| 换一种做法（B1 出生即定形：1A + 2A） | 1A：`image` 注册 `340×340`、`video` 注册 `420×236`（双表同改）；2A：`addNode` 先构造节点，`visibleInsertionPoint` 读 `resolveNodeVisualSize(node)`，移除 `getInsertionPosition(kind)` 参数与调用方重复 `position:` | Agent 批量视频卡行距由 404→300（需真机实测确认 16:9 零重叠、核对 9:16） | 不会：单测钉死受管种类注册高 === 默认比例高、双表等价，且落点读唯一视觉尺寸真相源 | 老项目均带持久化 `size`，实查 94 份样本 25/25 节点均有 `size`，外观零变化 | 推荐（2026-11-15 用户拍板） |
| 删掉 | 删掉「新建时把底栏装进可见区」机制，或等 React Flow 挂载后 `fitView` 平移 | 1280×800 下底栏再次被停靠条遮挡，或程序主动平移画布 | 会：回到原 bug 或违背 09-25 不主动平移拍板 | 破坏已拍板体验 | 否 |

### 7. 用户要权衡的核心

让图片（340×340）与视频（420×236）出生即按默认画幅定形、落点改读真实视觉高，在 1440×960 下视频零上移、图片仅上移 15.28px（≤20px），换来 1280×800 下视频与图片四件全露且零跳变、不挪视口。

## 特征测试清单（动结构前先锁住）

- `src/workbench/generationCanvas/store/newNodeBornShape.test.ts`：特征测试 ①②（字面量 1280×800 / 1440×960 落点 + 注册尺寸与默认比例 0px 跳变 + 双表等价），在改代码前先写并实跑 6/6 红后提交。
- `src/workbench/generationCanvas/store/canvasVisibleArea.test.ts`：空地、落点算式、默认窗口不带底栏种类不变、1280×800 / 1100×720 / 200% 缩放。
- `src/workbench/generationCanvas/store/canvasVisibleArea.structure.test.ts`：store 无第二份停靠条 / 底栏高度、落点算式无按种类分支。
- `electron/capabilityCore/nodeKindDomain.equivalence.test.ts`：`src` registry 与 `electron` 镜像逐项等价。
- `tests/ux/new-node-composer-in-view.walk.mjs`：真窗口三种尺寸、中英两轨（视频零豁免）。

## 补记 2026-11-27：同一类的第二个入口（派生节点落点）

- 现象：PR #1703 验收，1280×800 下对一张图选「图层分离」，派生节点落到原图**左边**；右边其实放得下（多 7px）。
- 直接原因：派生 / 新建节点经 `addNode` → `resolveInsertionPosition` → `electron/shared/canvas/canvasNodeLayout.ts` 的 `resolveInsertionPositionInAreaWith`（可见区内扫空位）。它判「整张卡装不装得进可见区」时用的是避让足迹（名义尺寸 + `NODE_RENDER_SAFETY` 64），和本复盘第 2 条「落点借用避让足迹」是同一类：64px 是节点之间的间距，不是这张卡的大小。
- 改法（换，不加分支）：同一函数里分开两把尺——判装不装得下、扫描边界用新节点自己的大小（调用方传 `occupiedSize(新节点)`，参数改为必填）；判和别的节点相不相撞、扫描步长仍用足迹。删掉「拿足迹判装下」那一处，没有按窗宽或按种类的特例。
- 钉住：`src/workbench/generationCanvas/store/resolveInsertionPosition.test.ts` 的 1280×800 / 700×720 字面量（改回旧判定即红）；`tests/ux/layer-split.walk.mjs` 量真窗口里派生节点在原图右边同一行、右边放得下时整张在可见区、放不下时出「新节点在右侧」边缘提示（09-25 不平移）。
