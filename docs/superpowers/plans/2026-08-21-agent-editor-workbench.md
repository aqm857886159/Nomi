# Agent Editor Workbench Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 Nomi 现有的生成画布、时间轴、Production Run、AI 对话和本地素材能力收敛成一个可检查、可编辑、可撤销的 Agent 视频剪辑工作台，并以统一编辑协议承载本地素材、AI 生成镜头和 Remotion/HyperFrames 动态花字。

**Architecture:** 以 `EditorDocument` 作为项目唯一编辑事实源，以 `AssetRef/AssetRecord` 作为所有媒体与生成产物的稳定身份，以 `EditorCommand` 作为 UI、内置 Agent、MCP 和未来外部 Agent 的共同写入口。Agent 先把自然语言编译为 `EditProposal`，经过成本/范围/安全校验后再原子应用；异步生成、转码、渲染和导出复用现有 `productionRun` 事件与预算体系。Remotion 和 HyperFrames 只作为可替换的 Motion Graphic 渲染 adapter，不拥有第二套时间轴状态。

**Tech Stack:** Electron（先升级至当前受支持主线）+ React 18 + TypeScript + Zustand + Tailwind token system + Vercel AI SDK + Zod + FFmpeg；Remotion 作为第一版参数化视觉渲染器，HyperFrames 作为 HTML/CSS/GSAP Agent 视觉渲染器；Vitest + Playwright 负责单元、集成和真实用户任务闭环。

---

## 0. 产品决策和不可变边界

### 产品定义

Nomi 的产品形态是「Agent-first、Timeline-grounded 的本地优先视频工作台」，不是纯聊天生成器，也不是完整 Premiere 竞品。

用户可以用一句话表达目标，但每次有风险的改动都要落成可见提案；时间轴是最终事实，Agent 是编辑操作者，资产是可追踪对象，Production Run 是异步任务和成本账本。

### 用户必须获得的体验

1. 选中时间轴片段后，可以直接对 Agent 说“删掉这段停顿”“换一个过渡镜头”。
2. AI 生成结果自动成为本地项目资产，并在指定播放头位置出现。
3. 只替换失败镜头，不重做整条视频。
4. Agent 应用前显示影响范围、成本、耗时和 Diff。
5. 一次提案作为一个撤销单元；应用失败必须补偿回滚，不能留下半截状态。
6. 动态花字是时间轴上的一等公民，可以改 props、移动、隐藏和重新渲染。

### 明确不做

- 不做模板商城、素材社区和全功能 CapCut 竞品。
- 不让 Agent 默认无审批地生成多镜头长视频。
- 不把聊天窗口作为唯一编辑入口。
- 不让 Remotion/HyperFrames 直接拥有自己的项目状态或时间轴。
- 不允许 Agent 直接写任意项目 JSON、任意文件系统或任意网络代码。
- 不新建第二套 Agent Run/Render Run 状态系统，复用 `electron/productionRun/`。

### 现有基础与约束

- 当前分支为 `task/replicate-model-contract-tests`；工作树存在未解决合并冲突，执行前必须在干净 sibling worktree 重新验证，不能把当前脏工作树当作交付基线。
- 设计规范在 [`docs/design/nomi-design-system.md`](/Users/aoqimin/Desktop/Nomi/docs/design/nomi-design-system.md)，所有用户可见改动必须先出真实壳层样张，使用 token-only 样式并通过国际化门禁。
- 当前素材引用底座在 [`src/workbench/assets/assetTypes.ts`](/Users/aoqimin/Desktop/Nomi/src/workbench/assets/assetTypes.ts)，不能另造一个平行 `AssetRef`。
- 当前生成画布已有事务提案和整笔撤销实现：[`proposalTxn.ts`](/Users/aoqimin/Desktop/Nomi/src/workbench/generationCanvas/agent/proposalTxn.ts) 与 [`proposalUndo.ts`](/Users/aoqimin/Desktop/Nomi/src/workbench/generationCanvas/agent/proposalUndo.ts)。新编辑提案必须抽取/复用其原子事务、补偿回滚和 reconciliation 原则，不能再建第二套仅服务 Timeline 的事务实现。
- 当前共用 Agent runner 在 [`src/workbench/ai/workbenchAgentRunner.ts`](/Users/aoqimin/Desktop/Nomi/src/workbench/ai/workbenchAgentRunner.ts)，保留其会话流式、确认和取消能力，把“编辑命令编译”接在工具确认之后。
- 当前 Timeline 类型在 [`src/workbench/timeline/timelineTypes.ts`](/Users/aoqimin/Desktop/Nomi/src/workbench/timeline/timelineTypes.ts)，第一阶段要做版本化迁移，不能直接破坏既有项目文件。

## 1. 目标架构

```text
┌────────────────────────────────────────────────────────────┐
│ Workbench UI                                               │
│ Asset Pool │ Preview │ Timeline │ Agent / Proposal / Run    │
└──────────────────────┬─────────────────────────────────────┘
                       │ selectors + commands + events
┌──────────────────────▼─────────────────────────────────────┐
│ Editor Core (纯 TypeScript、无 React/Electron 依赖)          │
│ EditorDocument · EditorCommand · Reducer · Diff · Validator │
│ Revision · Selection · Asset identity · Undo boundary       │
└───────────────┬────────────────────┬────────────────────────┘
                │                    │
┌───────────────▼────────┐  ┌────────▼───────────────────────┐
│ Agent Orchestration      │  │ Job / Render Adapters           │
│ context → plan → compile │  │ GenerationJob · RenderManifest │
│ → proposal → apply       │  │ FFmpeg · Remotion · HyperFrames│
└───────────────┬────────┘  └────────┬────────────────────────┘
                │                    │
┌───────────────▼────────────────────▼────────────────────────┐
│ Electron Main / Production Run                               │
│ filesystem · proxy · provider transport · budget · events    │
│ cancellation · persistence · export · crash recovery         │
└───────────────────────────────────────────────────────────────┘
```

### 领域对象

```ts
export type AssetRole =
  | 'source'
  | 'aiGenerated'
  | 'reference'
  | 'motionGraphic'
  | 'voice'
  | 'music'

export type AssetRecord = AssetRef & {
  role: AssetRole
  provenance: {
    provider?: string
    model?: string
    prompt?: string
    codeHash?: string
    parentAssetIds?: string[]
    createdBy: 'user' | 'agent' | 'system'
    estimatedCost?: number
    actualCost?: number
  }
  lifecycle: 'available' | 'processing' | 'failed' | 'archived'
}

export type EditorDocument = {
  version: 2
  revision: number
  fps: number
  width: number
  height: number
  durationFrames: number
  assets: AssetRecord[]
  tracks: EditorTrack[]
  captions: CaptionItem[]
  transitions: TransitionItem[]
  graphics: MotionGraphicItem[]
  markers: EditorMarker[]
}

export type EditorTrack = {
  id: string
  kind: 'video' | 'audio' | 'caption' | 'graphic'
  label: string
  muted?: boolean
  locked?: boolean
  items: EditorItem[]
}

export type EditorItem = {
  id: string
  assetId?: string
  startFrame: number
  endFrame: number
  offsetStartFrame: number
  offsetEndFrame: number
  transform?: { x: number; y: number; scale: number; rotation: number }
}

export type CaptionItem = {
  id: string
  text: string
  startFrame: number
  endFrame: number
  words?: Array<{ text: string; startFrame: number; endFrame: number; confidence?: number }>
  speakerId?: string
}

export type TransitionItem = {
  id: string
  leftItemId: string
  rightItemId: string
  kind: 'cut' | 'fade' | 'dissolve' | 'custom'
  durationFrames: number
}

export type MotionGraphicItem = EditorItem & {
  assetId: string
  renderer: 'remotion' | 'hyperframes'
  props: Record<string, unknown>
  codeHash: string
  validationState: 'pending' | 'passed' | 'failed'
}

export type EditorMarker = {
  id: string
  frame: number
  label: string
  kind: 'note' | 'review' | 'generation-target'
}

export type ValidationResult = {
  code: string
  severity: 'error' | 'warning' | 'info'
  message: string
  itemIds?: string[]
}

export type EditorCommand =
  | { type: 'insertAsset'; assetId: string; trackId: string; startFrame: number; durationFrames?: number }
  | { type: 'replaceItemAsset'; itemId: string; assetId: string }
  | { type: 'splitItem'; itemId: string; atFrame: number }
  | { type: 'trimItem'; itemId: string; startFrame?: number; endFrame?: number }
  | { type: 'deleteItems'; itemIds: string[] }
  | { type: 'moveItems'; itemIds: string[]; deltaFrames: number }
  | { type: 'upsertCaption'; caption: CaptionItem }
  | { type: 'upsertMotionGraphic'; graphic: MotionGraphicItem }
  | { type: 'updateMotionGraphicProps'; itemId: string; props: Record<string, unknown> }

export type EditProposal = {
  proposalId: string
  baseRevision: number
  commands: EditorCommand[]
  summary: string
  affectedItemIds: string[]
  estimatedCost?: number
  estimatedDurationMs?: number
  validation: ValidationResult[]
  status: 'draft' | 'approved' | 'committed' | 'aborted' | 'rejected'
}
```

设计理由：`AssetRecord` 解决“这段内容从哪里来”，`EditorDocument` 解决“当前项目是什么”，`EditorCommand` 解决“怎样修改”，`EditProposal` 解决“修改前如何让用户检查”。四者分开后，UI、Agent、MCP 和渲染层不会互相复制业务逻辑。

## 2. 文件地图

### 新增

- `src/workbench/editor/editorTypes.ts`：编辑文档、Track、Item、Caption、Marker、Motion Graphic 的公共类型。
- `src/workbench/editor/editorCommands.ts`：`EditorCommand` 联合类型、命令构造器和命令摘要。
- `src/workbench/editor/editorReducer.ts`：纯 reducer；校验失败返回结构化错误，不静默修正用户输入。
- `src/workbench/editor/editorDiff.ts`：基于 revision 和命令生成用户可读 Diff。
- `src/workbench/editor/editorValidation.ts`：时间范围、轨道冲突、资产存在性、渲染器能力和安全校验。
- `src/workbench/editor/editorSession.ts`：Zustand/React 之外的项目编辑会话适配层，承载 revision、selection、proposal barrier。
- `src/workbench/editor/editorMigration.ts`：Timeline v1 → EditorDocument v2 的纯迁移器。
- `src/workbench/editor/editorCommandBus.ts`：UI、Agent、MCP 共用的唯一写入口。
- `src/workbench/editor/assetRegistry.ts`：在现有 `AssetRef` 之上维护角色、来源、版本、成本和生命周期。
- `src/workbench/editor/editorTypes.test.ts`、`editorReducer.test.ts`、`editorDiff.test.ts`、`editorValidation.test.ts`、`editorMigration.test.ts`、`editorCommandBus.test.ts`。
- `src/workbench/ai/editorProposalSchema.ts`：Zod proposal/command schema 和 LLM 输出解析。
- `src/workbench/ai/editorContext.ts`：根据当前选区、播放头、项目、资产和用户偏好构造最小 Agent 上下文。
- `src/workbench/ai/editorProposalCompiler.ts`：把模型工具调用编译为 `EditProposal`，不直接写 Zustand。
- `src/workbench/ai/editorProposalSchema.test.ts`、`editorProposalCompiler.test.ts`。
- `src/workbench/generation/generationJobTypes.ts`、`generationJobAdapter.ts`、`generationJobAdapter.test.ts`：Provider-neutral 生成任务。
- `src/workbench/motion/motionGraphicTypes.ts`、`motionGraphicValidator.ts`、`motionGraphicRenderer.ts`、`motionGraphicValidator.test.ts`：动态花字合同和渲染 adapter。
- `src/workbench/editor/components/EditorWorkbenchShell.tsx`：新的组合壳，不复制现有 Workbench 根 Store。
- `src/workbench/editor/components/EditorAssetPool.tsx`、`EditorAgentPanel.tsx`、`EditProposalCard.tsx`、`EditorRunCard.tsx`、`EditorSelectionContext.tsx`。
- `src/workbench/editor/components/*.test.tsx`：proposal、成本、撤销、错误状态的组件测试。
- `electron/editor/editorIpc.ts`、`editorIpc.test.ts`：主进程编辑命令、资产解析、任务事件桥。
- `docs/design/agent-editor-workbench.md`：批准后的交互和 token 使用说明。
- `docs/superpowers/specs/agent-editor-contract.md`：稳定的跨层协议。
- `docs/evals/agent-editor-real-tasks.md`：真实用户任务和验收脚本。

### 修改

- `src/workbench/assets/assetTypes.ts`：扩展 `AssetRole`、provenance/lifecycle；保留现有 `AssetOrigin` 的 render/transport 分离原则。
- `src/workbench/timeline/timelineTypes.ts`：从 v1 类型适配到 v2 EditorDocument，不直接删除 v1 读入能力。
- `src/workbench/timeline/buildClipFromAssetRef.ts`、`addAssetToTimeline.ts`、`timelineEdit.ts`、`renderManifest.ts`：改用 `assetId`，保留兼容读取。
- `src/workbench/generationCanvas/agent/proposalTxn.ts`、`proposalUndo.ts`：抽取可复用的事务/补偿接口；生成画布行为和事件名保持兼容。
- `src/workbench/ai/workbenchAgentRunner.ts`：保留流式和会话确认，接入 editor proposal compiler 和共享 command bus。
- `electron/productionRun/productionRunTypes.ts`、`productionRunService.ts`、`productionRunIpc.ts`：增加 editor/generation/render job 的 typed event payload，不新建第二套 run 状态。
- `electron/preload.ts`、`electron/main.ts`、`electron/browser/core/browserViewBridges.ts`：按现有安全策略增加最小 typed bridge；不暴露 Node 原语。
- `src/i18n/locales/timelineEditor.ts`、`timelinePreview.ts` 及对应 en/zh-CN locale：所有新的用户可见文案走 i18n。
- `package.json`、`pnpm-lock.yaml`：升级 Electron 到受支持主线；引入 Remotion 前先完成 contract 和安全评审。

## 3. 阶段计划

### Task 1: 建立干净执行基线和设计闸门

**Files:**
- Create: `docs/superpowers/specs/agent-editor-contract.md`
- Create: `docs/design/agent-editor-workbench.md`
- Create: `docs/mockups/agent-editor-workbench.html`
- Test/inspect: current repository baseline

- [ ] 在 sibling worktree 中基于 `origin/main` 建立干净基线，记录 `git branch --show-current`、HEAD、`git status --short`。
- [ ] 阅读 [`docs/design/nomi-design-system.md`](/Users/aoqimin/Desktop/Nomi/docs/design/nomi-design-system.md)、[`src/workbench/timeline/TimelinePanel.tsx`](/Users/aoqimin/Desktop/Nomi/src/workbench/timeline/TimelinePanel.tsx)、现有 Agent Panel 和 Production Run UI，记录不改动的现有区域。
- [ ] 写出真实布局样张：左资产池、中预览、底部时间轴、右 Agent/Proposal/Run；样张只使用现有 token 和已存在组件语义。
- [ ] 在样张中覆盖四个状态：空项目、待确认提案、生成中、生成失败可恢复。
- [ ] 在 `agent-editor-contract.md` 固化 EditorDocument v2、AssetRecord、EditorCommand、EditProposal、GenerationJob、MotionGraphic 的字段和版本策略。
- [ ] 在用户批准样张和协议之前，不修改可见 UI 和现有 Timeline 行为。

验收：产品方向、UI 结构、字段边界和“不做项”都可被另一位工程师独立复述；样张与真实 Nomi 壳层一致，而不是独立 Demo。

### Task 2: Electron 版本和运行安全基线

**Files:**
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Inspect/modify only if required: `electron/main.ts`, `electron/preload.ts`
- Test: Electron startup and IPC security tests

- [ ] 对照 Electron 官方支持计划确认目标版本，当前 Electron 31 不作为长期目标；升级到当前稳定且项目依赖兼容的受支持主线。
- [ ] 执行 `pnpm install`、`pnpm run typecheck`、`pnpm run build`，先记录升级前后失败差异。
- [ ] 保持 `contextIsolation: true`、`nodeIntegration: false`、CSP 和外部导航拦截不变。
- [ ] 为新增 editor IPC 只暴露命名方法和结构化 payload，不暴露 `ipcRenderer`、Node fs 或任意命令执行。
- [ ] 增加测试：渲染进程不能访问 Node、未知 editor channel 被拒绝、外部 URL 仍走系统打开逻辑。

验收：Electron 升级不改变现有项目打开、预览、导出、AI 会话和 Production Run 行为；安全检查全绿。

### Task 3: Editor Core 类型和 reducer（先测试）

**Files:**
- Create: `src/workbench/editor/editorTypes.ts`
- Create: `src/workbench/editor/editorCommands.ts`
- Create: `src/workbench/editor/editorReducer.ts`
- Create: `src/workbench/editor/editorValidation.ts`
- Test: `src/workbench/editor/editorTypes.test.ts`, `editorReducer.test.ts`, `editorValidation.test.ts`

- [ ] 先写测试：插入资产、分割、裁剪、移动、删除、替换资产会产生确定的 revision 和时间范围。
- [ ] 先写测试：不存在的 assetId、负时间、跨轨道冲突和超出项目边界的命令返回结构化错误，不修改原文档。
- [ ] 实现纯 `EditorReducer`，输入为 `(document, command)`，输出为 `{ document, inverseCommand, changes }`。
- [ ] 每个命令必须保证：不直接改输入对象、成功 revision 加 1、失败 revision 不变、可生成逆命令。
- [ ] 为命令增加人话摘要函数，例如 `deleteItems` 返回“删除 2 个片段”，供 Proposal Card 使用。
- [ ] 运行 `pnpm exec vitest run src/workbench/editor/editorTypes.test.ts src/workbench/editor/editorReducer.test.ts src/workbench/editor/editorValidation.test.ts`，预期全部 PASS。

### Task 4: Proposal/Diff/事务统一

**Files:**
- Create: `src/workbench/editor/editorDiff.ts`
- Create: `src/workbench/editor/editorSession.ts`
- Create: `src/workbench/editor/editorCommandBus.ts`
- Modify: `src/workbench/generationCanvas/agent/proposalTxn.ts`
- Modify: `src/workbench/generationCanvas/agent/proposalUndo.ts`
- Test: `src/workbench/editor/editorDiff.test.ts`, `editorCommandBus.test.ts`, existing proposal tests

- [ ] 先写测试：同一 proposal 的多个命令要么全部提交，要么全部通过 inverse/compensation 回滚。
- [ ] 先写测试：baseRevision 不是当前 revision 时拒绝应用，并返回“项目已被其他操作修改，需要重新预览”。
- [ ] 将画布现有事务的 `committed/aborted/reconciliation/compensation` 抽象为通用接口；保持现有 canvas event payload 和测试通过。
- [ ] 实现 `EditorCommandBus.applyProposal(proposal)`：校验 baseRevision、逐个 reducer、聚合 Diff、创建一个 undo barrier、提交事件。
- [ ] 应用失败时执行倒序补偿；补偿失败必须进入显式 `needsRecovery` 状态，不得静默吞掉错误。
- [ ] 提案记录至少持久化 proposalId、baseRevision、summary、commands、status、createdAt、affectedItemIds 和 cost。
- [ ] 运行 editor 和 generationCanvas 的全部 proposal/undo 测试，预期没有回归。

核心不变量：UI、内置 Agent 和 MCP 只能通过 `EditorCommandBus` 写入；不得直接调用 Timeline store 或 Generation Canvas store 修改项目事实。

### Task 5: Asset Registry 和 Timeline v1 → v2 迁移

**Files:**
- Modify: `src/workbench/assets/assetTypes.ts`
- Create: `src/workbench/editor/assetRegistry.ts`
- Create: `src/workbench/editor/editorMigration.ts`
- Modify: `src/workbench/timeline/timelineTypes.ts`
- Modify: `src/workbench/timeline/buildClipFromAssetRef.ts`
- Modify: `src/workbench/timeline/addAssetToTimeline.ts`
- Modify: `src/workbench/timeline/timelineEdit.ts`
- Modify: `src/workbench/export/renderManifest.ts`
- Test: `assetRegistry.test.ts`, `editorMigration.test.ts`, existing timeline tests

- [ ] 先写迁移测试：旧 `sourceNodeId: asset:<id>` 能生成稳定 `assetId`；旧 URL 快照在资产缺失时标记 `missing`，不静默删除。
- [ ] 扩展现有 `AssetRef`，增加 `role`、`provenance` 和 `lifecycle`，保留 render URL 与 transport origin 分离。
- [ ] 将 TimelineItem 的主引用改为 `assetId`；`sourceNodeId` 只作为兼容字段和来源追踪字段。
- [ ] 让同一 Canvas 节点的多个结果使用不同 assetId，修复“同一节点多 URL”时渲染清单无法区分的问题。
- [ ] 实现项目打开时的一次性迁移：读 v1、生成 v2、校验、写入备份；迁移失败时以只读方式打开并给出修复入口。
- [ ] 让 Canvas 删除/重生成触发 asset registry reconcile；Timeline 中被引用的资产不能被物理删除，只能标记 archived/missing。
- [ ] 运行 `pnpm exec vitest run src/workbench/timeline`，预期现有时间轴、拖拽、撤销、导出测试全部 PASS。

### Task 6: Agent 编辑上下文和 Proposal 编译器

**Files:**
- Create: `src/workbench/ai/editorProposalSchema.ts`
- Create: `src/workbench/ai/editorContext.ts`
- Create: `src/workbench/ai/editorProposalCompiler.ts`
- Modify: `src/workbench/ai/workbenchAgentRunner.ts`
- Modify: relevant agent skill/tool definitions
- Test: `editorProposalSchema.test.ts`, `editorProposalCompiler.test.ts`, `workbenchAgentRunner` tests

- [ ] 先写 Zod 测试：缺少 proposalId、未知 command、未知 assetId、额外未允许字段都必须拒绝。
- [ ] 实现最小上下文构造：当前项目摘要、选中 item、播放头前后窗口、可用资产摘要、项目约束和用户模型偏好；禁止每次把完整项目和完整聊天历史塞给模型。
- [ ] 将模型工具调用编译为 `EditProposal`，只允许白名单命令；读工具自动确认，写工具生成待确认 Proposal。
- [ ] 修改 `workbenchAgentRunner`：保留现有流式、cancel、usage 和 tool confirmation；当 tool 属于 editor write group 时转入 proposal compiler，不直接写状态。
- [ ] 对每个 Proposal 返回：人话摘要、影响片段、预计成本、预计耗时、验证结果、预览所需数据。
- [ ] 处理三种错误：模型输出非法、项目 revision 过期、资源不存在；每种错误都显示可恢复动作。
- [ ] 测试：自然语言“删掉停顿”可生成多个 `split/delete/move` 命令；重复确认不会重复提交；取消不会修改文档。

### Task 7: Agent Editor UI 和真实交互

**Files:**
- Create: `src/workbench/editor/components/EditorWorkbenchShell.tsx`
- Create: `src/workbench/editor/components/EditorAssetPool.tsx`
- Create: `src/workbench/editor/components/EditorAgentPanel.tsx`
- Create: `src/workbench/editor/components/EditProposalCard.tsx`
- Create: `src/workbench/editor/components/EditorRunCard.tsx`
- Create: `src/workbench/editor/components/EditorSelectionContext.tsx`
- Modify: existing Workbench route/shell and Timeline panel integration point
- Modify: `src/i18n/locales/timelineEditor.ts`, `timelinePreview.ts` and en/zh-CN locale files
- Test: component tests and Playwright smoke

- [ ] 先根据批准样张实现四个状态：空项目、Proposal 待确认、运行中、失败可恢复；不新建独立聊天页面。
- [ ] 左侧资产池按 source/AI/reference/motion/voice/music 分组，搜索、筛选和拖入时间轴复用现有 `AssetRef`。
- [ ] 右侧 Agent 面板显示消息、计划、成本/时间、Diff、Apply/Reject/Edit、Stop 和 Revert；运行卡片复用 Production Run 状态语义。
- [ ] 底部 Timeline 选区通过 `EditorSelectionContext` 提供给 Agent，不通过拼接隐藏文本传递上下文。
- [ ] 所有可见文案使用 i18n；所有按钮使用现有 WorkbenchButton/IconButton 层级规则；不新增全局 CSS。
- [ ] 组件测试覆盖：Apply disabled、revision conflict、cost warning、失败重试、整笔 Revert、空状态。
- [ ] 运行 Playwright：创建项目 → 导入资产 → 选中片段 → 发送编辑请求 → 看到 Proposal → 应用 → 撤销。

### Task 8: 本地素材 Agent 编辑 MVP

**Files:**
- Modify: existing transcription/import integration and `src/workbench/editor/editorCommandBus.ts`
- Create: `src/workbench/editor/transcriptCommandAdapter.ts`
- Modify: `electron/productionRun/productionRunService.ts` and export planner
- Test: unit, integration and real task suite

- [ ] 先完成真实任务“导入 20 分钟访谈，删停顿和重复，保留指定主题，导出 60 秒粗剪”的测试夹具。
- [ ] 将转录词级时间、停顿区间、说话人和置信度转成只读分析结果，不直接改变时间轴。
- [ ] 让 Agent 根据分析结果生成 `split/delete/move/upsertCaption` Proposal。
- [ ] 应用 Proposal 后重新计算字幕时间、片段 duration、播放头和导出 manifest。
- [ ] 技术检查至少包含：无负时长、片段不越界、音频轨不产生意外重叠、字幕区间与视频范围一致。
- [ ] 导出失败时保留可复现的 Render Manifest、日志和项目状态，不把项目标成完成。
- [ ] Playwright 真实任务必须能从导入走到导出，并在过程中人工查看截图确认体验，不只依赖断言。

### Task 9: AI GenerationJob 接入时间轴

**Files:**
- Create: `src/workbench/generation/generationJobTypes.ts`
- Create: `src/workbench/generation/generationJobAdapter.ts`
- Modify: provider adapters and `electron/productionRun/productionRunTypes.ts`
- Modify: `electron/productionRun/productionRunService.ts`, `productionRunIpc.ts`, `electron/preload.ts`
- Test: generation job contract, cancellation, budget and insertion tests

- [ ] 先写测试：job 创建必须包含 provider、model、targetPlayhead、estimatedCost 和 inputAssetIds。
- [ ] 实现 provider-neutral adapter；UI 只声明能力和目标，不写供应商专属字段。
- [ ] 生成前执行 preflight：能力、画幅、时长、成本、预计耗时、输入资产可传输性。
- [ ] 生成结果下载并注册为 `AssetRecord(role: 'aiGenerated')`；外部 URL 只放 provenance，不作为 Timeline 唯一地址。
- [ ] job 完成后通过 `insertAsset` Proposal 插入目标播放头；不要在生成函数里直接修改时间轴。
- [ ] 支持 stop、cancel、失败重试和单镜头 reroll；默认不自动递归生成多镜头。
- [ ] 记录 estimated/actual/refunded cost，生成失败或取消时用户可见最终结算。
- [ ] 测试断线、超时、重复回调、取消后迟到结果和项目关闭重启恢复。

### Task 10: Motion Graphic Contract、Remotion 和 HyperFrames adapter

**Files:**
- Create: `src/workbench/motion/motionGraphicTypes.ts`
- Create: `src/workbench/motion/motionGraphicValidator.ts`
- Create: `src/workbench/motion/motionGraphicRenderer.ts`
- Create: `src/workbench/motion/adapters/remotionAdapter.ts`
- Create: `src/workbench/motion/adapters/hyperframesAdapter.ts`
- Modify: `electron/export/renderManifest.ts` and export pipeline
- Test: validator, smoke render, preview/export parity

- [ ] 先定义统一 `MotionGraphicItem`：asset/local references、start/end frame、props、renderer、codeHash、theme tokens 和 validation state。
- [ ] 实现静态检查：禁止 fs、网络、任意 eval、未注册 import、未注册媒体地址；限制尺寸、时长和资源大小。
- [ ] Remotion adapter 接收 React component + props，输出预览地址和 Render Manifest 片段。
- [ ] HyperFrames adapter 接收受限 HTML/CSS/GSAP 文档，注入 Nomi 主题 token 和时间上下文，不允许访问 Electron API。
- [ ] 先执行低分辨率 smoke render，再允许正式导出；失败时 Motion Graphic 留在 error 状态，不破坏其他轨道。
- [ ] 支持修改 props 后只重渲染当前花字；不重新生成整个项目。
- [ ] 用同一项目跑预览和导出截图对账，验证字体、位置、时长和动画起止一致。

### Task 11: Production Run、Render Manifest 和恢复能力

**Files:**
- Modify: `electron/productionRun/productionRunTypes.ts`, `productionRunService.ts`, `productionRunProjectionSanitizer.ts`
- Modify: `electron/export/exportManifest.ts`, `exportPlanner.ts`, `exportJobManager.ts`
- Modify: `src/workbench/taskCenter/productionRunTaskCenter.ts`
- Test: existing production run tests plus editor recovery tests

- [ ] 增加 editor-specific stages：`analyze`、`propose`、`generate`、`apply`、`render`、`validate`、`export`，保留现有通用状态。
- [ ] 所有阶段事件都带 projectId、runId、proposalId、assetIds、revision 和 artifactIds。
- [ ] 重新打开项目时从持久化状态恢复 pending/running/failed；不能把未确认 Proposal 当成已应用。
- [ ] 对生成任务和渲染任务使用幂等 key，重复事件不得重复插入资产或重复扣账。
- [ ] `renderManifest` 只从 EditorDocument 派生，不从 UI snapshot 派生；记录 manifest hash 便于复现。
- [ ] 任务中心显示每一步的状态、成本和恢复动作，但不新建第二个 Run Center。
- [ ] 测试应用中断、渲染崩溃、Electron 重启、网络断开和用户取消后的最终状态。

### Task 12: MCP 和外部 Agent 接入

**Files:**
- Modify: existing MCP/editor tool declarations and bridge
- Create: `src/workbench/editor/editorMcpTools.ts`
- Test: MCP contract and ownership/lock tests

- [ ] 只暴露高价值、可组合的 EditorCommand 能力，不暴露内部 Zustand action。
- [ ] 外部 Agent 的读取工具包含项目 revision、选区、资产摘要、Timeline 摘要和可用能力。
- [ ] 外部写操作先生成 EditProposal，和内置 Agent 走同一个 apply/reconcile/undo 路径。
- [ ] 增加项目 lease/ownership：同一项目只能有一个写入者，断线后按超时回收；读取不受影响。
- [ ] 所有外部调用携带 clientId、proposalId 和 baseRevision，过期 revision 必须拒绝。
- [ ] 测试 OpenCode/Claude Code 类外部客户端连接、断线、重复提交和项目锁竞争。

### Task 13: 真实用户任务系统和视觉质量闸门

**Files:**
- Create: `docs/evals/agent-editor-real-tasks.md`
- Create: Playwright task fixtures under existing e2e structure
- Create: `docs/audit/agent-editor-<date>.md` after implementation

- [ ] 建立以下真实任务：
  - J1：导入访谈，删停顿，应用提案，撤销，再应用。
  - J2：在播放头插入 AI 过渡镜头，查看成本，取消一次，再成功插入。
  - J3：生成动态花字，修改文字与位置，只重渲染花字。
  - J4：删除/重生成一个镜头，验证其他镜头和字幕不变。
  - J5：运行中关闭并重开应用，恢复失败任务和项目状态。
- [ ] 每个任务记录开始状态、用户动作、预期结果、截图点、耗时和失败恢复路径。
- [ ] Playwright 断言功能状态；人工查看同构建、同入口截图，检查密度、层级、错误状态、预览/时间轴一致性。
- [ ] 把发现的体验问题在同一执行轮中修复，不把“测试通过”当作完成条件。

## 4. 质量和发布门禁

每个阶段完成前都必须运行：

```bash
pnpm run check:filesize
pnpm run check:tokens
pnpm run check:i18n
pnpm run lint:ci
pnpm run typecheck
pnpm run test
pnpm run build
pnpm run test:e2e
```

用户可见阶段额外要求：

1. 通过批准样张逐项对账；
2. 使用真实用户任务 J1-J5 走通闭环；
3. 截图人工检查，不只依赖 Playwright expect；
4. 检查 preview/export parity；
5. 检查失败、取消、断线和恢复状态；
6. 记录每个阶段的成本、耗时和失败率。

## 5. 关键不变量

1. `EditorCommandBus` 是唯一写入口。
2. `EditorDocument.revision` 单调递增；过期 Proposal 不能应用。
3. Proposal 是一个撤销单元；部分应用必须补偿回滚。
4. TimelineItem 主引用是 `assetId`，`sourceNodeId` 只用于来源追踪或兼容迁移。
5. 本地原始素材不能被 AI 任务覆盖；生成结果是新 AssetRecord。
6. 生成、渲染、导出都是可取消、可恢复、可审计的 Production Run stage。
7. Agent 不能访问未注册文件、网络、Electron API 或任意代码执行。
8. 预览和正式导出必须从同一个 Render Manifest 派生。
9. 任何供应商替换都不能改变用户看到的 EditorCommand 和 UI 结构。
10. 新功能不在 `workbenchStore.ts` 继续堆积跨领域状态。

## 6. 产品指标

- 首次导入到可用粗剪的时间。
- Agent Proposal 一次通过率。
- 用户对 Proposal 的人工修正分钟数。
- 每分钟最终可用视频的实际生成成本。
- 失败后局部修复比例。
- 整条视频重新生成比例。
- 预览/导出不一致率。
- 取消或断线后的恢复时间。
- 已生成资产的复用率。
- 用户关闭 Agent 后是否仍回到纯手工编辑。

第一版最重要的成功指标不是生成视频数量，而是：

> Agent 是否减少了审核和返工时间。

## 7. 风险和处理方式

### 风险：现有 Timeline 迁移破坏旧项目

处理：版本化迁移、备份、只读恢复模式、旧字段兼容读取；先做 fixture migration tests，再切写入路径。

### 风险：Proposal 与现有 Canvas 事务出现两套语义

处理：先抽取 `proposalTxn` 的通用事务/补偿接口；Canvas 和 Editor 都通过同一底层 barrier/reconcile 语义，事件 payload 保持兼容。

### 风险：Agent 上下文过大导致成本和准确率下降

处理：只发送选区、播放头窗口、资产摘要、项目约束和用户明确引用的内容；完整项目通过只读查询工具按需读取。

### 风险：代码生成花字出现安全问题或预览与导出不一致

处理：静态限制、沙箱、smoke render、统一 Render Manifest、截图对账；任何验证失败都保持失败状态，不自动进入正式导出。

### 风险：Electron 升级扩大变更范围

处理：先单独升级和跑完整门禁；升级提交不混入 Editor Core；如果某个原生依赖阻塞，先保留 adapter 边界并记录具体兼容错误，不改变产品协议。

### 风险：功能扩展成完整 NLE，失去差异化

处理：每个新增控件都回答“它是否降低 Agent 编辑返工”；不能回答就延后。优先做 proposal、局部重生成、资产追踪和恢复能力。

## 8. 交付顺序和提交纪律

建议按以下可独立回滚的提交序列推进：

1. `docs: define agent editor contract and approved mockup`
2. `chore: upgrade electron supported line`
3. `feat: add editor core reducer and validation`
4. `feat: unify proposal command bus and compensation`
5. `feat: migrate timeline assets to editor document v2`
6. `feat: compile agent edits into proposals`
7. `feat: add agent editor workbench shell`
8. `feat: ship local footage edit agent mvp`
9. `feat: insert ai generation jobs into timeline`
10. `feat: add remotion motion graphic adapter`
11. `feat: add hyperframes motion graphic adapter`
12. `feat: add production run recovery for editor jobs`
13. `feat: expose editor command protocol to mcp`
14. `test: add agent editor real task suite`

每个提交只覆盖一个领域边界；每次提交前运行该领域测试和相关门禁。不得在工作树有未解决冲突时提交或把当前分支直接推到受保护分支。

## 9. 执行起点

实际执行从 Task 1 开始，顺序固定为：

```text
真实 Nomi 壳层样张
        ↓ 用户确认
EditorDocument / Asset / Command / Proposal 协议
        ↓ 单元测试先行
Editor Core + Timeline 迁移
        ↓ 真实任务验证
本地素材 Agent 编辑
        ↓ 成本/恢复验证
AI 镜头插入
        ↓ 沙箱/渲染验证
Remotion / HyperFrames 花字
        ↓ 闭环稳定后
MCP / 外部 Agent
```

这份顺序的核心逻辑是：先把“改什么、改到哪里、如何撤销、失败如何恢复”做成稳定内核，再把更多模型和渲染能力接进来。否则会得到一个可以调用很多 AI 的系统，但没有可靠的编辑事实源，也无法让用户放心把真实项目交给它。
