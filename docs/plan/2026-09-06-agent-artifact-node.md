# AI 手艺产物节点（agent-artifact）：设计文档 v4（已拍板 · 实施中）

> 状态：✅ 2026-09-06 用户拍板「设计完就去做，全部做完走独立分支 + PR」。本文 = 实施唯一依据；样张 `docs/design/mockups/2026-09-06-agent-artifact-node.html` 为拍板证据。UI 交付最终以设计实验室截图 + 视觉基线绿为准（2026-09-06 拍板口径）。
> v2 定位：**agent-artifact 不是"所有 Agent 产物都塞进去"的媒体筐**——调模型的生成照旧走现有生成节点与素材化通道；它只承载 **AI 不调模型、用代码/标记语言直接做出的"手艺产物"**。
> v3 补充（2026-09-06 用户追问）：**手艺产物必须能被"下游使用"**——不只是给人看，还要能固化成下游可消费的形态（参考图 / 文件）。SVG 的典型用途是**参考图**（生图画复杂人物贵且不可控，画构图线稿反而精确）；3D 的典型用途是**摆位**（桌子、两人对坐等场景/站位），截图后挂进镜头当参考。
> v4 数据模型收敛（实现前勘察实证，见 §4.1）：**不扩展 `GenerationResultType` 闭集**——`type` 是 zod 5 值 enum（`generationCanvasSchema.ts:43`）且被媒体白名单/下载扩展名链/生命周期密集消费，硬塞 svg/html/markdown/glb 会炸快照校验与媒体判定。改为：**agent-artifact 走 kind 专属渲染分支（BaseGenerationNode 内 scene3d/panorama 同级），产物元数据挂 `meta.artifact`**，渲染按 `meta.artifact.fileType` 分发子视图。
> 配套样张：`docs/design/mockups/2026-09-06-agent-artifact-node.html`（自包含单文件）。

## 1. 用户价值

三个痛点：
1. **AI 的表达类产物无处安放**。SVG 示意、动态 HTML 讲解、表格梳理、手作 3D 摆位……目前只能留在对话里"看完就走"，摆不到创作现场。
2. 不知道"什么时候该用什么"。哪些诉求**不该调模型**：画个 SVG / 摆个 3D 站位 / 拉个表就解决，省钱省时间还更清楚可控。
3. **产物要能喂给下游**（v3 核心）。参考图不是"最终画面"而是"创作的骨架"：SVG 构图线稿、3D 场景摆位，固化下来后要能被生成节点参考、被镜头使用——**产物能回流，画布才从流水线变成创作台**。

一句话：*调模型的走模型，动脑子的走手艺；手艺产物既能看，也能变成下游能吃的东西。*

## 2. 手艺选择框架（落成 Agent skill，不是 UI 开关）

**决策闸门：诉求是"要媒体本身"还是"要一个表达/参考物"？** 前者调模型，后者是手艺。

| 用户意图 | 用什么 | 典型例子（含下游用法） |
|---|---|---|
| 构图线稿 / 机位 / 结构示意 | **SVG** | 人物复杂不想生图 → 画**构图参考图**（角色占位/景别框/机位线），导出成参考图喂下游 |
| 场景 / 站位 / 空间摆位 | **3D 摆位（.glb）** | 一张桌子、两人对坐 → 摆好**截图成参考图**挂进镜头，不调生图 |
| 讲解 / 叙事 / 演示（会动会交互）| **动态 HTML** | 开场节奏讲解卡，放画布旁当"看得懂"的上下文 |
| 梳理 / 对比 / 分镜草表 | **表格** | 分镜草表梳理，不必开正式分镜表 UI |
| 要点 / 脚本 / 备注 | **Markdown** | 导演备注、旁白 v3 |
| 照片级画面 / 真实动作 / 声音 / 成品 3D | **（不走手艺）调模型** | 生图 / Motion·Hyperframe / 音频 / model3d（HiTem/Meshy）→ 现有节点 + 素材化 |

**「参考」在什么时候该走手艺、什么时候该调模型？**
- 要**精确可控的骨架**（构图、机位、站位、空间关系）→ 手艺（SVG / 3D 摆位），因为生图不可控、且它本来就是"参考而非成片"；
- 要**动态动作参考**（一段真实动作驱动生成）→ 那是媒体，走 Motion reference / 深度视频一类（调模型通道），不进手艺。

> **类型列表开放**：分发内核按"一行类型 + 一个渲染器分支"生长，不预做不欠债。同一语义只有一份定义：生成出来的成品媒体留在自己的生成节点。

## 3. 架构事实（已查证，file:line）

- 节点 kind 闭集合 15 种：`nodes/registry.ts:61-276`。无富内容承载 kind。
- React Flow 外壳唯一：`nodeTypes={generation: GenerationFlowNodeView}`（`GenerationCanvasReactFlowNodes.tsx:403`）；body 按 `resolveNodeRenderKind`（`nodes/resolveRenderKind.ts:26`）分发。
- Agent 已能把结果变画布节点：`agent/generationCanvasTools.ts:29-33`（tools:65-74 `store.addNode`）；`canvasRunActions.ts:140` `addNodeResult`。
- 文件只存门牌号：`result.url` = `nomi-local://`，落盘 `<workspace>/<project>/assets/generated/<日期>/`（`persistNodeImage.ts:14-45`；electron `writeAsset`）。
- **参考图语义已存在**：`asset`/`image` 可作参考被连线（`providesImageReference`，registry asset 插件注释）；下游生成消费参考图的链路已通。
- **3D 栈现成**：`Model3DViewer`（`nodes/model3d/Model3DViewer.tsx`，R3F `useGLTF`）已做画布内交互预览；three/fiber/drei 在依赖。src/assets/ 已有 .glb。
- **Markdown 渲染现成**：`NomiMarkdown`（`src/workbench/common/NomiMarkdown.tsx`）。

## 4. 设计决策（请拍板）

### 决策 1｜单 kind `agent-artifact`
一个壳承载全部手艺产物（SVG/HTML/表格/MD/3D/代码），动作一致；不为每类产物造并行 kind（P1）。新 kind 只能 Agent 创建（agentCreatable:true），用户不手动加空节点。

### 决策 2｜内容显示：壳统一 + 内层薄分发
| result.type | v1 渲染 |
|---|---|
| `svg` | 内联 `<img src=nomi-local://>`（图片管线，可缩放）|
| `html` | **动态沙箱预览**（决策 3）|
| `markdown` | `NomiMarkdown` |
| `table` | 轻量 HTML 表格渲染 |
| `code`/`text` | 展示 + 复制（执行 P1）|
| `glb` | 复用 `Model3DViewer`（零新渲染器）|

不引大而全文件预览框架（@open-file-viewer 等）：对手艺产物是过剩能力（R20）。SVG/HTML 落盘再引用，不塞内联源码。

### 决策 3｜HTML = 沙箱内允许脚本，但隔离执行
用户明确 HTML 要"动"。`<iframe sandbox="allow-scripts">`，**不给 allow-same-origin**：动画/交互能跑，但无 nodeIntegration / 无 preload·IPC / 禁导航弹窗 top 跳转（Electron 安全清单 + main 侧 will-navigate/new-window 拦截）。代码/MD/文本只展示不执行。信任不赌——一律按不受信隔离；要更强宿主能力走独立 WebContentsView（P1）。

### 决策 4｜下游消费（v3）：每个手艺产物都能"固化"成下游可吃的形态
这是 v3 的关键升级——**动作分两类：给人看 + 给下游用**：

| 产物 | 给人看 | 给下游用（固化/物化）|
|---|---|---|
| **SVG** | 预览 | **导为参考图**：栅格化为 PNG（`nomi-local://`），节点即可作为 image 参考被连线 / 拖进镜头 / 另存素材库 |
| **3D 摆位（.glb）** | 转盘查看 | **截当前视角为参考图**：从 `Model3DViewer` 视口出 PNG → 同样可被参考/挂镜头 |
| HTML / 表格 / MD | 放大 / 细看（复用 Portal 预览）| 下载 / 复制；HTML 如需"当画面素材"按需截图（P1）|

**实现方式（避免并行节点）**：产物节点内部维护一个"参考图导出"——`derivedRef.url`（栅格化/截图出的 PNG，也落盘）。节点 `providesImageReference: true` 时，**对外提供的参考 = derivedRef**；用户也可"另存为素材"把它落成普通 asset/image。这样"一个节点，参考图是它的一种导出形态"，不产生一堆并行卡。

- 参考化能力范围：SVG（栅格化）、3D（视口截图）v1 就要；HTML/MD/表格要不要截图参考，按真实诉求 P1 再看。
- 转换机制：SVG→PNG 走渲染层 canvas/图像管线；3D 截图走 R3F `gl.domElement.toDataURL`（或 preserveDrawingBuffer 读取），主进程落盘。

### 决策 5｜"什么时候用手艺"= 一个 Agent skill（含决策树 + 产物模板）
不是 UI 开关，是给 Agent 的**决策 skill**（可挂技能库 + 工具描述）：
- **输入**：用户诉求 + 上下文（要参考还是成片？要精确骨架还是真实画面？）；
- **决策**：落到 §2 表的哪一行（SVG / 3D 摆位 / 动态 HTML / 表格 / MD / 调模型）；
- **产出约定**：手艺产物交 `agent-artifact` 节点 + 关键场景自动"固化参考图"；
- **反例**：请求"给我一张能直接用的画面"却手绘 SVG = 错误（应调生图）；请求"构图怎么摆"却调生图反复抽卡 = 错误（应画 SVG/摆 3D）。
该 skill 与现有生图/生视频工具**并列不冲突**：skill 负责"选路"，工具负责"执行"。**是否落 skill、名字与仓库位置，先与现有 skills 体系（`skills/`、agent 技能注册）核对再定**，避免再造一套。

## 5. 交互（对齐现有节点动作系统，不新造形态）

**动作形态直接复用画布节点现成的动作系统**（2026-08-04 §1.5 已收口，"一份定义多处复用"，见 `NodeFloatingToolbar.tsx` 头注）：
- **浮条 = `FloatingToolbarShell`**（`nodes/NodeFloatingToolbar.tsx:17-40`）：浮在节点**正上方**（`bottom-[calc(100%+16px)]`），`bg-nomi-paper` + `border-nomi-line` + `rounded-nomi` + `shadow-nomi-md`，反向缩放抵消画布 zoom；**选中才出**（`selected && !isMultiSelectActive && !readOnly`，不是 hover），画布拖动时隐身。按钮原子 = `ToolbarButton` / `ToolbarIconButton` / `ToolbarDivider` / `ToolbarMenu`（Tabler 16/1.6，hover 底色，**无实心 accent 填充**）。
- **"放大/全屏" = 复用 `NodeMediaPreviewDialog`**（画布内 Portal 预览，图/视频共用、带视频自愈；2026-08-04 已删掉重复的放大实现，只留这套）——HTML/表格/SVG 的"放大"同款画布 Portal 预览；落盘文件是静态资源，安全。**不新造全屏浮层。**
- **"下载/导出" = 复用下载通道**（`useResultDownload` + 浮条"下载"按钮，`NodeResultDownloadButton.tsx`，i18n `resultDownload.download`）——SVG/HTML/MD/GLB 落盘文件都可直接下载。系统词汇是**"下载"**，不是"导出"。
- **"固化为参考图"**（决策 4，SVG/3D 专属）= 同一条浮条里的 `ToolbarButton`（icon + label，accent 变体 `text-nomi-accent hover:bg-nomi-accent-soft`），是这条工具栏的**主位动作**。
- 常驻（header）：类型 chip + 标题/来源 + 收起，密度 ≤ 现有节点；内容只读预览，HTML 沙箱内可交互但**不进编辑态**（改源码 P1 / 编辑器打开）。
- 新 kind 只能 Agent 创建（agentCreatable:true）；用户不手动加空节点。

## 6. 改动面（实现阶段）

1. `registry.ts` 增 `agent-artifact` 插件（agentCreatable:true、无 executionKind、`providesImageReference`——由 derivedRef 提供参考源）。
2. `generationCanvasTypes.ts` 扩展 result type 增 `svg/html/markdown/table/glb/code/text`（v1 落 svg/html/markdown/table/glb）。
3. `ArtifactBody` + 子视图（SvgView / HtmlSandboxView / MarkdownView / TableView / reuse Model3DViewer for glb）；`resolveNodeRenderKind` 映射。
4. **参考化管线**（决策 4）：SVG→PNG 栅格化、3D→视口截图；derivedRef 落盘 + 节点对外参考语义；"另存为素材"走 assetImportAdapter。
5. HTML 沙箱子组件 + main 侧 will-navigate/new-window 拦截（决策 3）。
6. Agent 侧：`deliver_craft` 工具（落盘→addNode→定位）+ **手艺选择 skill**（决策 5，先核对现有 skills 体系）。
7. 浮条动作复用：`FloatingToolbarShell` 挂 agent-artifact 专属动作组（下载 = useResultDownload / 放大 = NodeMediaPreviewDialog / 固化为参考图 = ToolbarButton）——**组合现成原子，不新写样式**。

## 7. 不动什么

- 现有 15 kind 生成行为、composer、卡片渲染、image/video/audio 素材化通道、参考图消费链路（连线/喂生成）**全不动**——agent-artifact 只是新增一个"参考源"。
- `BaseGenerationNode` 壳、React Flow 层、`nomi-local://`/`writeAsset` 不动。
- 正式分镜表 UI/故事板不动——手艺表格是轻量补充。
- HTML 只读沙箱预览；编辑态、宿主能力、文档类（docx/pptx）、HTML/表格截图参考 = P1。

## 8. 回滚

纯新增 kind + 组件 + Agent 工具/skill，不触碰现有路径；`git revert` 单 PR 即回。存量项目打开不受影响。

## 9. 验收门（实现阶段）

1. Agent 经手艺 skill 能产出并上画布：SVG / 会动的 HTML / Markdown / 表格 / 3D 摆位，各按 §4 渲染。
2. **下游消费闭环**：SVG 图"固化为参考图"→ 生成的 PNG 可被连线/拖镜头/另存素材；3D 摆位截当前视角成 PNG 同链路。（真实用户旅程，R16）
3. 动态 HTML：动画/交互正常；恶意脚本碰不到 Electron API、读不了文件、弹不了窗。
4. 现有生成节点与素材化/参考链路零回归（tsc/build/test + 真机走查）。
5. header 密度 ≤ 现有节点；动作只在浮条；内容不压按钮。
6. 手艺选择 skill：正例/反例判对（要画面→调模型；要骨架→手艺）。

## 10. 实施决议（v1 范围 · 拍板后）

**v1 本轮实现状态（2026-09-06 落地核对）：**
- [x] kind 注册 + 镜像表三处：`registry.ts` 插件（agentCreatable:true / 无 executionKind / quickAdd:false）；`canvasRead.ts` `CANVAS_NODE_KINDS`；`nodeKindDomain.ts` 尺寸/标题镜像（equivalence 测试绿）。icon 复用 image（P1 换专属）。
- [x] `meta.artifact`（`model/artifactMeta.ts`：fileType 词表 + reader + copy/参考谓词）+ `resolveNodeRenderKind` 强制 undefined（防 cast/scene 误判卡）+ BaseGenerationNode **kind 专属分支** → ArtifactBody。
- [x] ArtifactBody 子视图：svg（img）/ html（沙箱 iframe allow-scripts，无 same-origin）/ markdown / table / text / glb（Model3DViewer）。
- [x] HTML 沙箱纵深核对：窗口 `nodeIntegration:false + contextIsolation:true` + 无 nodeIntegrationInSubFrames + `setWindowOpenHandler` deny + `will-navigate` 只放行本地入口 → 无需新增 main 代码。
- [x] 浮条动作 `ArtifactNodeToolbar`：下载（bridge.assets.download）+ 复制（text/markdown/html）。放大 / 固化参考图 / 3D 截图 = P1。
- [x] i18n zh+en（`runtime.nodeRegistry.'agent-artifact'.*`）；check:i18n 全绿（5036 keys parity）。
- [x] vitest：artifactMeta 6 用例 + generationCanvas 2743 passed 零回归 + electron equivalence 6 用例。
- [ ] 交付纪律：sibling worktree `Nomi-agent-artifact-node` + preflight ✅ + 分支 PR（进行中）。

**P1（不在本轮，文档待办）：** SVG→PNG 栅格化"固化为参考图"（derivedRef + asset 落库）、3D 视口截图参考化、HTML 放大/截图当画面素材、表格参考化、手艺选择 skill 落库（先核对 skills 体系）、设计实验室接入、node 专属 icon。
