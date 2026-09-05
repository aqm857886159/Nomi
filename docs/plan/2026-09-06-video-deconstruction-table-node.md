# 视频拆解表节点重做实施计划

> 日期：2026-09-06 · 状态：⏳ 已拍板·未开工 · 仅施工计划，不含生产代码

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把视频拆解结果从右侧 Portal 面板和默认铺图，重做成一个自持于画布 Zustand store 的「视频拆解表」画布节点；用户只选择要用的行，生成物才逐个落到画布并自动编组，Agent 只投影同一份数据。

**Architecture:** 视频拆解表是 `GenerationCanvasNode` 的新节点类型，表节点的行、关键帧、来源视频引用、选中状态和生成关联都进入画布文档快照；Zustand 画布 store 是业务与持久化真相源，React Flow 只负责交互投影。拆解分析是可撤销的本地/外部分析写入，选行生成单独经过现有 `nomi_operation_*` / `ProductionRun` 生产链，结果通过 canvas landing 渐进出现并打组；Agent 面板读取同一节点投影并提供「在画布中查看」。

**Tech Stack:** Electron + React 18 + Zustand/Immer + React Flow + Vercel AI SDK + MCP capability catalog + `ProductionRunService`。

**Spec:** 用户已拍板的来源见 `/Users/aoqimin/Desktop/Nomi/.claude/worktrees/gpt-discussion-review-06eb91/docs/plan/2026-09-05-gpt-discussion-consolidation.md` §1 V 族、§3；统一 Agent/画布母表见 `/Users/aoqimin/.codex/worktrees/nomi-unified-agent-canvas-plan-20260905/docs/plan/2026-09-05-nomi-unified-agent-canvas-skill-collection.md`；阶段执行输入见 `/Users/aoqimin/.codex/worktrees/nomi-unified-agent-canvas-plan-20260905/docs/research/2026-09-05-nomi-unified-agent-canvas-skill-solution/execution-plan.md` §5。

## Global Constraints

- 本计划执行分支：`codex/plan-video-deconstruction-table-node-20260906`；实现时必须从最新 `origin/main` 建独立 worktree。
- P1：新视频拆解表节点与旧右槽 Portal 面板、旧铺图函数同一提交删除；不保留 fallback、并行入口或第二份结果视图。
- P2：若实现阶段发现旧状态兼容问题，修复画布快照/迁移的共享边界，不在渲染层加临时判断。
- P3/R13/R16：CI 绿只是必要条件；必须用真实视频链接或本地 mp4 完成真实用户任务，并以截图做人眼走查。
- P4/R23：模型身份和供应商无关；生产画布只有 React Flow 一个交互内核，Zustand 画布文档是唯一业务/持久化真相源。
- R4/R9：实现前保持本计划；每个职责一个文件，生产文件和测试文件均 ≤800 行；超过时先抽边界再继续。
- R15：所有新增用户可见文字走 `zh-CN`/`en` i18n；设计实验室状态 id 与 i18n key 一一对应。
- R17/R22：新增重活写入 `check:heavy-path`/contracts 覆盖；按画布、Electron、MCP、ProductionRun 和真实旅程分层验证。
- V-08：字幕/转写提取走 Agent Skill，不增加字幕节点，也不把字幕状态塞进拆解表生成节点。

## 1. D6：先解决真实摩擦，再锁定权衡

用户看到「右边一个图、左边一堆图」会崩：右槽面板把结果藏在画布边缘，选几行后却把关键帧和图片节点铺满整个画布，源视频、分析依据和生成物的关系被空间噪音打散。真实需求是「我先读懂这条片，再只拿其中三镜继续做」，不是「再打开一块面板」或「把每一帧都变成卡片」。

因此固定采用 D-2 = A：拆解表本身是一种画布节点；表数据、行内关键帧和选中状态跟项目走，可撤销、可重启恢复。生成物只在用户选行后出现，逐个出现并落在表节点右侧的结果组里。Agent 面板只做任务卡、状态和「在画布中查看」链接，不能拥有第二份表数据。

真正仍需小范围取舍的是两个实现细节：关键帧缩略图保存为项目资产引用还是直接保存 URL，以及表节点的最大行数/分页策略。它们影响项目体积和长表可读性，不改变「表是节点」的产品方向，放在 §9 的 R3 表中由实现前的小门槛拍定。

## 2. 固定决策与边界

### 2.1 固定决策

- 一个视频拆解结果对应一个 `video_deconstruction_table` 画布节点；节点 id 是 Agent、生成任务、结果回链的稳定键。
- 数据在 `useGenerationCanvasStore` 的画布文档状态中；写入走已有 canvas write boundary、undo journal 和项目快照，不另造 `videoDeconstructionStore`。
- 行内关键帧只作为行的证据缩略图，不自动创建关键帧/图片节点。
- 选中行才允许生成；生成按钮的批次快照记录 `tableNodeId + rowIds + tableRevision`，之后用户改表不会悄悄改变已提交批次。
- 生成物逐个落画布、按这次批次自动成组、带来源边/来源元数据；整批生成仍是一个可撤销单元，符合 `batch-output-appears-progressively-and-grouped`。
- 创作区「分镜计划」和画布「视频拆解表」是两个对象。阶段二只做一个动作：把选定行拷贝为一次性分镜计划草稿；不做双向同步、不把两张表合成一个语义。
- V-08 字幕提取由 Agent Skill 完成；表中可显示拆解引擎已有的 `onScreenText`/`dialogue` 证据，但不创建字幕节点。

### 2.2 不动项

- 不保留 `NodeDeconstructionPanel` 右槽 Portal 作为结果界面，也不把它放大成终局 Agent 面板。
- 不保留 `extractDeconstructionShotsToNodes` 的逐镜抽帧铺图路径；新生成链直接使用 ProductionRun/统一 canvas landing。
- 不把关键帧默认落成一堆图片节点，不增加独立拆解页或第二个 timeline store。
- 不引入独立 `VideoDeconstructionSession`、独立持久化文件或以 Agent transcript 作为事实源。
- 不把 `nomi_canvas_plan` 重新作为新工具入口；MCP 只走当前 canonical catalog 中的 `nomi_read`、`nomi_canvas_edit`、`nomi_operation_*` 和 `nomi_run_*`。
- 不在本计划分支写生产代码、样张或新模型接入；本文件是施工输入。

## 3. 现状证据与 P1 删除清单

当前 main 的真实实现已核对：

| 现役实现 | 证据 | 结论 |
|---|---|---|
| 右槽 Portal 面板 | [`src/workbench/generationCanvas/nodes/NodeDeconstructionPanel.tsx:1-438`](../../src/workbench/generationCanvas/nodes/NodeDeconstructionPanel.tsx)；头部说明 Portal 到画布右槽，渲染入口在 `:220-316` | 新节点上线的同一提交删除组件、宿主 `DeconstructionPanelHost`、右槽状态和相关互斥/角标投影；不留第二结果面。 |
| 铺图函数 | [`src/workbench/generationCanvas/nodes/extractDeconstructionShotsToNodes.ts:1-147`](../../src/workbench/generationCanvas/nodes/extractDeconstructionShotsToNodes.ts)；`addNode` 在 `:102-116`，自动编组在 `:127-140` | 同一提交删除；其进度、抽帧、旧 `videoAnalysis` 写入和组逻辑由新的批次 landing/生产链承担。 |
| 旧状态槽 | `generationCanvasStore.ts:49-123`、`canvasStoreTypes.ts:138-166`；结果按源视频 nodeId 进入 `videoDeconstructions`，并以 `videoDeconstructionOpenNodeId` 占右槽 | 用表节点 id + `meta.videoDeconstructionTable` 收敛；不保留 `videoDeconstructions` 作为第二真相源。 |
| 旧类型 | `deconstructionTypes.ts:7-70` | 将引擎返回 DTO 与画布表节点领域模型分开；旧 DTO 只保留为受边界验证的输入投影，不再驱动右槽 UI。 |

旧项目迁移只做一次性数据迁移：若视频节点 `meta.videoDeconstruction` 有完整历史结果，项目加载时创建对应的表节点并写入 `legacySource: 'video-node-meta'`；迁移完成后渲染只认新节点类型，旧 Portal 和旧铺图函数不复活。迁移和新节点写入同一份快照/undo 语义，不能静默覆盖用户后来修改的表。

## 4. 目标数据与节点 schema

### 4.1 节点外壳

```ts
type VideoDeconstructionTableNode = GenerationCanvasNode & {
  kind: 'video_deconstruction_table'
  meta: {
    videoDeconstructionTable: VideoDeconstructionTableDocument
  }
}

type VideoDeconstructionTableDocument = {
  schemaVersion: 1
  tableNodeId: string
  status: 'idle' | 'deconstructing' | 'ready' | 'selected' | 'generating' | 'failed'
  tableRevision: number
  sourceVideo: VideoSourceReference
  columns: VideoDeconstructionColumn[]
  rows: VideoDeconstructionRow[]
  selectedRowIds: string[]
  generationBatches: VideoDeconstructionGenerationBatch[]
  error?: DeconstructionError
  legacySource?: 'video-node-meta'
  updatedAt: string
}
```

`status` 是设计实验室和 Agent 任务卡的投影词表；`selected` 由 `selectedRowIds.length > 0` 且没有生成批次正在运行时派生，避免 store 出现「状态字段和选择数组互相打架」。`selectedRowIds` 仍写进画布文档，重启后用户能看到上次要用的行；画布的 `selectedNodeIds` 仍是 React Flow 会话选区，不与行选择混用。

### 4.2 来源视频引用

```ts
type VideoSourceReference = {
  sourceNodeId: string
  sourceAssetRef?: string
  sourceUrl: string
  title: string
  durationSeconds?: number
  contentHash?: string
  sourceKind: 'canvas-video-node' | 'local-mp4' | 'url'
}
```

`sourceNodeId` 是同项目内稳定关联；`sourceAssetRef` 优先于公网 URL 作为重启/生成引用；`sourceUrl` 只作为当前引擎和缺失资产时的边界字段，必须经过项目/协议校验，不能把用户 API key 或临时凭据写入节点。

### 4.3 行和行内关键帧

```ts
type VideoDeconstructionRow = {
  rowId: string
  order: number
  startSeconds: number
  endSeconds: number
  durationSeconds: number
  shotSize: string
  mood: string
  visual: string
  onScreenText: string
  dialogue: string
  carriedOver: boolean
  imagePrompt: string
  motionPrompt: string
  custom: Record<string, string>
  keyframes: VideoDeconstructionKeyframe[]
  selected: boolean
  generation: {
    status: 'idle' | 'queued' | 'running' | 'ready' | 'failed'
    runId?: string
    outputNodeIds?: string[]
    errorCode?: string
    errorMessage?: string
  }
}

type VideoDeconstructionKeyframe = {
  keyframeId: string
  timeSeconds: number
  role: 'start' | 'middle' | 'end' | 'custom'
  frameRef: string
  thumbnailRef?: string
  width?: number
  height?: number
}
```

字段来自 `electron/video/deconstructVideo.ts` 的 `DeconstructShot` 投影；`visionFailed` 进入行级错误/证据标记，不能被转成成功；`selected` 与 `selectedRowIds` 双写时由 reducer 同步校验，任何不一致以 `selectedRowIds` 重建派生视图。关键帧不进入顶层节点数组，所以「一行一镜」在数据和视觉上都成立。

### 4.4 表列、选择和批次

```ts
type VideoDeconstructionColumn = {
  columnId: string
  label: string
  source: 'builtin' | 'custom'
  aiFill: boolean
  visible: boolean
  promptHint?: string
}

type VideoDeconstructionGenerationBatch = {
  batchId: string
  tableNodeId: string
  rowIds: string[]
  tableRevision: number
  runId?: string
  groupId?: string
  status: 'planned' | 'running' | 'completed' | 'failed' | 'cancelled'
  createdAt: string
  completedAt?: string
}
```

内置列可隐藏但不可删除；自定义列的列名和 `promptHint` 进入拆解 Skill/视觉模型的结构化输出 schema。每次生成记录行快照和表 revision，防止用户在生成中编辑同一行后出现来源不明。

## 5. 分层与文件拆分（每文件 ≤800 行）

| 层 | 计划落点 | 单一职责 |
|---|---|---|
| 领域类型/校验 | `src/workbench/generationCanvas/deconstruction/VideoDeconstructionTableTypes.ts`、`VideoDeconstructionTableSchema.ts` | schema、状态词表、行/关键帧/来源引用解析与迁移输入校验。 |
| 画布 store slice | `src/workbench/generationCanvas/store/canvasDeconstructionTableActions.ts` | 创建表、写入结果、编辑行/列、选择行、建立批次、撤销边界；通过现有 canvas write boundary 接入 `generationCanvasStore`。 |
| 节点投影 | `src/workbench/generationCanvas/nodes/VideoDeconstructionTableNode.tsx`、`VideoDeconstructionTableRow.tsx`、`VideoDeconstructionTableStates.tsx` | React Flow 节点外壳、表格/行、六种实验室状态；不调用主进程、不自持业务状态。 |
| 画布持久化/迁移 | `src/workbench/generationCanvas/store/canvasSnapshotNormalizer.ts`、项目 session persistence 就近模块、`VideoDeconstructionTableMigration.ts` | 新 kind 白名单、旧 video meta 一次性迁移、重启归一化；不保留旧面板分支。 |
| 分析桥 | `src/workbench/generationCanvas/deconstruction/videoDeconstructionBridge.ts`、`electron/video/deconstructVideo.ts` 现有 bridge | 输入 source reference + column schema，输出经过 schema 校验的 rows；失败和逐行失败都结构化。 |
| 生成编排 | `src/workbench/generationCanvas/deconstruction/deconstructionGeneration.ts`、`electron/productionRun/deconstructionGeneration.ts` | 选行批次快照、ProductionRun plan、来源元数据、渐进 landing；不直接调 provider。 |
| Agent/MCP 适配 | `src/workbench/generationCanvas/agent/videoDeconstructionCanvasAdapter.ts`、`electron/capabilityCore/mcpToolCatalog.ts`、`electron/shared/agentCapabilities/canvasWrite.ts` | canonical `nomi_*` schema、租约/确认/回执、画布读写投影；不另造 transcript store。 |
| Agent 结果卡 | `src/workbench/agent/VideoDeconstructionTaskCard.tsx`（沿现有 Agent result card 目录） | 只读同一表节点，展示任务/失败/进度，按钮只发「在画布中查看」深链。 |
| 测试 | 各层就近 `*.test.ts(x)` + `tests/ux/` 真实旅程 | 领域/持久化/MCP/ProductionRun/真实 Electron 逐层验证；不以 store injection 代替真实任务。 |

旧 `NodeDeconstructionPanel.tsx`、`DeconstructionPanelHost.tsx`、`DeconstructionShotRow.tsx`、`extractDeconstructionShotsToNodes.ts` 和 `videoDeconstructionOpenNodeId/videoDeconstructions` 互斥状态必须在新节点的同一提交删除或完全迁移；删除后 `rg` 不得再出现旧右槽入口。所有新增实现文件保持职责单一，任何接近 800 行的节点壳必须拆成 states/row/toolbar 子模块。

## 6. `nomi_*` MCP 与 Agent 接口

不新增第二条 Agent runtime。所有调用都先通过当前 MCP catalog 的租约、项目绑定和确认策略，再写入画布或 ProductionRun。

### 6.1 读表和查看

- `nomi_read`，`target: 'canvas'`：继续走 canonical canvas read adapter；返回 `video_deconstruction_table` 节点的 compact projection：`tableNodeId`、来源视频摘要、`tableRevision`、状态、列、行 id/时间/关键帧摘要、`selectedRowIds`、批次和结果 node id。默认不把每个缩略图二进制塞入 MCP payload；需要查看时使用 `frameRef`/受控预览引用。
- Agent 任务卡拿到 `tableNodeId` 后只发 `canvas.view`/现有安全深链到画布，不复制 rows。刷新后的节点投影仍从 Zustand 画布快照读取。

### 6.2 可逆表写入

扩展 canonical `nomi_canvas_edit` 的 operation 枚举，不复活 `nomi_canvas_plan`：

```text
create_video_deconstruction_table
  { sourceVideoRef, columns, rows, position?, summary }
patch_video_deconstruction_table
  { tableNodeId, expectedTableRevision, rowPatches?, columnPatches?, selectedRowIds? }
```

两者都是 `reversible_local`：必须带 project lease、期望 revision 和明确字段；返回 `{ tableNodeId, tableRevision, changedRowIds, selectedRowIds, undoToken, receipt }`。`create` 只由视频拆解 Skill/节点入口调用，`patch` 是 Agent 对同一表的局部修订；未知 row/column、revision 过期、来源视频不属于项目时 fail-closed。选中行不是 Agent 自己生成的第二选择状态，必须写入表节点的 `selectedRowIds`。

### 6.3 选行生成的工具链

- Agent 先 `nomi_read(target=canvas)` 读取表 revision 和 `selectedRowIds`；若用户在对话中明确选行，先用 `patch_video_deconstruction_table` 写选择，再让用户看到任务卡。
- 生成计划走 `nomi_operation_plan` 的 `shots[]`，每个 shot candidate 带 `metadata: { sourceKind: 'video_deconstruction_table', tableNodeId, rowId, sourceVideoRef, keyframeRefs }`。计划只是草稿，不调用 provider、不花额度。
- `nomi_operation_preview` 展示模型/模式/参数/参考和价格；`nomi_operation_gate` request/decide 走现有真人确认与收据；`nomi_operation_execute` 只在收据有效后提交。单镜生成仍复用这条 canonical single-shot seam。
- 多行、可暂停、可重启的批次使用 `nomi_run_start` 建 ProductionRun，再由 `nomi_read(target=run|run_events)` 读任务卡，`nomi_run_gate` 处理创意门/物化，`nomi_run_control` pause/resume/cancel。任何预算门、付费生成和导出门仍由 Nomi 控制。
- `nomi_canvas_maintenance` 只处理删除/撤销等 destructive 操作，不能绕过生成收据；`nomi_artifact_review` 只用于分镜计划 artifact，不把表节点冒充 storyboard artifact。

### 6.4 Agent 面板投影

Agent 面板任务卡只持有 `{ tableNodeId, batchId?, runId?, status, summary, errorCode? }`，进度由 `nomi_read(target=run_events)` 或统一 Host 事件映射；「在画布中查看」定位同一个 `tableNodeId` 和生成组。卡片关闭不会关闭分析或生成任务，重开项目后从 canvas snapshot + ProductionRun projection 重建。

## 7. `ProductionRun` 接口与生成落画布

`ProductionRun` 是付费生成、进度、恢复、审计的唯一 durable owner；表节点只记录来源和结果关联。

### 7.1 输入与身份

在 `ProductionGenerationShot` 上增加可选、结构化的来源字段（而不是把来源散落在 prompt 字符串）：

```ts
type DeconstructionGenerationSource = {
  tableNodeId: string
  rowId: string
  tableRevision: number
  sourceVideo: VideoSourceReference
  keyframeRefs: string[]
}

// ProductionGenerationShot 增加：
source?: { kind: 'video_deconstruction_table'; deconstruction: DeconstructionGenerationSource }
```

`createGenerationDraft({ projectId, operationId, candidate, shots })` 接收选中行快照；每个 shot 的 `candidate` 从该行的 `imagePrompt`/`motionPrompt` 和模型档案编译，`included: true`，`role: 'shot'`。服务端校验 table revision/source project，拒绝重复 row id、空选择和跨项目 source ref。

### 7.2 批次和门

- plan draft 生成后，服务端按现有 `productionRunService`/repository revision 写入 Run；不在 renderer 里另建“生成中”状态机。
- 预算/付费门沿用 `budget_envelope` 和 approval receipt；`anchor_checkpoint` 语义只在确有锚镜时出现，拆解表三行生成默认不添加锚门。
- `RunEvent` 的 `stageId/jobId/artifactId/payload` 带 `tableNodeId/rowId/batchId`，Host 可把每一行映射为任务卡，不用猜 prompt。
- 失败时保留之前成功的结果，行进入 `generation.status='failed'` 并保存 `errorCode/errorMessage`；重试产生新 attempt，不能覆盖旧结果或清掉其它行的批准。

### 7.3 渐进 landing 与撤销

`electron/productionRun/multiShotCanvasLanding.ts` 的现有落画布边界扩展为 `landDeconstructionBatchForRun(run, source)`：

1. 每个 job 进入 ready/adopted 后创建一个结果节点，节点 meta 写 `sourceTableNodeId`、`sourceRowId`、`runId`、`batchId`、`attempt` 和 prompt/model provenance。
2. 节点按表节点右侧的确定性位置逐个写入 React Flow/Zustand；每次写入发 progress 事件，用户能看见结果逐个出现。
3. 批次首个成功结果创建 group，后续结果进入同组；组写 `materializationOperationId=batchId`，崩溃恢复/重试不得重复建组。
4. 全批完成后一次更新表节点的 `generation.outputNodeIds/groupId/status`，并保留单一 undo barrier；撤销以画布事实为准，若用户已删除节点，恢复流程不复活它。

## 8. 实现任务与里程碑

### Task 1：先写领域合同和红测，再迁移旧快照

**Files:**
- Create: `src/workbench/generationCanvas/deconstruction/VideoDeconstructionTableTypes.ts`
- Create: `src/workbench/generationCanvas/deconstruction/VideoDeconstructionTableSchema.ts`
- Create: `src/workbench/generationCanvas/deconstruction/VideoDeconstructionTableMigration.ts`
- Modify: `src/workbench/generationCanvas/model/generationNodeKinds.ts`, `generationCanvasSchema.ts`, `generationCanvasTypes.ts`
- Modify: `src/workbench/generationCanvas/store/canvasSnapshotNormalizer.ts`, project persistence/session loader
- Test: schema/migration/normalizer tests

**Interfaces:**
- Produces `VideoDeconstructionTableDocument`, `VideoDeconstructionRow`, `VideoDeconstructionKeyframe`, `VideoSourceReference` and `parseVideoDeconstructionTableDocument(input)`.
- Consumes the existing `DeconstructVideoResult` projection and legacy `node.meta.videoDeconstruction` only at the migration boundary.

- [ ] Write failing tests for valid rows, invalid time ranges, duplicate row ids, selected row consistency, old video-node meta migration, unknown kind rejection, and restart convergence.
- [ ] Run the focused schema/normalizer tests and record the expected failures before implementation.
- [ ] Implement the closed node kind, schema parser, migration and snapshot normalization; keep all persisted fields JSON-safe and avoid base64 media.
- [ ] Rerun focused tests and verify old snapshots become one table node without restoring the Portal path.
- [ ] Commit milestone `feat: define video deconstruction table node contract`; push the task branch.

### Task 2：把表做成唯一画布节点并删掉旧右槽/铺图

**Files:**
- Create: `src/workbench/generationCanvas/store/canvasDeconstructionTableActions.ts`
- Create: `src/workbench/generationCanvas/nodes/VideoDeconstructionTableNode.tsx`
- Create: `src/workbench/generationCanvas/nodes/VideoDeconstructionTableRow.tsx`
- Create: `src/workbench/generationCanvas/nodes/VideoDeconstructionTableStates.tsx`
- Modify: canvas store/types/write boundary/React Flow renderer registry
- Delete in the same commit: `NodeDeconstructionPanel.tsx`, `DeconstructionPanelHost.tsx`, `DeconstructionShotRow.tsx`, `extractDeconstructionShotsToNodes.ts`
- Delete/replace: `videoDeconstructions`, `videoDeconstructionOpenNodeId` and related i18n/CollapsedAiChip branches
- Test: store undo/persistence and node renderer structure tests

**Interfaces:**
- `createVideoDeconstructionTable(input): { nodeId: string; tableRevision: number }`
- `patchVideoDeconstructionTable(nodeId, expectedRevision, patch): { tableRevision: number; undoToken: string }`
- `selectVideoDeconstructionRows(nodeId, rowIds): { tableRevision: number; selectedRowIds: string[] }`
- Node component reads only `GenerationCanvasNode` and store selectors; no Portal, `getCanvasViewport`, or direct desktop bridge.

- [ ] Add red tests proving table edits, selection, and undo change the document snapshot and survive restore.
- [ ] Add a renderer structure test proving no old Portal host/import or `extractDeconstructionShotsToNodes` reference remains.
- [ ] Implement the store slice through the existing canvas write boundary and React Flow node renderer; keep row editing keyboard accessible and i18n-only.
- [ ] Remove the old files and all dead right-slot/AI mutual exclusion state in the same commit; update only the new node’s registration and i18n keys.
- [ ] Run focused canvas tests, `check:filesize`, `check:tokens`, `check:i18n`, and `check:vocabularies`.
- [ ] Commit milestone `feat: make video deconstruction a canvas table node`; push the task branch.

### Task 3：接分析引擎、六态设计实验室和 Agent 任务卡

**Files:**
- Create: `src/workbench/generationCanvas/deconstruction/videoDeconstructionBridge.ts`
- Create: `src/workbench/agent/VideoDeconstructionTaskCard.tsx`
- Modify: desktop bridge types, existing `electron/video/deconstructVideo.ts` adapter only where contract validation is needed, Agent result-card registry and i18n
- Test: bridge contract, six-state design-lab fixture, task-card projection tests

**Interfaces:**
- `startVideoDeconstruction(source: VideoSourceReference, columns: VideoDeconstructionColumn[]): Promise<VideoDeconstructionResultEnvelope>`
- `VideoDeconstructionResultEnvelope = { sourceVideo; columns; rows; tableRevision; warnings[] }`
- Task card input `{ tableNodeId; status; selectedCount; rowCount; batchId?; runId?; errorCode? }`.

- [ ] Add red tests for source URL/local mp4 validation, result field projection, `visionFailed`/partial evidence, and no subtitle node creation.
- [ ] Register these exact design-lab state ids and fixture requirements:
  - `video-deconstruction-empty`: source video ready, no rows, one primary action「开始拆解」。
  - `video-deconstruction-deconstructing`: phase text/elapsed evidence, no fake percentage, safe background continuation.
  - `video-deconstruction-table-ready`: rows with inline keyframes, source reference, no selected row.
  - `video-deconstruction-selected-rows`: three selected rows, batch action and clear selected count.
  - `video-deconstruction-generating`: row-level queued/running/ready output states, progressive grouped results, Agent task card link.
  - `video-deconstruction-failed`: recoverable whole-run or row-level failure, exact error and retry path; previous successes remain.
- [ ] Implement the bridge and node state renderers; keep progress honest because the current engine returns a batch rather than true per-frame progress.
- [ ] Implement the Agent task card as a projection with「在画布中查看」only; do not duplicate table rows into Agent state.
- [ ] Run design-lab walk, bridge tests, and screenshot human review against the six states.
- [ ] Commit milestone `feat: connect deconstruction analysis and task projection`; push the task branch.

### Task 4：选行生成、ProductionRun 和渐进编组落画布

**Files:**
- Create: `electron/productionRun/deconstructionGeneration.ts`
- Create: `src/workbench/generationCanvas/deconstruction/deconstructionGeneration.ts`
- Modify: `electron/productionRun/productionRunTypes.ts`, `productionRunService.ts`, `multiShotCanvasLanding.ts`, production adapters and canvas landing tests
- Test: batch snapshot, revision conflict, progressive landing, group idempotency, retry/undo and restart recovery

**Interfaces:**
- `createDeconstructionGenerationDraft({ projectId, tableNodeId, rowIds, tableRevision, operationId }): Promise<ProductionRun>`
- `landDeconstructionBatchForRun(run, source): Promise<{ groupId: string | null; outputNodeIds: string[] }>`
- `DeconstructionGenerationSource` as defined in §7.1.

- [ ] Add red tests for empty selection rejection, stale table revision rejection, three-row snapshot, per-row source provenance, one group per batch, progressive output order, and Cmd/Ctrl+Z removing the batch without reviving deleted nodes.
- [ ] Implement the ProductionGenerationShot source envelope, service validation, event payload correlation, and existing approval/budget gates.
- [ ] Implement output landing through the single canvas store boundary; never call a provider from renderer code and never rebuild a second generation state machine.
- [ ] Test failure preservation, `RunEvent` progress, pause/resume/cancel, restart recovery and repeat execution idempotency.
- [ ] Commit milestone `feat: generate selected deconstruction rows through production runs`; push the task branch.

### Task 5：接 canonical MCP 面并完成真实用户任务

**Files:**
- Modify: `electron/shared/agentCapabilities/canvasWrite.ts`, `electron/capabilityCore/mcpToolCatalog.ts`, `dispatcher.ts`, `mcpToolResults.ts`, generation/production adapters
- Create: `src/workbench/generationCanvas/agent/videoDeconstructionCanvasAdapter.ts`
- Test: MCP catalog/schema/lease/receipt tests, Electron journey under `tests/ux/` or the repository’s focused journey harness

**Interfaces:**
- `nomi_read(target=canvas)` returns the compact table-node projection.
- `nomi_canvas_edit` supports `create_video_deconstruction_table` and `patch_video_deconstruction_table` with lease + expected revision.
- `nomi_operation_plan/preview/gate/execute` handles single-shot selected-row generation; `nomi_run_start/read/run_events/run_gate/run_control` handles durable multi-row runs.

- [ ] Add red tests for lease scope, project mismatch, stale revision, unknown operation, approval denial, no-spend preview, and output receipt containing `tableNodeId/rowId`.
- [ ] Implement catalog and adapter changes without reintroducing `nomi_canvas_plan` or a legacy thin route.
- [ ] Run the real R16 task in Electron: paste one real video URL or choose a local mp4 → start deconstruction → inspect the table → select exactly three rows → generate → see outputs appear progressively and grouped → press Cmd/Ctrl+Z → verify the batch is gone and the table remains.
- [ ] Capture screenshots for the six design-lab states and the real task; human-review table readability, source evidence, selected-row affordance, progressive grouping and Agent「在画布中查看」.
- [ ] Fix every issue found in that task before declaring the implementation complete.
- [ ] Commit milestone `test: certify deconstruction table real user journey`; push the task branch.

### Task 6：合线验证与交付

- [ ] `git fetch origin main` and rebase/merge the latest `origin/main` into the task branch without rewriting remote history.
- [ ] Run `pnpm run gates` once the branch contains the exact final tree; investigate and repair failures at their earliest shared boundary.
- [ ] Run focused canvas/MCP/ProductionRun/real-journey checks again if the main refresh changed affected files.
- [ ] Verify `git diff origin/main...HEAD --stat`, branch, commit and tree identities; confirm no main worktree file changed.
- [ ] Push the final branch head with `git push -u origin codex/plan-video-deconstruction-table-node-20260906`; do not open or merge a PR.

## 9. R3：仍开放的小取舍

| 取舍 | 方案 A（推荐） | 方案 B | 用户看到的差异 | 代价/风险 | 关闭门槛 |
|---|---|---|---|---|---|
| 关键帧缩略图怎么存 | 保存项目内 `assetRef`/受控预览引用，必要时按需生成缩略图；节点只存 ref、时间和尺寸 | 直接保存引擎返回的 URL | A 重启稳定、表快照小；B 初次接线快 | A 需要资产引用/预览接线；B 远端 URL 过期且可能把大数据/隐私带入快照 | 用本地 mp4 重启一次，确认 ref 可读；`check:heavy-path` 禁止 base64 入 store |
| 表节点最大行数与分页 | 先定 48 行硬上限 + 虚拟滚动，超过上限由拆解结果分段并保留总数；不在首版引入分页语义 | 无硬上限，超过视口即分页 | A 一眼能读完常见 15–30 秒片；B 长片可完整保留但需分页切换 | A 长片需要明确「已截取/继续拆」；B 选择跨页、撤销和 Agent payload 更复杂 | 用 60/120 行夹具测滚动、选行、MCP compact payload 和 Electron 内存；产品/设计在实现前定案 |

这张表只保留影响实现边界的微型取舍；D-2、表节点 owner、关键帧行内、选行才生成、Agent 投影和 V-08 归属均已拍板，不再作为开放选项。

## 10. 回滚与故障边界

- **代码回滚：** 回滚新节点提交时同时恢复旧文件和旧 store 字段；若已存在新快照，加载器按 `schemaVersion` 拒绝未知新节点并保留原始项目备份，不能把新表静默当普通图片节点。
- **数据迁移回滚：** 迁移前保留原视频节点 meta；迁移是可撤销的一次画布写入，失败时不删除源视频节点或历史 meta。
- **生成回滚：** 取消只阻止尚未提交的 job；已提交供应商任务按 ProductionRun 的真实状态展示，不能假装撤回或退费。撤销画布 landing 以节点删除事实为准，重启不复活已删除输出。
- **MCP 回滚：** 新 operation 通过 catalog feature/version gate 关闭时，已存在的表节点仍可由 UI 读写；禁止把 MCP 关闭解释成删除画布数据。
- **用户体验边界：** 分析失败和逐行失败都保留原始成功行、来源视频和已选状态；失败卡必须给出下一步，不用绿色成功态掩盖未验证结果。

## 11. 验收门总表

- [ ] **范围门：** 视频拆解表是唯一结果节点；旧右槽 Portal、旧 `extractDeconstructionShotsToNodes` 和互斥右槽状态同 commit 删除；没有第二份表状态。
- [ ] **数据门：** 行、关键帧、来源视频引用、选择状态、表 revision、生成批次、输出节点来源和失败信息均能序列化、恢复、撤销。
- [ ] **分镜边界门：** 「拆解表 → 分镜计划」只有一次性拷贝动作；无双向同步；字幕提取仍是 Agent Skill、无字幕节点。
- [ ] **MCP/Run 门：** canonical `nomi_*` 有租约、revision、审批/收据、事件和错误边界；ProductionRun 是付费/进度/恢复唯一 owner；Agent 任务卡只投影。
- [ ] **R16 真实用户任务：** 贴一个真实视频链接或本地 mp4 → 出表 → 选 3 行生成 → 撤销；真实 Electron 中看到表、三行选择、生成物逐个出现并编组、撤销后表仍在且输出消失；过程中发现的体验/设计/UI/功能问题全部修复。
- [ ] **设计实验室门：** `video-deconstruction-empty`、`deconstructing`、`table-ready`、`selected-rows`、`generating`、`failed` 六态有真实组件夹具、截图和人眼对账；无静态 HTML 代替生产验收。
- [ ] **质量门：** `pnpm run gates` 全绿；`check:docs-index`、`check:doc-status` 无 warning；类型、lint、filesize、tokens、heavy-path、boundaries、MCP payload、batch machines、test waits、i18n 均通过。
