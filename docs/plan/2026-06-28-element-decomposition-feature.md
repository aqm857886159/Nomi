# 落地方案：图片元素拆解 + 改字（对标 Lovart Edit Elements）

> 状态：**方案文档（待 6 角色评审 + 样张拍板 → 才实现）**。
> 上承研究：`docs/research/2026-06-27-lovart-element-decomposition-research.md`（§3.7 真生成实测结论）。
> 决策依据：用户 2026-06-28「更接近完美否则不做」+「测够→写→过评审→落地→全做完」+ 已付 Replicate key（实测 ~$1.15）。

---

## 0. 一句话

把 Lovart「Edit Elements」的**效果**（一张图拆成可独立挪/删/换的元素 + 改字）落进 Nomi，但**架构上 compose 不 decompose 为主**——实测决定了取舍：
- **画面内拆元素/挪/删** → 用 `qwen/qwen-image-layered`（Replicate，实测优，影子单独成层无鬼影）。
- **改字** → 用**已接的 nano-banana 定向改图**（实测惊艳，零新模型）。
- **承载** → 复用 Nomi 现成的**白板子层系统**（CanvasAsset），不新造一套拖拽。

---

## 1. 范围（做什么 / 不做什么）

### ✅ 批 1（核心·招牌）：图片 → 拆解成可编辑元素
选中一个图片节点 → 工具条「拆解元素」→ 调 Replicate 拆成 N 张 RGBA 层 → 写进该节点的白板态 → 用户打开白板，每个元素可**独立选中/拖动/缩放/翻转/删除**，改完合成回图。

### ✅ 批 2（高识别度·低成本）：改字（Text Edit）
图片节点工具条「改字」→ 派生一个预置「把『旧字』改成『新字』、保留字体/风格」的改图节点（走已接 nano-banana image_edit），用户填新字即生成。**复用「定妆」派生范式，零新后端。**

### ⏸ 批 3（延后）：跨镜复用同一角色（decompose 抠角色 → nano-banana relight 进新场景）
实测可行（§3.7 T6），但链路长、属"跨镜身份"大题，单独立项，本方案不做。

### ❌ 不做（D2 广度是敌人）
- 海报→可编辑 PSD 导出 / PPTX 导出（平面设计向）。
- 拆"文字层"再逐字编辑（改字用 nano-banana 整图定向改更准，实测已证）。
- 自研新的子层拖拽系统（白板已有，P1 不造并行版）。

---

## 2. 已知边界（实测 §3.7）→ 产品上诚实处理（D4）

| 边界 | 处理 |
|---|---|
| 多人低 num_layers 会并进背景 | 默认 `num_layers=6`，给「拆得更细」按钮提到 8（实测 n=8 分出双人）|
| 拆完分辨率降到 ~736 长边 | 拆解结果**自动接已有即梦超清**回填，或标注「编辑稿，导出前重生成」|
| 遮挡物背后不完整补全 | 文案标注「被遮挡部分可能不完整」|
| 拆解要联网+额度（Replicate）| 同其他生成，走付费确认；本机够不到（57GB 模型）已是事实 |

---

## 3. 工程拆解

### 3.1 后端：接 Replicate vendor（复用 catalog 原语）
- **新 vendor seed**：`electron/catalog/replicate.ts`（仿 `kieNanoBanana.ts`/`runninghub3d.ts`）。
  - `key:"replicate"`, `baseUrlHint:"https://api.replicate.com/v1"`, `authType:"bearer"`（`Authorization: Bearer r8_…`）。
  - `assetIngestion`: `upload-multipart` → endpoint `https://api.replicate.com/v1/files`，`fileField:"content"`，`urlPath:"urls.get"`（实测本地图传上去拿 URL 喂模型）。
  - 经 `seedBuiltins.ts`（:304 注册区）reconcile 注册，守「版本更新不冲用户数据」（seed 存在即跳过）。
- **decompose 是多输出，不套单结果 runtime**：新增 IPC `image:decomposeLayers`（electron 侧），输入 `{imageUrl, numLayers}`，内部：
  1. 本地图经 `AssetIngestion` 物化成 Replicate 可达 URL；
  2. POST `models/qwen/qwen-image-layered/predictions`（`Prefer: wait`）+ 轮询 `get`；
  3. 返回 `string[]`（N 张 RGBA layer URL，index0=背景，下→上）。
  - 付费 → 走现有付费确认网关（`makeGateway` 三态，记忆 [[mcp-spend-confirm-global-fix]]）。
  - **为何独立 IPC 而非加 ProfileKind**：现有 runtime/catalogTaskResultParse 是「一主图+history」单结果模型（`canvasRunActions.ts:151`），多层输出套不进；独立路径**复用 vendor/key/assetIngestion 原语**但不污染单结果状态机（P4 声明驱动、非并行重复）。← **此点提交 6 角色评审（后端）确认**。
- **改字无新后端**：nano-banana `image_edit` mapping 已在（`kieNanoBanana.ts:78` NANO_BANANA_EDIT_MAPPING）。

### 3.2 画布：拆解结果 → 白板子层（复用，最低风险）
- 落点 = **白板 `CanvasAsset[]`**（`nodes/whiteboard/lib/canvas.ts:20-31`，每子层自带 x/y/w/h；选中/拖/翻转/多选已实现于 `whiteboardCanvasNodeOps.ts` + `useWhiteboardSceneSync.ts`）。
- 新建纯函数 `nodes/decompose/buildLayerWhiteboard.ts`（仿 `fixation/buildFixationNode.ts` 派生范式）：
  - 输入源节点 + `layerUrls[]` → 产出 `WhiteboardState`：每层一个 `CanvasAsset{source:'generated', layerId, x,y,width,height}` + 一个 `LayerItem`（背景层置底、可命名）。
  - 写进**新节点** `node.meta.whiteboardState`（`whiteboardState.ts:19` 单源），`renderKind` 走 `whiteboard-card`（`resolveRenderKind.ts:23`）→ 复用白板卡外壳 + Modal 编辑（记忆 [[whiteboard-node-unified-shell]]）。
  - 三段式：`store.addNode` → `updateNode(meta.whiteboardState)` → `selectNode`。**不自动拆**（先建空壳？否）——拆解需先出图，故：点「拆解元素」→ 付费确认 → IPC 拿 layerUrls → 建白板节点。
- **巨壳红线（R9/R12）**：`BaseGenerationNode.tsx` 已 **798 行**——挂载「拆解元素」按钮只加 1 行（`onDecompose={() => decomposeToLayers(node)}`，仿 :485 `onMakeup`）；逻辑全在新文件。`WhiteboardLeaferCanvas.tsx` **774 行**——不往里塞，扩展走已拆出的协作文件。

### 3.3 工具条入口（小）
- `nodes/NodeImageEditToolbar.tsx`：在「定妆」旁加两个入口——**拆解元素**（→ 3.2）、**改字**（→ 派生 nano-banana 改图节点，仿定妆）。
- 挂载 `BaseGenerationNode.tsx`（image-like + selected 区，:481-492 同款）。

---

## 4. 不动项 / 回滚 / 验收门

- **不动项**：现有 t2i/i2i/超清/拆镜头/裁剪/白板 Modal 编辑链路；单结果 runtime 状态机；param 一致性不变量；现有 vendor。
- **回滚**：批 1/批 2 各独立 commit；Replicate vendor seed、decompose IPC、白板写入、工具条按钮各自可单独 revert（全新增不删旧，守 P1）。
- **验收门**：
  - 五门（R11）+ 巨壳门岗（`BaseGenerationNode`/`WhiteboardLeaferCanvas` 不破 800）。
  - 真机走查（R13）：拆解一张真分镜 → 白板里每元素能独立挪/删 → 合成回图无穿帮；改字 RONIN→别字保风格。
  - 与样张逐项对账（R8，下一步出样张）。
  - 真生成 E2E（额度默认授权）：decompose + 改字各跑通出正确产物。

---

## 5. 待评审 / 待拍板

1. **6 角色评审（R7，下一步我跑）**：重点裁决 §3.1「decompose 独立 IPC vs 加 ProfileKind」、§3.2「白板承载 vs N 个独立节点」。
2. **样张拍板（R8）**：先读真实画布外壳 + 工具条真实样子，出「真实布局 + 改动」可体验样张，用户拍板后才实现。
3. **Replicate key 持久化**：实验用临时 key；产品里走用户在「接入」页填 Replicate key（产品级资源）。

---

## 6. 6 角色评审（R7，2026-06-28）

| 角色 | 关键意见 | 处置 |
|---|---|---|
| **CTO（架构/风险）** | ① decompose 多输出**别**硬塞单结果 runtime/ProfileKind——会逼着改 `catalogTaskResultParse` 的单结果契约，污染全站状态机（高风险）。独立 IPC 复用 vendor/key/assetIngestion 原语是对的，**非并行版**（新能力非重复）。② 两个巨壳 798/774 行是真雷，逻辑必须全进新文件。 | **采纳**：decompose 走独立 IPC（§3.1 定稿）。巨壳挂载只加 1 行。 |
| **设计** | PS 式「摆弄子层」放白板 Modal 是对的（白板就是 mini-PS）。但**拆完别让用户自己去点开白板**——effect-first：拆解成功后**自动打开白板**，用户立刻看到一堆可抓的元素，才有"炸开"的爽感。 | **采纳**：decompose 成功 → 自动 `selectNode` + 打开 WhiteboardModal。 |
| **PM（范围/价值）** | 批 1（拆解）+批 2（改字）是对的 MVP——一个给"挪/删元素"惊艳、一个给"改字"高频。批 3 跨镜复用确实该延后。第一个"wow"= 拆解后自动炸开。 | 维持批次。 |
| **前端** | 工具条已 7 个按钮（定妆/裁剪/抠图/切图▾/变换▾/画板/下载），再加 2 个=**挤爆**。应收进一个「AI 编辑▾」下拉（拆解元素/改字/未来 relight）。复用白板 CanvasAsset 可行，但要确认拆出的 RGBA 尺寸/坐标映射到白板画布坐标系（别踩坐标错位，记忆 [[whiteboard-node-unified-shell]] 的 leafer bbox 坑）。 | **采纳**：新增「AI 编辑▾」下拉收纳，不平铺加按钮。坐标映射进验收门。 |
| **后端** | Replicate `Prefer: wait` 可同步阻塞（实测 9-13s 出），但要兜超时→轮询 `get`。多输出 = `output` 是 string[]，直接返回。文件 API 上传拿 `urls.get` 喂模型实测通。付费确认必走（每次拆解都扣费）。 | **采纳**：IPC 内 wait+轮询兜底；接付费网关。 |
| **真实用户（D1 摩擦）** | 「拆解元素」这词用户秒懂（= Lovart 那个）。但**改完怎么用回去**？要有「合成回一张图」回到画布/时间轴的出口，否则拆了是死胡同。 | **采纳**：白板已有合成（strokes+assets 渲染回图），拆解编辑后「完成」写回节点 result（复用白板现成 flatten）。**合成回图进验收门。** |

**评审定稿的 3 个改动**（已并入上文）：
1. decompose = 独立 IPC（非 ProfileKind）。
2. 拆解成功**自动打开白板** + 工具条新增「**AI 编辑▾**」下拉收纳（不平铺）。
3. 验收门补：**白板坐标映射不错位** + **编辑后合成回节点 result**（闭环出口）。
