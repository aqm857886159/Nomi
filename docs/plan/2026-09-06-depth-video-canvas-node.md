# 深度视频处理节点（复刻 depth.cards 全功能）实施计划

> 日期：2026-09-06 · 状态：⏳ 已拍板·未开工 · 仅施工计划，不含生产代码

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在生成画布新增本地处理型节点 `video_depth_process`，复刻 [depth.cards](https://depth.cards/) 的完整网页能力：用户从画布上已有的视频素材节点选源 → 调参数（深度模型档 / 姿态模型档 / 四种输出模式 / 分辨率 / 帧率 / 色彩映射 / 时间平滑 / 骨架样式 / 时间范围裁剪 / 多人）→ 本地 WebGPU 逐帧推理 → 输出「深度 / 深度+骨架 / 纯骨架 / 原+骨架」四种之一的新视频资产（可选附带 `poses.json`）。全部在用户机器本地完成，不上传，零 API 费用。

> **范围修订（2026-09-06 产品拍板，Stage 1+2 合并）**：对照 Nomi 核心价值（成本/定制/本地 × 批量创作者/公司）后，首版不做「全量复刻」，按价值密度裁剪如下——**做**：`depth` / `depth_skeleton` / `original_skeleton` 三模式、深度 Small+Base 两档、分辨率 512/768/1024/Original、帧率档、时间裁剪、时间平滑、多人 1–4、深度方向、pose.json 导出；**砍（v1 不做，防回归）**：`skeleton_black` 模式、Inferno/Viridis 色彩映射（下游模型读深度值，显示风格无价值）、Pose Lite/Heavy 档（只做 Full）、骨架 glow 发光、骨架关节半径/线宽精调 UI（内部固定合理值，schema 保留字段但 UI 不暴露）。**v1 验收门强制含产品闭环**：深度产物资产必须能被画布上带 `video_ref` 槽的生成模型（Seedance 2.0/2.5 等）当参考视频消费，真实任务「真人视频 → 深度参考 → 连线生成 → 新角色演绎片」跑通。depth.cards 完整功能矩阵保留在 §1 作为「未来全量对齐参考」，不删除。

> **3D 备注（2026-09-06 澄清）**：用户所指"做 3D" = Nomi 现有 `model3d`（glb 生成）/ `scene3d`（3D 场景镜头视频）节点，两者与深度节点无直接闭环，v1 不为其预留集成。pose.json 虽天然可作为未来「真人动作 → 3D 角色骨骼动画驱动」方向（类 Motionshop）的输入，但 Nomi 现无骨骼动画驱动能力，此方向不在 v1 范围，pose.json v1 定位仍是"导出供外部/未来消费"。


**Architecture:** 新 kind 进闭合节点注册表，参数存 `meta`（随画布文档持久化/撤销），产物走现有节点 `result` 资产协议。推理不放 provider：深度估计用 **onnxruntime-web + WebGPU** 跑 **Depth Anything V2**（fp16 ONNX），姿态用 **MediaPipe Tasks Vision**（PoseLandmarker）——两者都在**渲染层 Web Worker** 执行（沿用 `removeBackground.worker.ts` 模式）；ffmpeg 抽帧/合成/资产落盘在主进程（沿用 `framesToVideo.ts` / `writeAsset`）；长任务编排放主进程轻量 job（仿 `scene3d frames-to-video` 通道），进度经现有 `setNodeProgress`（runtime 源，不进 undo）。模型权重按需下载到 `userData/models/`（首次），下载进度走同一条 job 进度通道。

**Tech Stack:** Electron 43 + React 18 + Zustand/Immer + React Flow + `onnxruntime-web`（从传递依赖升为直接依赖）+ `@mediapipe/tasks-vision`（新增）+ 系统 ffmpeg。

**Spec 来源：** depth.cards 实抓界面（Nyfantasy — Depth Maker）；技术验证 spike（2026-09-06，Electron 43.4.1 + WebGPU + DA2 small fp16，96 帧 720p 全部跑通，单帧中位 525ms，产物 `outputs/spike-depth/`）；相关同类计划 `docs/plan/2026-09-06-video-deconstruction-table-node.md`（拆解表节点，提供 kind/schema/写边界范式）。

## Global Constraints

- 本计划执行分支：`codex/plan-video-depth-canvas-node-20260906`；实现时必须从最新 `origin/main` 建独立 worktree。
- P1：本节点是纯新增能力，不与任何旧实现重叠；但**深度/骨架两条处理路径必须收敛在同一个 `video_depth_process` kind 内**（四种模式是同一节点上的参数，不是四个并行节点类型）。
- P2：不改 provider/model catalog；本节点是**本地处理节点**，`executionKind` 不设（不是生成），Run 行为由专属编排处理，不伪装成 provider 任务、不花额度。
- P3/R13/R16：CI 绿只是必要条件；必须用真实视频（本地 mp4，含人物/舞蹈）跑完四种模式与 pose 导出，截图人眼走查。
- **R16/P3 完整测试系统（2026-09-06 用户追加拍板："要构建完整的测试系统，最终要做用户的走查、真实的使用测试"）**——五层缺一不可：
  1. **单元/契约层**：schema/parse/derive/灰度/平滑/骨架绘制/模型清单（已按 Task 1/3/4 落地，45 tests 绿）。
  2. **worker 协议层**：消息状态机/批处理纯逻辑 contract 测试（Task 5 内）。
  3. **设计实验室 6 态**：`src/devlab/designLab/` 注册 `video-depth-*` 状态夹具 + `tests/ux/design-lab/labStates.mjs` 登记 + `design-lab.visual.spec.mjs` 截图进 `__baselines__`，人眼对账。
  4. **真实 Electron 旅程 walk**：`tests/ux/video-depth-journey.walk.mjs`（沿 `_launchApp.mjs` / walk 惯例）跑真实任务：导入/选择源视频 → 参数 → 三模式处理 → pose.json → 结果落资产 → 重启恢复 → 撤销。
  5. **产品闭环端到端**：深度产物 → reference 边 → 带 `video_ref` 槽模型真实生成"新角色演绎片"，人眼确认动作保持、无原视频身份残留。
  - 走查截图一律**人眼判断**（R13），不以 expect 断言代替；走查中发现的问题全部修复后才算完成。
- R4/R9：实现前保持本计划；每职责一个文件，生产与测试文件均 ≤800 行；接近 800 行的 worker/client 先抽子模块。
- R15：所有新增用户可见文字走 `zh-CN`/`en` i18n。
- R17/R22：worker 批处理帧传输与模型下载进度是"线上才炸"一族 → 按 R17 给 contracts/`check:heavy-path` 覆盖；验证按画布、Electron、Worker、真实旅程分层。
- R23：画布文档是唯一真相源；React Flow 只投影；本节点不建第二个 store/timeline。
- R26：渲染层（worker/编排）不得反向 import 主进程类型；共享输入/输出 schema 放 `electron/shared/canvas/videoDepth.ts`。
- 默认决策（用户拍板）：处理范围支持**时间裁剪**（meta 起止秒）；默认处理分辨率 **768px（长边）**，可升 Original。

## 1. 复刻目标矩阵（depth.cards → Nomi 节点参数）

depth.cards 界面全部控件逐项映射（实抓于 2026-09-06）：

| depth.cards 控件 | Nomi 节点 meta 参数 | 类型/取值 | 默认 |
|---|---|---|---|
| Mode：Depth only | `mode` | `'depth'` | ✅ |
| Mode：Depth + Skeleton overlay | `mode` | `'depth_skeleton'` | — |
| Mode：Skeleton only (black bg) | `mode` | `'skeleton_black'` | — |
| Mode：Original + Skeleton | `mode` | `'original_skeleton'` | — |
| Export pose JSON | `exportPoseJson` | boolean | false |
| Depth Model：Small/Base | `depthModel` | `'small' \| 'base'` | `'small'` |
| Pose Model：Lite/Full/Heavy | `poseModel` | `'lite' \| 'full' \| 'heavy'` | `'full'` |
| Max people 1–4 | `maxPeople` | number 1–4 | 1 |
| Max resolution 512/768/1024/Original | `maxResolution` | `512\|768\|1024\|original` | **768**（用户拍板） |
| Processing FPS 8/12/15/24/30/60 | `processingFps` | number | 30 |
| Depth Style：Grayscale/Inferno/Viridis | `depthStyle` | `'grayscale'\|'inferno'\|'viridis'` | `'grayscale'` |
| Depth direction：Near=white/black | `depthDirection` | `'nearWhite'\|'nearBlack'` | `'nearWhite'` |
| Temporal smoothing 0–1 | `temporalSmoothing` | number 0–1（滑条）| 0.35 |
| Line thickness | `skeleton.lineWidth` | number | 3 |
| Joint radius | `skeleton.jointRadius` | number | 5 |
| Confidence | `skeleton.confidence` | number | 0.35 |
| Glow/Outline | `skeleton.glow` | boolean | false |

> 上表为 depth.cards 全量对齐参考（完整映射保留，避免未来要找回时重新逆向）。**v1 取舍**见顶部「范围修订」块：灰底色行（skeleton_black 模式、Inferno/Viridis、Pose Lite/Heavy、Glow、骨架精调 UI）v1 不做，schema 保留结构但解析/UI 层不暴露或拒绝。

**Nomi 增强（depth.cards 没有但用户明确要的）：**

| 增强 | meta 参数 | 说明 |
|---|---|---|
| 时间范围裁剪 | `trimStartSeconds` / `trimEndSeconds`（默认 0 / 源时长）| 只处理窗口内帧；ffprobe 取源时长填充 UI |
| 源视频选择 | `sourceVideoRef` | 从画布现有 video/asset 素材节点选择（存 nodeId + asset 引用，仿拆解表 `VideoSourceReference`）|

**模式对执行的影响：**
- `mode: 'depth'` → 只需深度管线（跳过 Pose 加载/推理）。
- `mode: 'skeleton_black'` → 只需姿态管线；黑底输出。
- `depth_skeleton` / `original_skeleton` → 深度 + 姿态都跑（耗时最长）。
- 骨架类模式默认需要 `maxResolution` 语义一致：骨架线在最终输出分辨率上绘制。

## 2. 固定决策与边界

### 2.1 固定决策
- 一个源视频 + 一次处理 = 一个 `video_depth_process` 节点 + 一个输出视频资产（`node.result`）；节点不建表格、不拆镜头。
- 参数即 meta（可撤销、随项目快照、重启恢复）；运行态（进度/阶段/取消）在 `result/progress`（runtime，不进 undo）。
- 推理执行在**渲染层 Web Worker**（WebGPU），ffmpeg 在主进程；编排（job 生命周期）在主进程轻量 handler（仿 `nomi:scene3d:frames-to-video`），进度事件推渲染层。
- 帧流通为**批量 transferable**：主进程抽帧落临时目录 → 按批（如 32 帧）经 IPC 取 JPEG `ArrayBuffer` → worker 推理/合成 → 每批回传原始深度/骨架帧 → 主进程写 `.raw` 临时文件 → 全部完成后 ffmpeg `rawvideo → mp4` → `writeAsset` 落项目资产 → 回写 `node.result`。
- `exportPoseJson=true` → 主进程累积每帧 landmarks（normalized + visibility）→ 输出 `poses.json` 资产。
- 模型权重按需下载缓存：`app.getPath('userData')/models/<name>`；下载清单静态白名单（URL+大小+sha256），首次执行节点时若缺则先下载（进度独立阶段 `download-model`），下载失败给出明确错误与重试。
- 取消：jobId 维度；取消后清理临时 raw/帧目录；已落资产的产出不自动删除（与画布删除语义一致）。
- `mode:'depth'` 时跳过姿态模型加载与下载（不下载 MediaPipe task 文件）。

### 2.2 不动项 / 边界
- 不进 Agent/MCP（v1 只在画布 UI + quickAdd；`agentCreatable` 暂不设，后续可开）。
- 不走 ProductionRun / 不花额度 / 不进预算门（本地免费处理）。
- 不接 timeline 直接写入；输出只是资产，用户可再拖时间轴。
- 不做深度图"时序跨帧全局优化"（如 Video Depth Anything / RAFT 光流对齐）——首版用 depth.cards 同款**逐帧 + temporal smoothing** 语义，避免引入光流新依赖，质量足够。
- `maxResolution: 'original'` 不做分辨率上限（但 1080p+ 显示"预计很慢"提示），首版不强制上限。
- 不新增通用"模型下载器"全局能力；v1 的模型下载逻辑收敛在本节点的 job 内（通用化留给未来另一个计划）。
- 不在渲染层缓存整段视频帧于内存（按批处理、批间释放），受 `check:heavy-path` 约束。

**v1 明确不做（范围外，防止被"既然参数在 schema 就顺手做了"带偏）**：
- `mode: 'skeleton_black'`（黑底纯骨架）——v1 无消费方（与 pose.json 语义重叠），留到有骨骼/3D 输出需求时再开。
- `depthStyle: 'inferno' | 'viridis'`——纯可视化；下游 video_ref 模型消费深度值不是显示色。schema 仅保留 `'grayscale'`。
- `poseModel: 'lite' | 'heavy'`——只实现 `'full'`；schema 枚举保留但解析时非 `'full'` 拒绝（或回退 full 并告警）。
- 骨架 glow 发光、关节半径/线宽 UI 精调——骨架绘制按内部固定值（radius 5 / width 3 / confidence 0.35 同 depth.cards 默认）；schema 保留 `skeleton.*` 字段但节点 UI 不暴露，避免参数噪声。

**v1 产品闭环验收（Stage 1+2 合并后的核心验收）**：
- 深度节点产出的视频资产 = 画布普通视频资产（`node.result`），必须能走现有 reference 边 → `video_ref` 槽（`generationReferenceResolver` 已支持：带 `video_ref` 槽的模型如 Seedance 全能参考会把它当参考视频，而非首帧接力）。
- R16 真实任务必须包含：本地真人/舞蹈 mp4 → 深度节点（`depth_skeleton`，small，768px，4s）→ 连线到带 `video_ref` 槽的生成模型 → 生成"新角色做原动作的演绎片" → 人眼确认动作结构保持、无原视频身份/背景残留。
- 若验收发现连线/槽位映射有缺口（如某模型档案漏 `video_ref` 声明），修共享边界（档案/解析器），不在深度节点内做"特供导出"。

## 3. 现状证据（file:line，实现时以 main 最新为准）

| 现役实现 | 证据 | 结论 |
|---|---|---|
| kind 注册表 | `src/workbench/generationCanvas/nodes/registry.ts:61-276`（`GENERATION_NODE_PLUGINS`，plugin def L34-48）；模板 `video` L136-148、非生成参考 `asset` L265-275 | 新增 kind 条目 + 类型自动派生 |
| kind/executionKind 闭合 | `GenerationNodeExecutionKind` registry.ts:17；`model/generationNodeKinds.ts` 重新导出 L11-12、派生表 L25-89 | 不设 executionKind、不设 agentCreatable |
| 默认分类 | `model/generationCanvasTypes.ts:34` | 可给 `'media'`/现有合适分类 |
| i18n 节点名 | `src/i18n/locales/runtime.ts:32-49`（`runtime.nodeRegistry.<kind>.{menu,title,placeholder}`），读法 `generationNodeKinds.ts:72-83` | 加 `videoDepthProcess` 三键 |
| 图标/卡片分发 | `nodes/renderRegistry.tsx:85-118`（getGenerationNodeComponentForNode L103-118）；`reactFlow/GenerationCanvasReactFlowNodes.tsx:403` 单 nodeTypes 无 kind 白名单 | 注册即自动投影 |
| 参数存储/推断 | 参数直存 `meta[key]`（`nodes/controls/parameterControlModel.ts:239-245`）；**无静态 schema，meta 驱动** | 本节点自建 meta schema + 专属 body 控件 |
| 视频素材资产 | `adapters/assetImportAdapter.ts:241-248`（node.result `{type:'video',url:nomi-local://,assetId}`）、meta L256-262 | 源视频从已有 video/asset 节点取 |
| nomi-local 反解 | `electron/video/extractVideoFrame.ts:47-75`（resolveVideoLocalPath）| 主进程取源路径 |
| Worker 模式 | `src/lib/removeBackground.ts:24-67` + `removeBackground.worker.ts`（req/resp id/progress/error、串行队列）| worker 协议直接沿用 |
| vite wasm hack | `vite.config.ts:34-65`（dead-wasm 移除）、worker.plugins L328-333 | 扩展或新增 onnx/mediapipe wasm 打包规则 |
| ffmpeg 抽帧 | `electron/video/extractVideoFrame.ts:108-158`；`framesToVideo.ts:65-104`（PNG→mp4）| 抽帧复用 + 加 rawvideo 合成分支 |
| writeAsset | `electron/assets/projectAssetStore.ts:247` | 输出落资产 |
| IPC 先例 | `preload.ts:357-360`（scene3d.framesToVideo）；handler `electron/video/videoIpc.ts:10-33`（assertTrustedSender）；注册 `main.ts:710-713` | 仿此新增 `videoDepth` 通道 |
| store 写边界 | `store/canvasNodeActions.ts:110-130`（updateNode(id,{meta})，undo 走 pushEditBurstBarrier L36-46）、`addNode` L49-104、`setNodeProgress` `canvasRunActions.ts:70-97`（不进 undo）、`addNodeResult` L140-174 | meta 编辑/进度/结果走现有边界 |
| 渲染 overlay | `NodeGeneratingOverlay.tsx:11-20` 泛化（仅特判 comfy 相位）| 复用；本节点加"下载模型"阶段文案 |

## 4. 目标数据与节点 schema

### 4.1 节点外壳
```ts
type VideoDepthProcessNode = GenerationCanvasNode & {
  kind: 'video_depth_process'
  meta: {
    videoDepth: VideoDepthSettings
  }
}

type VideoDepthSettings = {
  schemaVersion: 1
  sourceVideoRef?: VideoSourceReference   // { sourceNodeId, sourceAssetRef?, sourceUrl, title, durationSeconds?, sourceKind }
  trimStartSeconds: number
  trimEndSeconds: number                  // 0 = 源末尾
  mode: 'depth' | 'depth_skeleton' | 'skeleton_black' | 'original_skeleton'
  depthModel: 'small' | 'base'
  poseModel: 'lite' | 'full' | 'heavy'   // v1：解析仅接受 'full'，其余拒绝/回退 full
  maxPeople: 1 | 2 | 3 | 4
  maxResolution: 512 | 768 | 1024 | 'original'
  processingFps: 8 | 12 | 15 | 24 | 30 | 60
  depthStyle: 'grayscale'                // v1：仅 grayscale（inferno/viridis 不入 schema 取值）
  depthDirection: 'nearWhite' | 'nearBlack'
  temporalSmoothing: number       // 0..1
  skeleton: {
    lineWidth: number             // 内部固定 3（UI 不暴露）
    jointRadius: number           // 内部固定 5（UI 不暴露）
    confidence: number            // 内部固定 0.35（UI 不暴露）
    glow: boolean                 // 恒 false（v1 不做）
  }
  exportPoseJson: boolean
  updatedAt: string
}
```

### 4.2 运行态（不持久化进 meta 的运行时字段）
```ts
type VideoDepthRuntime = {
  phase: 'idle' | 'download-model' | 'warming' | 'processing' | 'encoding' | 'done' | 'failed' | 'cancelled'
  jobId?: string
  progress?: { doneFrames: number; totalFrames: number }  // processing 阶段
  download?: { modelName: string; doneBytes: number; totalBytes: number }
  error?: { code: string; message: string; retryable: boolean }
}
```
存节点 `progress` / `result`（沿用现有运行时字段与 `addNodeResult`），**不新增节点级新字段**。

### 4.3 来源视频引用
沿用拆解表 `VideoSourceReference` 语义，放 `electron/shared/canvas/videoDepth.ts`（跨进程唯一 owner），renderer 与主进程共用解析/校验。

## 5. 分层与文件拆分（每文件 ≤800 行）

| 层 | 计划落点 | 单一职责 |
|---|---|---|
| 共享 schema/类型 | `electron/shared/canvas/videoDepth.ts`（新建）| `VideoDepthSettings` / payload / `VideoDepthResultEnvelope` / `PoseFrameData` / 参数解析与校验（唯一 owner，renderer 与 main 都从这里 import）|
| 参数模型/默认值 | `src/workbench/generationCanvas/videoDepth/videoDepthSettings.ts`（新建）| 默认设置、合法取值集、裁剪/分辨率派生辅助（抽帧窗口、输出宽高、帧数估算）|
| 节点注册 | `nodes/registry.ts` / `model/generationNodeKinds.ts` / `model/generationCanvasTypes.ts:34`（改）| 新 kind 条目、默认分类、类型自动派生 |
| 节点 UI | `nodes/VideoDepthNodeBody.tsx`（新建）+ `nodes/BaseGenerationNode.tsx`/`NodeCardBody.tsx` body 分支（改）| 源视频选择（列出画布 video/asset）、参数控件（select/number/boolean/toggle 直写 meta）、模式预览（mode 相关）、下载模型/进度/取消控件；只读 store、不直连主进程 |
| 渲染层编排客户端 | `videoDepth/videoDepthClient.ts`（新建）| 发起 job（main IPC）、订阅进度/阶段事件、取消、把 worker 产物逐批交给 main；状态→`setNodeProgress`/`addNodeResult` |
| 渲染层推理 worker | `videoDepth/videoDepthWorker.ts`（新建）| 加载 DA2（onnxruntime-web webgpu）+ MediaPipe Pose；串行处理帧批；色彩映射/深度方向/时序平滑/骨架绘制/四种合成都在 worker 内完成；进度按帧回传；串行队列 + 取消检查 |
| 深度后处理 | `videoDepth/depthRenderUtils.ts`（新建）| 灰度映射、近白近黑翻转、temporal smoothing EMA 滑窗、逐帧合成像素（v1 无 inferno/viridis）|
| 骨架绘制 | `videoDepth/skeletonRenderUtils.ts`（新建）| MediaPipe 33 点拓扑连线表、固定线宽/关节半径/置信度过滤（无 glow），画到 canvas |
| 主进程 job | `electron/video/depthVideoJob.ts`（新建）| job 生命周期：模型清单校验与按需下载（进度）、ffmpeg 抽帧（裁剪/缩放/定帧率）、驱动渲染层 worker 批次、写 raw、pose 累积、ffmpeg raw→mp4、`writeAsset`、清理、取消/错误 |
| IPC 桥 | `electron/video/depthVideoIpc.ts`（新建）`、`src/desktop/bridge*.ts`/`preload.ts`（改）| `assertTrustedSender` 守卫；`videoDepth.*` 方法：start/进度事件/cancel/模型缓存状态 |
| 渲染层模型清单 | `electron/shared/canvas/videoDepthModels.ts`（新建）| 模型白名单：URL（hf-mirror / google storage 镜像白名单）、大小、sha256、用途（depth small/base、pose lite/full/heavy）、落地文件名 |
| i18n | `src/i18n/locales/runtime.ts`（改，zh+en）| `nodeRegistry.videoDepthProcess.*`、阶段/错误文案 |
| 测试 | 各层就近 `*.test.ts(x)` + 真实旅程 | 参数校验、LUT、worker 协议、job 生命周期、IPC 合同、Electron 走查 |

节点 type 与 registry、renderRegistry 图标、快照白名单若存在（`canvasSnapshotNormalizer.ts` 若有 kind 白名单数组需加新 kind）。

## 6. 执行编排（job 时序）

```
用户: 节点已有 sourceVideoRef → 调参数 → 点「开始处理」
renderer: videoDepthClient.start(jobParams) ──IPC──▶ main: depthVideoJob.start
main: 1) 校验源视频路径 (resolveVideoLocalPath) + ffprobe 时长
      2) 模型清单检查 → 缺则下载（进度阶段 download-model，逐字节百分比）
      3) ffmpeg 抽帧：-ss trimStart -to trimEnd, scale≤maxResolution, fps=processingFps → tmp/<job>/frames
      4) warm: 通知渲染层 worker 加载模型（阶段 warming；首次含 shader 编译）
      5) 循环批：renderer 请求批 n（IPC 取 JPEG ArrayBuffer×32）→ worker 推理+合成+pose →
         renderer 回传 raw(灰度/rgb) + pose JSON 片段 → main 写 raw 文件/累积 pose
         每帧完成发 progress{doneFrames,totalFrames}
      6) 全部完成 → ffmpeg rawvideo→mp4（gray 或 rgb24）→ writeAsset
      7) exportPoseJson && pose → 写 poses.json 资产
      8) addNodeResult 回写 node.result；phase done
      任一步异常 → phase failed{code,message,retryable}；清理 tmp
cancel(jobId) → 停止取批、杀 ffmpeg、清理 tmp、phase cancelled
```

- 每项目同时只允许一个深度 job（轻量锁，仿 exportJobManager 单项目锁精神；同项目再点「开始」提示已有任务）。
- WebGPU 上下文在 worker 内常驻：第二次 job 复用已加载 session/模型，避免重复编译（session 缓存按 depthModel/poseModel 键）。
- 帧批量大小是 R17 关注点：抽帧 JPEG 单帧 ≤200KB、批 32 帧 → IPC 单次 ≤6.4MB；worker 输出 raw 批同理，均可用 transferable 零拷贝。

## 7. 模型资产（新增最小下载机制，收敛在本节点）

| 资产 | 来源（白名单 URL）| 大小(约) | 用途 |
|---|---|---|---|
| `depth_small_fp16.onnx` | hf-mirror onnx-community/depth-anything-v2-small | 49.6 MB | 深度 small（spike 已验证）|
| `depth_base_fp16.onnx` | 同上 Base 仓库 | ~190 MB | 深度 base |
| `pose_landmarker_full.task` | @mediapipe/tasks-vision 发布物 | ~8 MB | Pose Full（**v1 唯一档**）|
| mediapipe wasm/js | @mediapipe/tasks-vision npm（本地打包/伺服，不走下载）| — | 运行时 |

> v1 只下载 `depth_small` / `depth_base` / `pose_full` 三件；不实现、不下载 pose lite/heavy（`pose_landmarker_lite/heavy.task` 不入清单）。清单结构保留按需扩展。

- 下载落地：`app.getPath('userData')/models/`；manifest（`models.json`）记录 file+sha256；下载用流式写临时文件 + 完成后校验 sha256 + rename（防中断半文件）。
- `mode:'depth'` 且 `depthModel:'small'`：只下 49.6MB 即可跑通；pose 模型仅在骨架类模式需要。
- 首次触发时机：点「开始处理」时主进程检查，缺则自动下载（UI 阶段 `download-model` 显示模型名与百分比；可取消）。也可在 body 里给"预下载模型"按钮（可选，v1 不做，交给 run 时）。

## 8. 实现任务与里程碑

### Task 1：共享契约与参数模型（红测先行）
**Files:** `electron/shared/canvas/videoDepth.ts`（新建）、`videoDepthModels.ts`（新建）、`src/workbench/generationCanvas/videoDepth/videoDepthSettings.ts`（新建）
**Interfaces:** `parseVideoDepthSettings(input)`（缺省回填/未知值拒绝）、`deriveProcessingPlan(settings, srcVideoMeta)`（裁剪窗口→帧列表/输出宽高/总帧数/预计耗时）
- [ ] 红测：参数合法值、越界拒绝、`maxResolution`/`fps`/`trim` 派生正确、模式与模型需求矩阵（depth 不需 pose；depth_skeleton / original_skeleton 需 pose；`skeleton_black` 与未知 mode 拒绝）
- [ ] 实现契约与派生；跑 focused tests 确认绿
- [ ] Commit `feat: define video depth node contract`；push task 分支

### Task 2：注册节点 kind 与 i18n
**Files:** `nodes/registry.ts`（+`video_depth_process` 条目，不设 executionKind/agentCreatable，defaultSize 320x420 类）、`model/generationNodeKinds.ts`、`model/generationCanvasTypes.ts:34`、`src/i18n/locales/runtime.ts`（zh+en 三键 + 阶段/错误文案）、renderRegistry 图标、`canvasSnapshotNormalizer.ts`（若有 kind 白名单）
- [ ] 红测：kind 可创建/持久化/重启恢复；非生成 kind 不进 provider/agent 路径
- [ ] 注册 + 类型派生绿；`check:vocabularies`（新增语义词表）等门岗
- [ ] Commit `feat: register video depth process node kind`

### Task 3：渲染层深度渲染工具（灰度/方向/平滑）
**Files:** `videoDepth/depthRenderUtils.ts`
**Interfaces:** `depthToGray(depthRaw, direction): Uint8`（grayscale，nearWhite 翻转）、`smoothDepth(stream, alpha)`（EMA 单帧缓冲滑窗）、`(v1 不做 inferno/viridis LUT)`
- [ ] 红测：grayscale 输出、近白/近黑方向、EMA 平滑滑窗边界与首帧处理
- [ ] 实现；无 LUT 大常量，`check:heavy-path` 干净
- [ ] Commit `feat: depth render utilities`

### Task 4：骨架绘制工具（固定样式，无 glow）
**Files:** `videoDepth/skeletonRenderUtils.ts`（PoseLandmarker 33 点拓扑与绘制）
**Interfaces:** `renderPoseOverlay(ctx, landmarks, opts)`，opts 内部固定 `{lineWidth:3, jointRadius:5, confidence:0.35}`（UI 不暴露；glow 恒 false）
- [ ] 红测：拓扑连线完整、置信度过滤、多人多实例分组
- [ ] 实现
- [ ] Commit `feat: skeleton overlay renderer`

### Task 5：推理 Worker（onnxruntime-web + MediaPipe）
**Files:** `videoDepth/videoDepthWorker.ts`、`src/vite.config.ts`（worker wasm/onnx 打包规则，若需）
**Interfaces:** 沿用 removeBackground worker 协议：`{id, kind:'warm'|'processBatch'|'cancel', ...}` → `{id, kind:'progress'|'result'|'error'|'ready'}`；`processBatch(settings, frameJpegs, batchIndex)` → `{rawFrames, poseJson?, progress}`；session 缓存按模型键
- [ ] 红测：worker 协议状态机、批处理输入输出、错误与取消检查点
- [ ] 实现 warm（DA2 加载 + shader 预热 + MediaPipe Pose **Full 档**加载）/processBatch/串行队列；验证 `mode:'depth'` 不加载 pose
- [ ] Electron 冒烟：用 spike 的 96 帧 JPEG 目录喂 worker，输出与 spike 逐帧对拍（像素差阈值）
- [ ] Commit `feat: video depth inference worker`

### Task 6：主进程 job 与 IPC
**Files:** `electron/video/depthVideoJob.ts`（新建）、`electron/video/depthVideoIpc.ts`（新建）、`preload.ts`/`src/desktop/bridge*.ts`（videoDepth ns）、`main.ts` 注册、`NodeGeneratingOverlay` 阶段文案（下载模型/预热）
**Interfaces:** `videoDepth.start({projectId,nodeId,settings,sourceVideoRef})`、`videoDepth.cancel(jobId)`、事件 `videoDepth:progress/phase`；job 内部复用 `resolveVideoLocalPath`、ffmpeg、`writeAsset`
- [ ] 红测：trusted-sender 守卫、并发锁、取消清理、失败 retryable 分类、模型下载 sha256 校验
- [ ] 实现 job 时序（§6）与 IPC
- [ ] Commit `feat: video depth main-process job`

### Task 7：节点 UI 与编排客户端
**Files:** `nodes/VideoDepthNodeBody.tsx`（新建）、body 分支接入（`NodeCardBody.tsx:26-33` 或 `BaseGenerationNode.tsx:537`）、`videoDepth/videoDepthClient.ts`（新建）、quickAdd 自动收录验证
**UI 内容：** 源视频选择下拉（读画布上 video/asset 素材节点）、mode 三选（depth / depth_skeleton / original_skeleton）、深度模型档（small/base）、分辨率（512/768/1024/original）、帧率、深度方向、时间平滑、多人上限（1–4）、pose JSON 开关、时间裁剪起止（配合源时长显示）、开始/取消、下载模型阶段条、处理进度条。（v1 不暴露：色彩映射、骨架样式/glow）
- [ ] 红测：meta 编辑走 undo、重启恢复设置；client 进度→`setNodeProgress`、完成→`addNodeResult`
- [ ] 实现 UI + 编排客户端；i18n-only；只读 store
- [ ] Commit `feat: video depth node UI and orchestration`

### Task 8：设计实验室 6 态 + 真实用户任务 + 产品闭环验收（R16/完整测试系统）
**Files:** `src/devlab/designLab/videoDepthStates.tsx`、`src/devlab/designLab.tsx` 注册、`tests/ux/design-lab/labStates.mjs`（登记 6 态）、`tests/ux/design-lab/design-lab.visual.spec.mjs`（进 `__baselines__`）、`tests/ux/video-depth-journey.walk.mjs`（真实 Electron 旅程，沿 `_launchApp.mjs`/walk 惯例）、闭环相关接线测试（`runner/generationReferenceResolver` 附近，若验收暴露缺口）
- [ ] 注册并走查状态：`video-depth-empty`（未选源）→ `video-depth-param`（已选源/调参）→ `video-depth-downloading`（模型下载阶段）→ `video-depth-running`（批处理进度）→ `video-depth-done`（产物预览 + 下载 poses.json）→ `video-depth-failed`（错误 + 重试）
- [ ] 设计实验室：6 态真实组件夹具、截图入 `__baselines__`、人眼对账（R13）；无静态 HTML 代替生产验收
- [ ] R16 真实任务 walk（Electron）：拿一条真实人物/舞蹈 mp4 → 选源 → **三种 mode 各跑一次**（depth / depth_skeleton / original_skeleton，small、768px、4s）→ 确认 mp4 资产 + optional poses.json 落地、播放器可预览、进度诚实、取消可用、**重启项目设置与结果仍在**、**撤销可用**
- [ ] 三种模式的产物帧截图人眼对照 depth.cards 行为（深度近白、骨架拓扑、原+骨架）；确认无黑底骨架/无 inferno 等 v1 外 UI 泄漏
- [ ] **产品闭环验收**：深度节点产物（如 depth_skeleton 视频资产）经 reference 边连线到带 `video_ref` 槽的生成模型（Seedance 2.0/2.5 等）→ 真实生成一条"新角色演绎原动作"短片 → 人眼确认动作结构保持、无原视频身份/背景残留。若档案/解析器有 `video_ref` 缺口，修共享边界并补该模型契约测试
- [ ] 修复走查与真实使用中发现的所有问题
- [ ] Commit `test: certify video depth node design-lab + real user journey + video_ref loop`

### Task 9：合线验收与交付
- [ ] `git fetch origin main`；rebase/merge 最新 origin/main（不重写远端历史）
- [ ] `pnpm run gates` 全绿；核查 filesize/tokens/i18n/vocab/heavy-path/boundaries/contracts/test-waits
- [ ] `git diff origin/main...HEAD --stat` 与 branch/commit/tree 身份核对；主 worktree 无改动
- [ ] push `codex/plan-video-depth-canvas-node-20260906`（不开 PR 不合并不 merge）

## 9. R3：仍开放的小取舍

已拍板不再开放：模式范围（v1 三模式，skeleton_black 砍）、色彩映射（只 grayscale）、pose 档位（只 full）、骨架精调 UI（固定值）、pose.json（归一化坐标 + 附 resolution 元数据）、时间裁剪与默认分辨率（768）。

| 取舍 | 方案 A（推荐）| 方案 B | 用户看到的差异 | 代价/风险 | 关闭门槛 |
|---|---|---|---|---|---|
| 骨架在原始分辨率 vs 处理分辨率绘制 | 全部按处理分辨率（maxResolution）统一绘制与输出 | 骨架按源分辨率绘制再缩放输出 | A 实现简单且与 depth 管线一致；B 线条更细但需坐标两套 | A 放大时线条略粗 | 设计实验室放大截图人眼对账后定 |
| 时间平滑语义 | 深度帧间 EMA 滑窗（depth.cards 语义，内存只留 1 帧缓冲）| 双向往复平滑（更好但需整段缓冲 + 二次 pass）| A 内存低、单 pass；B 更稳但需整段帧缓冲 | 长视频内存 | 用 30s@768px 实测内存后定 |

默认按 A 执行；实现时如遇反证再回本表。

## 10. 回滚与故障边界

- **代码回滚**：新 kind 提交回滚时，若已存在新快照，加载器拒绝未知 kind（现有 schema 行为）并保留原项目备份；不把新节点当普通图片节点。
- **数据回滚**：meta 参数全部走现有 undo/快照；回滚不残留半设置。
- **运行回滚**：取消只停未完成批次；临时 raw/帧目录随 job 清理；已 writeAsset 的产物以画布节点删除为准，job 失败不自动删历史成功产物。
- **模型下载故障**：sha256 校验失败视为下载失败（删半文件可重试）；下载中断重试续传不做（v1 全量重下，白名单 URL 内完成）。
- **体验边界**：下载/预热/处理/编码各阶段显式显示；`mode` 需要未下载模型时先走下载阶段；失败卡给重试路径，不用成功态掩盖。

## 11. 验收门总表

- [ ] **范围门**：三模式（depth / depth_skeleton / original_skeleton）+ pose 导出 + 时间裁剪 + 参数都在 `video_depth_process` 一个 kind 内；无并行第二入口；**v1 外功能（skeleton_black / inferno / viridis / glow / pose lite&heavy）不出现于 UI 与解析取值**（schema 外取值拒绝）。
- [ ] **数据门**：settings 可序列化、撤销、重启恢复；result 资产与 poses.json 落项目素材；progress 不进 undo。
- [ ] **本地门**：无 provider 调用、不花额度；模型下载白名单 + sha256；素材不上传。
- [ ] **Worker 门**：批处理协议有 contract 测试；与 spike 产物逐帧像素差在阈值内；`mode:'depth'` 不加载 pose 模型。
- [ ] **Electron 门**：trusted-sender、并发锁、取消清理、retryable 错误分类有测试。
- [ ] **闭环门（产品价值）**：深度产物视频资产经 reference 边被带 `video_ref` 槽的生成模型当参考视频消费；"真人视频 → 深度 → 新角色演绎"真实生成成功；无身份/背景残留。
- [ ] **R16 真实用户任务**：真实人物 mp4 → 三模式出片 + poses.json；截图人眼走查（深度 / 深度+骨架 / 原+骨架三态）；发现的问题全部修复后才算完成。
- [ ] **质量门**：`pnpm run gates` 全绿；`check:docs-index`/`check:doc-status` 无 warning；filesize/tokens/heavy-path/boundaries/vocabularies/i18n/contracts 通过。

## 附：Spike 关键证据引用
- 端到端管线与数据：`outputs/spike-depth/SPIKE_REPORT.md`（96 帧 720p、avg 533ms、webgpu EP 成功）
- 模型文件：`onnx-community/depth-anything-v2-small` `onnx/model_fp16.onnx`（49.6MB，动态输入 `[B,3,H,W]`、输出 14 取整）
- spike 源码：`/tmp/nomi-depth-spike/app/{main.js,index.html}`（可作 worker/client 起点，但按 R9 重写不进仓库）
