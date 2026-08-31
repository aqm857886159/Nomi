# Nomi 通用工作流运行时与 Skill 编排 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 Nomi 从“只有 brand.promo 的宣传片流水线”升级为一个通用、模型能力自适应、可由 Claude Code/Codex/WorkBuddy 单一确认面驱动的工作流运行时；封面、批量海报、图片编辑、画布探索、叙事视频和已有素材剪辑走不同 Workflow，但共享状态、Skill、模型目录、审批、项目产物和恢复机制。

**Architecture:** 保留现有 `skill.json + SKILL.md + PlaybookRun + ProductionRun + MCP`，不另造第二套 Agent。`SKILL.md` 只放方法论，`skill.json` 声明 Workflow 阶段、Skill 引用、审批和能力需求；Router 根据用户意图选择 Workflow；Model Capability Resolver 根据模型档案的合法时长、音频、参考输入和 key 状态选模型并翻译参数；一个通用的持久化 Run 记录阶段、Job、Artifact、Approval 和恢复游标。外部 Agent 声明 MCP elicitation 时，确认只发生在外部 Agent；Nomi UI 只作为接管/不支持 elicitation 时的备用面。

**Tech Stack:** Electron + React 18 + TypeScript；现有 `electron/skills`、`electron/productionRun`、`electron/catalog`、`electron/capabilityCore`、`src/config/modelArchetypes`、时间轴/导出层；Vitest、Node MCP 黑盒、Playwright/真实 Electron 无额度走查、真实媒体验收只在零额度合同全绿后执行。

**Non-goals for this plan:** 不把 30 秒写成全局默认；不为每个供应商写独立 Workflow；不让封面/海报强行经过剧本和分镜；不把用户同时赶到 Agent 和 Nomi 两处重复确认；不在本计划执行阶段自动消耗 provider 额度。

---

## 0. 已调研的设计依据与固定决策

### 0.1 顶尖开源项目提供的可复用原则

| 项目 | 真实做法 | Nomi 采用 | Nomi 不照搬 |
|---|---|---|---|
| [ComfyUI](https://github.com/Comfy-Org/ComfyUI) | JSON 工作流是节点 DAG；提交后进入队列；未变化的图分支可复用；job 有队列、历史和输出 | `WorkflowSpec` + 依赖图 + job 状态 + partial retry；生成计划可落画布 | 不把全部底层节点暴露给普通用户；Nomi 仍保留高层 Skill/工作流语言 |
| [InvokeAI Workflow/Canvas](https://invoke.ai/features/canvas/run-workflow/) | 画布选择 Workflow，表单只暴露该 Workflow 参数，结果先到 staging area，用户接受后进入画布 | 候选/采用/提交三态；生成结果先成为项目 artifact，再 materialize 到画布 | 不把 Canvas 当所有任务的必经入口 |
| [LangGraph Interrupts](https://langchain-ai.github.io/langgraph/how-tos/human_in_the_loop/breakpoints/) | checkpoint + interrupt + resume；长任务和人工审阅可从原位置恢复 | Run 的 gate、checkpoint、idempotency、resume；审批 payload 是结构化小对象 | 不把 Nomi 的领域规则变成通用 LLM agent loop |
| [OpenHands Skills](https://docs.openhands.dev/overview/skills) | 全局规则常驻；专项 Skill 按关键词/Agent 判断按需加载；摘要优先，正文渐进披露；项目级覆盖全局 | 当前 Workflow 当前 stage 只加载 1–4 个 `skillRefs`，写入 `skillEvidence` | 不把 20 多个导演 Skill 全部灌进每一轮上下文 |
| [MCP Specification](https://modelcontextprotocol.io/specification/2025-06-18/index) | Resources、Prompts、Tools、Elicitation 分工；用户同意和取消是协议安全原则 | Resource 读 Skill/Artifact，Tool 执行动作，Elicitation 做真人确认；所有动作回 `nextAction` | 不把 MCP 当成第二个业务状态机；状态仍归 Nomi Run |
| [InVideo Storyboard](https://help.invideo.io/en/articles/14754413-creating-storyboards-with-invideo) | 先锁角色/光线/art direction，再从 storyboard 单帧抽取到视频；候选帧可局部进入后续生成 | 先生成候选/锚，再局部升级为视频，不整板重生成 | 不假设固定 9 镜覆盖所有任务 |
| [LTX Studio](https://ltx.studio/platform/ai-video-generator) | script → scenes/shots/storyboard → timeline；平台编辑层与 API 层分开 | 叙事 Workflow 保留中间层和时间轴；模型 API 只是执行器 | 不把模型 API 误当项目工作流 API |
| [Canva MCP transactions](https://www.canva.dev/docs/mcp/verify-integration/) | 先生成候选，用户选择后创建；编辑用 transaction/commit，不因小改动整张 regenerate | candidate → adopted → committed；批量海报一次授权，单张 patch/retry | 不将未 commit 的草稿报告成已保存 |

### 0.2 固定产品决策

1. **一个 Runtime，多个 Workflow。** 不新增一套 `AssetRun` 与 ProductionRun 并行状态机；扩展当前 Run 使其能承载不同工作流的最小阶段集合。
2. **Skill 不是 Workflow。** Skill 只回答“怎么创作”；Workflow 决定阶段、依赖、审批、并发和产物。
3. **模型按能力选择，不按宣传片名字选择。** `family: seedance` 只能是软偏好，不能是硬路由。
4. **目标时长和模型时长分离。** `targetDurationSeconds` 是创作目标；`shot.durationSec` 是镜头目标；Model Profile 决定实际合法值；probe 后的 `actualDurationSeconds` 才是事实。
5. **音频是能力策略，不是通用布尔值。** 支持原生音频就映射到模型字段；不支持时走独立音频轨；`required` 无法满足时在付费前阻断。
6. **参考图按职责建模。** `identityRef / sceneRef / firstFrameRef / lastFrameRef / motionRef / audioRef / styleRef` 不能继续全部叫“参考图”。
7. **外部 Agent 是主确认面。** MCP 客户端声明 elicitation 时，方向/剧本/分镜/预算/粗剪确认都在 Agent 内完成；Nomi 只显示镜像状态和接管入口。
8. **确认点按风险和 Workflow 决定。** 叙事视频保留剧本审阅；海报不创建剧本；批量海报只做一次批次授权和结果选择；低风险门可以合并，但付费门不删除。

---

## 1. 当前代码地图与边界

先以这些文件为事实源，避免重写已经存在的能力：

| 责任 | 当前文件 | 现状 | 改造边界 |
|---|---|---|---|
| Skill manifest | `electron/skills/skillManifestSchema.ts` | 已有 `stages`、`dependsOn`、`skillRefs`、`modelPrefs` | 增加 Workflow/策略声明；保留旧 manifest 兼容 |
| Skill 加载 | `electron/skills/skillStore.ts` | 已有摘要/正文渐进读取和 MCP exposure | 增加按 stage 解析 `skillRefs`，返回可审计加载记录 |
| Playbook DAG | `electron/skills/playbookOrchestrator.ts` | 已有拓扑排序、pause、阶段游标 | 抽成 Workflow 通用 DAG，不能只服务宣传片 |
| Production registry | `electron/productionRun/productionPlaybooks.ts` | 目前只注册 `brand.promo` | 注册 asset/narrative/edit definitions，禁止未知工作流静默生成空 Run |
| Run 状态 | `electron/productionRun/productionRunTypes.ts`, `productionRunReducer.ts` | 已有 stages/gates/jobs/artifacts/revision | 加 `workflowKind`、target policies、approval surface 和 job lineage |
| Run driver | `electron/productionRun/productionRunDriverOps.ts` | 方向→剧本→分镜→画布→生成→QA→导出，含大量 brand assumptions | 拆 stage handler；保留 narrative handler，新增 asset/edit handler |
| MCP catalog | `electron/capabilityCore/mcpToolCatalog.ts` | 已有 `nomi_generate`、Production tools、Artifact tools | 增加 intake/workflow/batch/asset tools；schema 从 Workflow/Model Profile derive |
| MCP protocol | `electron/capabilityCore/mcpProtocol.ts` | 已有 elicitation-first、plan/spend trust、Nomi fallback | 统一 approval surface、批次授权和 cancellation |
| Dispatcher | `electron/capabilityCore/dispatcher.ts` | 生产/画布/模型/Skill 路由 | 新增 workflow methods，所有方法带 project/run/artifact scope |
| 模型档案 | `src/config/modelArchetypes/*`, `electron/catalog/*` | 已有 duration/options/audio/ref slots/vendor mapping | 提取 capability resolver，不改已有 provider mapping 的单一真相 |
| 分镜 | `src/workbench/generationCanvas/agent/storyboardPlan.ts` | 已有 per-shot duration、ff/motion/lf、continuity、transition | 只让 narrative Workflow 依赖；图片/海报不复用它 |
| 时间轴/导出 | `src/workbench/preview/timelineSubtitleTransitionContract.ts`, `electron/export/*` | 已有字幕/转场/音频/边界合同 | 将目标时长与实际 probe 分离；输出事实回写 artifact |
| 黑盒轨迹 | `scripts/productionTrajectoryContract.mjs`, `tests/ux/production-mcp-journey.e2e.mjs` | 已有 MCP/人审/事件/媒体证据合同 | 扩展多 Workflow、model adaptation、audio/reference evidence |

### 1.1 当前必须先解决的结构性问题

这不是“再补几个 Skill”就能解决的状态。当前代码有两套事实源：

1. `skill.json/SKILL.md → skillManifestSchema → skillStore` 负责声明 Skill；
2. `productionPlaybooks.ts → productionRunRepository → productionRunDriverOps` 才真正决定 Run 的阶段、门和任务。

因此 `drama.short` 虽然已有完整 Skill 包，却不能被 ProductionRun/MCP 启动；`skillRefs` 目前主要是声明证据，不能证明正文真的被当前 planner 读取；driver 还把 `generate/qa/assemble/export` 和宣传片字段写死。下面的计划先合并这两套事实，再扩 Workflow，不会通过加更多旁路解决问题。

当前优先级最高的四个根因是：

- **P0：Workflow/Registry/Driver 分叉。** 新增封面或海报如果只加 Skill，仍可能被误送进宣传片阶段。
- **P0：执行没有冻结快照。** Storyboard 或画布被修改后，运行中的 Job 可能读到新 prompt/模型/参考图；必须在第一次付费提交前编译 immutable Execution Snapshot。
- **P1：模型适配藏在默认值里。** Seedance、GPT Image、固定 5 秒和 `audioMode: mute` 不是通用产品规则，必须由 Model Capability Resolver 和 Workflow Policy 决定。
- **P1：导出仍依赖当前窗口状态。** Production export/arrange 需要使用 `projectId + runId + timelineVersion` 的持久化绑定，不能依赖当前 Zustand 里恰好打开的项目。

这四项决定了实施顺序：先统一 Runtime/Workflow/Skill/Model 的边界，再做图片和编辑类 Workflow，最后才把真实额度用于视频验收。

---

## 2. 统一数据合同

### Task 1: 建立 Workflow/Policy/Capability 类型

**Files:**
- Create: `electron/skills/workflowTypes.ts`
- Modify: `electron/skills/skillManifestSchema.ts`
- Modify: `electron/productionRun/productionRunTypes.ts`
- Test: `electron/skills/workflowTypes.test.ts`
- Test: `electron/skills/skillManifestSchema.test.ts`

- [ ] **Step 1: 写失败测试，锁定三种时长和四种音频策略**

```ts
expect(normalizeDurationPolicy({ targetDurationSeconds: 30 })).toEqual({
  targetSeconds: 30,
  toleranceSeconds: 1.5,
})
expect(normalizeDurationPolicy({ maxDurationSeconds: 60 })).toEqual({
  maxSeconds: 60,
})
expect(() => normalizeDurationPolicy({ targetDurationSeconds: 0 })).toThrow()
expect(normalizeAudioPolicy('separate_track')).toBe('separate_track')
expect(() => normalizeAudioPolicy('all_models')).toThrow()
```

- [ ] **Step 2: 运行红测**

Run:

```bash
pnpm exec vitest run electron/skills/workflowTypes.test.ts electron/skills/skillManifestSchema.test.ts
```

Expected: 新类型/归一化函数尚不存在，测试失败。

- [ ] **Step 3: 增加不绑定供应商的类型**

```ts
export type WorkflowKind =
  | 'asset.single'
  | 'asset.batch'
  | 'asset.edit'
  | 'canvas.explore'
  | 'narrative.production'
  | 'edit.assemble'

export type AudioPolicy = 'off' | 'if_supported' | 'required' | 'separate_track'
export type ApprovalSurface = 'agent_first' | 'nomi_first' | 'either'
export type SpendMode = 'none' | 'once' | 'batch' | 'per_item' | 'per_shot'
export type ReviewMode = 'none' | 'candidate' | 'stage' | 'per_item' | 'per_shot'

export type DurationPolicy = {
  targetSeconds?: number
  maxSeconds?: number
  toleranceSeconds?: number
  source: 'user' | 'workflow_default' | 'content_inferred'
}

export type ReferenceRequirement = {
  slot: 'identity' | 'scene' | 'first_frame' | 'last_frame' | 'motion' | 'audio' | 'style'
  min?: number
  max?: number
  requiredWith?: string[]
}

export type WorkflowPolicy = {
  spend: SpendMode
  review: ReviewMode
  approvalSurface: ApprovalSurface
  audio: AudioPolicy
  concurrency: { default: number; max: number; userAdjustable: boolean }
}
```

- [ ] **Step 4: 给 manifest 增加可选字段并保持 legacy 行为**

`skill.json` 增加：

```ts
workflowKind?: WorkflowKind
workflowPolicy?: WorkflowPolicy
durationPolicy?: { defaultTargetSeconds?: number; minSeconds?: number; maxSeconds?: number }
referenceRequirements?: ReferenceRequirement[]
```

没有 `workflowKind` 的旧 Skill 仍按 legacy 单段 Skill 加载，不自动升级成 `narrative.production`。

- [ ] **Step 5: 运行绿测并提交边界**

Run:

```bash
pnpm exec vitest run electron/skills/workflowTypes.test.ts electron/skills/skillManifestSchema.test.ts
pnpm run typecheck
```

Commit: `feat: define generic workflow and capability policy contracts`

### Task 2: 让 ProductionRun 保存通用 Workflow 状态

**Files:**
- Modify: `electron/productionRun/productionRunTypes.ts`
- Modify: `electron/productionRun/productionRunRepository.ts`
- Modify: `electron/productionRun/productionRunReducer.ts`
- Modify: `electron/productionRun/productionRunProjectionSanitizer.ts`
- Test: `electron/productionRun/workflowRunContract.test.ts`

- [ ] **Step 1: 写跨 Workflow 状态测试**

测试必须验证：

```ts
expect(createRun({ playbook: 'asset.single' }).workflowKind).toBe('asset.single')
expect(createRun({ playbook: 'asset.batch' }).stages.map((s) => s.stageId)).toEqual(['brief', 'generate', 'adopt'])
expect(createRun({ playbook: 'narrative.production' }).stages.map((s) => s.stageId)).toContain('script')
expect(() => createRun({ playbook: 'unknown.kind' })).toThrow(/不存在/)
```

- [ ] **Step 2: 实现通用字段**

在 `ProductionRun` 增加：

```ts
workflowKind: WorkflowKind
workflowPolicy: WorkflowPolicy
durationPolicy?: DurationPolicy
audioPolicy: AudioPolicy
approvalSurface?: 'agent-elicitation' | 'nomi-ui' | 'none'
```

所有生成 Job 增加：

```ts
requestedDurationSeconds?: number
legalDurationSeconds?: number
durationAdaptation?: 'exact' | 'rounded' | 'model_fixed' | 'timeline_trim'
audioMode?: 'native' | 'separate_track' | 'none'
referenceRoles?: Array<'identity' | 'scene' | 'first_frame' | 'last_frame' | 'motion' | 'audio' | 'style'>
```

- [ ] **Step 3: 将字段加入安全 projection**

`nomi_get_run` 必须返回 `workflowKind`、目标时长、音频策略、并发策略和下一步，但禁止返回 API key、provider URL、内部绝对路径。

- [ ] **Step 4: 运行状态回归**

```bash
pnpm exec vitest run electron/productionRun/workflowRunContract.test.ts electron/productionRun/productionRunState.test.ts
```

Commit: `feat: persist workflow policy and adaptive generation intent`

---

## 3. Workflow Router 与 Skill 按阶段加载

### Task 3: 建立确定性的 Workflow Router

**Files:**
- Create: `electron/skills/workflowRouter.ts`
- Modify: `electron/skills/skillStore.ts`
- Modify: `electron/capabilityCore/mcpBriefIntake.ts`
- Modify: `electron/capabilityCore/dispatcher.ts`
- Modify: `electron/capabilityCore/mcpToolCatalog.ts`
- Test: `electron/skills/workflowRouter.test.ts`
- Test: `electron/capabilityCore/mcpWorkflowIntake.test.ts`

- [ ] **Step 1: 写真实用户意图红测**

```ts
expect(route('做一张 Nomi 视频封面').kind).toBe('asset.single')
expect(route('做 6 张产品海报').kind).toBe('asset.batch')
expect(route('把这张图换成竖版并保留人物').kind).toBe('asset.edit')
expect(route('探索三个角色造型').kind).toBe('canvas.explore')
expect(route('做一条 30 秒宣传片').kind).toBe('narrative.production')
expect(route('把现有镜头加字幕导出').kind).toBe('edit.assemble')
expect(route('帮我做点好看的东西').needsClarification).toBe(true)
```

- [ ] **Step 2: 实现路由优先级**

固定顺序：

```text
显式 workflow/playbook
→ 用户已选 Skill
→ 当前项目已有素材类型和动作词
→ 文本意图匹配
→ 最多返回 3 个候选并问一个澄清问题
```

不能用“出现 video 一词”直接进入 Production Run。

- [ ] **Step 3: MCP 暴露 intake**

`nomi_intake_brief` 返回：

```json
{
  "workflowKind": "asset.batch",
  "needs": ["用途", "画幅", "批次数量"],
  "plannedSkills": ["thumbnail-cover-design", "brand-guidelines"],
  "approvalPlan": { "spend": "batch", "review": "candidate", "surface": "agent_first" },
  "willCreate": ["6 个图片候选", "1 个批次 artifact"],
  "willNotCreate": ["script", "storyboard", "timeline"]
}
```

- [ ] **Step 4: 运行零额度 MCP 测试**

```bash
pnpm exec vitest run electron/skills/workflowRouter.test.ts electron/capabilityCore/mcpWorkflowIntake.test.ts
```

Commit: `feat: route user intent to explicit workflow kinds`

### Task 4: 按当前 Stage 渐进加载 Skill 并留下证据

**Files:**
- Create: `electron/skills/stageSkillResolver.ts`
- Modify: `electron/skills/skillStore.ts`
- Modify: `electron/productionRun/productionRunDriverOps.ts`
- Modify: `electron/productionRun/productionRunService.ts`
- Test: `electron/skills/stageSkillResolver.test.ts`
- Test: `electron/skills/skillExecutionEvidence.test.ts`

- [ ] **Step 1: 写 Skill 加载红测**

测试要求：script 阶段只加载 writer refs；storyboard 阶段只加载 director refs；未声明的 Skill 不进入 prompt；加载摘要和正文都记录 hash/version。

- [ ] **Step 2: 实现解析器**

```ts
export type LoadedStageSkill = {
  name: string
  version: string
  contentHash: string
  stageId: string
  source: 'builtin' | 'user'
}

export function resolveStageSkills(manifest: SkillManifest, stageId: string): LoadedStageSkill[]
```

解析器只读 `stage.skillRefs`；没有 refs 的阶段不自动加载全部导演 Skill。

- [ ] **Step 3: 将 Skill evidence 写入 artifact**

剧本、分镜、图片批次、视频 Job 和时间轴 artifact 都记录：`skillRefs`、`skillVersions`、`skillContentHashes`、`stageId`。只记录已实际读取的 Skill，不接受手写 evidence。

- [ ] **Step 4: 运行测试**

```bash
pnpm exec vitest run electron/skills/stageSkillResolver.test.ts electron/skills/skillExecutionEvidence.test.ts
```

Commit: `feat: load stage skills progressively with provenance`

---

## 4. 模型能力、时长、音频和参考输入

### Task 5: 建立 Model Capability Resolver

**Files:**
- Create: `electron/catalog/modelCapabilityResolver.ts`
- Modify: `electron/catalog/catalogStore.ts`（只接入已有模型档案，不复制 mapping）
- Modify: `src/config/modelArchetypes/types.ts`（补充统一 capability 标识）
- Test: `electron/catalog/modelCapabilityResolver.test.ts`

- [ ] **Step 1: 用纯数据写模型适配红测**

覆盖真实档案差异：

```ts
expect(adapt({ model: 'seedance-2', requestedSeconds: 5 }).legalSeconds).toBe(5)
expect(adapt({ model: 'sora-2', requestedSeconds: 5 }).legalSeconds).toBe(4)
expect(adapt({ model: 'veo-3.1', requestedSeconds: 5 }).legalSeconds).toBe(8)
expect(adapt({ model: 'seedance-2', audio: 'required' }).audioMode).toBe('native')
expect(adapt({ model: 'model-without-audio', audio: 'required' })).toMatchObject({ usable: false })
```

- [ ] **Step 2: 定义标准能力视图**

```ts
export type ModelCapability = {
  modelKey: string
  kind: 'text' | 'image' | 'video' | 'audio'
  taskKinds: Array<'text_to_image' | 'image_edit' | 'text_to_video' | 'image_to_video' | 'text_to_audio'>
  duration: { mode: 'range' | 'discrete' | 'fixed' | 'none'; min?: number; max?: number; values?: number[]; fixed?: number }
  audio: { native: boolean; inputReference: boolean; outputToggle?: string }
  references: Array<{ role: string; min: number; max: number }>
  maxConcurrency?: number
  keyStatus: 'ok' | 'missing' | 'locked'
}
```

该视图由现有 archetype/mapping 派生，不能在 Workflow 里写供应商字段。

- [ ] **Step 3: 实现候选评分**

硬过滤：keyStatus、taskKind、参考槽、音频 required、合法时长、允许 provider/model。

软评分：

```text
用户明确模型偏好       +30
能精确满足目标时长       +20
支持首尾帧/身份参考      +20
支持原生音频             +15
历史成功率               +10
成本/速度                +5
```

分数相同按用户配置顺序稳定排序，不按代码里的模型名称偶然排序。

- [ ] **Step 4: 运行不调用 provider 的模型测试**

```bash
pnpm exec vitest run electron/catalog/modelCapabilityResolver.test.ts electron/catalog/taskParams.test.ts
```

Commit: `feat: resolve generation models from capability profiles`

### Task 6: 把时长、音频、参考图变成 Workflow Policy

**Files:**
- Modify: `electron/productionRun/productionRunDriverOps.ts`
- Modify: `src/workbench/generationCanvas/agent/storyboardPlan.ts`
- Modify: `src/workbench/generationCanvas/agent/storyboardPlanEdits.ts`
- Modify: `electron/productionRun/productionRunTypes.ts`
- Test: `electron/productionRun/adaptiveDurationContract.test.ts`
- Test: `electron/productionRun/audioReferenceContract.test.ts`

- [ ] **Step 1: 先写目标时长和实际时长分离的红测**

验证：用户目标 30 秒、模型只能 4/8 秒时，Run 保存 `target=30`、Job 保存 `requested=5`、`legal=4` 或 `8`、导出 probe 保存 `actual`；不能把 30 伪装成每个 Job 的模型时长。

- [ ] **Step 2: 采用三层时长语义**

```text
targetDurationSeconds：整条作品创作目标
shot.durationSec：分镜希望的单镜长度
actualDurationSeconds：探测到的真实媒体长度
```

`DEFAULT_VIDEO_DURATION_SEC = 5` 只作为缺省输入；生成前必须经过 Resolver 钳制/离散化。

- [ ] **Step 3: 音频策略实现**

```text
off            → 不发音频相关参数
if_supported   → 档案有 native audio 才打开，否则视频保持无声并进入 separate-track 候选
required       → 没有 native audio 且没有独立 audio Workflow 时，在授权前 needs_attention
separate_track → 建立 audio Job，TTS/BGM/音效作为独立 artifact，最后混音
```

禁止给没有声明该字段的模型发送 `generate_audio`、`audio` 或 `sound`。

- [ ] **Step 4: 参考输入角色化**

把当前 `referenceImages` 等输入投影为 `identityRef / sceneRef / firstFrameRef / lastFrameRef / motionRef / audioRef / styleRef`；Model Profile 再决定实际 vendor 参数。缺失或超限时返回具体 `nextAction`，不静默丢参考。

- [ ] **Step 5: 运行零额度合同**

```bash
pnpm exec vitest run electron/productionRun/adaptiveDurationContract.test.ts electron/productionRun/audioReferenceContract.test.ts
pnpm run typecheck
```

Commit: `feat: adapt duration audio and references to model capabilities`

---

### Task 6.5: 把 authored plan 编译成不可变 Execution Snapshot

这是 ComfyUI 的“校验后入队”、InvokeAI 的“workflow → compiled graph → queue item”和 LangGraph 的“副作用任务可恢复”共同指向的关键边界：用户审阅的是作者稿；provider 执行的是冻结快照。不能让用户在视频已经提交后编辑 StoryboardPlan，导致运行中的 Job 偷换 prompt、模型或参考图。

**Files:**
- Create: `electron/productionRun/productionExecutionSnapshot.ts`
- Modify: `electron/productionRun/productionRunTypes.ts`
- Modify: `electron/productionRun/productionRunService.ts`
- Modify: `electron/productionRun/productionRunDriverOps.ts`
- Modify: `electron/productionRun/productionRunArtifactOperations.ts`
- Test: `electron/productionRun/productionExecutionSnapshot.test.ts`
- Test: `electron/productionRun/productionRunRecovery.test.ts`

- [ ] **Step 1: 写不可变快照红测**

```ts
const snapshot = compileExecutionSnapshot({
  run,
  storyboardArtifact,
  modelCapabilities,
  policy,
})
expect(snapshot.schemaVersion).toBe(1)
expect(snapshot.planHash).toMatch(/^sha256:/)
expect(snapshot.jobs[0]).toMatchObject({
  shotId: 'shot-1',
  modelKey: expect.any(String),
  requestedDurationSeconds: expect.any(Number),
  legalDurationSeconds: expect.any(Number),
  referenceRoles: expect.any(Array),
})
expect(() => mutateExecutionSnapshot(snapshot)).toThrow()
```

- [ ] **Step 2: 固定快照字段**

```ts
export type ProductionExecutionSnapshot = {
  schemaVersion: 1
  snapshotId: string
  runId: string
  sourceArtifactId: string
  sourceArtifactVersion: number
  sourceArtifactHash: string
  planHash: string
  policyHash: string
  createdAt: string
  jobs: Array<{
    jobId: string
    shotId?: string
    modelKey: string
    provider: string
    taskKind: string
    prompt: string
    requestedDurationSeconds?: number
    legalDurationSeconds?: number
    audioMode: 'native' | 'separate_track' | 'none'
    referenceRoles: string[]
    referenceAssetVersions: string[]
    previousJobId?: string
    idempotencyKey: string
  }>
}
```

`compileExecutionSnapshot` 必须在预算/生成门批准后、第一次付费 Job 提交前执行；之后的 Storyboard revision 只能生成新 snapshot，不得修改旧 snapshot。

- [ ] **Step 3: 让恢复和重试只读快照**

provider retry、reconcile、resume 都从 snapshot 读取模型、prompt、参考和合法时长；不能从当前画布节点重新推导。重复 `materialize` 对同一个 `snapshotId` 返回原 jobs，不重复创建节点或 provider task。

- [ ] **Step 4: 运行恢复/重放红绿测试**

```bash
pnpm exec vitest run electron/productionRun/productionExecutionSnapshot.test.ts electron/productionRun/productionRunRecovery.test.ts
```

测试必须证明：

- 同一个 snapshot 重复提交只调用一次 provider；
- 修改分镜后旧 Job 的 prompt/hash 不变；
- MCP `nomi_get_run` 高频读取不会改变 submitting 状态；
- 进程重启后只对没有 in-flight 记录的 stale Job 做 recovery/reconcile。

Commit: `feat: compile immutable execution snapshots before provider work`

---

## 5. Workflow 实现与审批体验

### Task 7: 把现有 brand.promo 抽成 narrative.production

**Files:**
- Modify: `electron/productionRun/productionPlaybooks.ts`
- Create: `electron/productionRun/workflowStageHandlers.ts`
- Modify: `electron/productionRun/productionRunDriverOps.ts`
- Modify: `skills/brand-promo/skill.json`
- Modify: `skills/brand-promo/SKILL.md`
- Test: `electron/productionRun/narrativeWorkflow.test.ts`

- [ ] **Step 1: 锁定叙事默认流程**

```text
intake/direction（可合并为一次外部 elicitation）
→ script（必须审阅，符合现有产品设计）
→ storyboard（结构明显变化时审阅；快速草稿模式可折叠为候选确认）
→ materialize/freeze
→ generate（一次批次/波次授权，镜头依赖按图调度）
→ qa
→ rough-cut
→ export
```

- [ ] **Step 2: 把 `family: seedance` 降为软偏好**

`brand.promo.skill.json` 只声明 `kind: video`、`taskKinds: [image_to_video]`、连续性、音频和参考要求；Resolver 根据用户可用模型选择 Seedance、Veo、Kling 或其它满足条件的模型。

- [ ] **Step 3: 将 stage handler 从 driver 壳中拆出**

```ts
export type WorkflowStageHandler = {
  stageId: string
  propose(run: ProductionRun): Promise<StageResult>
  reviewPolicy: ReviewMode
  execute(run: ProductionRun): Promise<StageResult>
}
```

`productionRunDriverOps.ts` 只负责读取当前 stage、调用 handler、写事件和恢复，不再判断 `brand.promo` 的全部业务细节。

- [ ] **Step 4: narrative 零额度测试**

验证剧本审阅仍存在；海报不会触发剧本；修改剧本后旧 storyboard 变 stale；approved storyboard 才能 materialize；Job metadata 保存 Skill、时长、音频和参考角色。

```bash
pnpm exec vitest run electron/productionRun/narrativeWorkflow.test.ts electron/productionRun/productionScriptReview.test.ts electron/productionRun/productionStoryboardMaterialize.test.ts
```

Commit: `refactor: make narrative production a workflow handler`

### Task 8: 增加 asset.single / asset.batch / asset.edit

**Files:**
- Create: `skills/asset-single/skill.json`
- Create: `skills/asset-single/SKILL.md`
- Create: `skills/asset-batch/skill.json`
- Create: `skills/asset-batch/SKILL.md`
- Create: `skills/asset-edit/skill.json`
- Create: `skills/asset-edit/SKILL.md`
- Modify: `electron/productionRun/productionPlaybooks.ts`
- Modify: `electron/productionRun/workflowStageHandlers.ts`
- Modify: `electron/capabilityCore/mcpToolCatalog.ts`
- Modify: `electron/capabilityCore/dispatcher.ts`
- Test: `electron/capabilityCore/assetWorkflowJourney.test.ts`

- [ ] **Step 1: 定义三条最小 Workflow**

```text
asset.single = intake → authorize_once → generate → adopt
asset.batch  = intake → authorize_batch → generate_parallel → select/adopt
asset.edit   = import_source → describe_patch → authorize_once → generate_edit → adopt
```

- [ ] **Step 2: 批次授权绑定预算和数量**

`authorizationId` 必须绑定 `projectId + runId + workflowKind + batchId + maxItems + maxSpend + model constraints`。单张失败只生成该 item 的 retry Job，不重跑整批。

- [ ] **Step 3: 生成候选和采用分离**

每个图片结果都写：`candidate → adopted/rejected`；改标题/换 logo 等小改动写 patch revision，不整批 regenerate。

- [ ] **Step 4: 资产任务禁止误入视频阶段**

测试必须断言 asset Workflow 不调用 `production.plan-script`、`production.plan-storyboard`、`arrange_storyboard_to_timeline`，也不生成空的 storyboard artifact。

- [ ] **Step 5: 运行零额度 Journey**

```bash
pnpm exec vitest run electron/capabilityCore/assetWorkflowJourney.test.ts
```

Commit: `feat: add asset single batch and edit workflows`

### Task 9: 增加 edit.assemble 和统一审批面

**Files:**
- Create: `skills/edit-assemble/skill.json`
- Create: `skills/edit-assemble/SKILL.md`
- Modify: `electron/capabilityCore/mcpProtocol.ts`
- Modify: `electron/capabilityCore/mcpToolCatalog.ts`
- Modify: `electron/capabilityCore/mcpToolResults.ts`
- Modify: `electron/productionRun/productionRunDriverOps.ts`
- Test: `electron/capabilityCore/nomiMcpApprovalSurface.test.ts`
- Test: `tests/production/external-agent-single-surface.test.mjs`

- [ ] **Step 1: 固定审批面规则**

```text
MCP client supports elicitation → Agent-only confirmation
MCP client lacks elicitation + Nomi open → Nomi UI fallback
both unavailable → safe rejection with nextAction
```

同一个 durable approval 只能消费一次；Nomi UI 是接管，不是第二个 approval。

- [ ] **Step 2: 固定不同 Workflow 的审批数量**

```text
asset.single：一次付费确认，可选采用
asset.batch：一次批次授权 + 选中候选
narrative.production：剧本审阅 + 生成授权 + 粗剪确认
edit.assemble：粗剪确认 + 导出确认
```

- [ ] **Step 3: 结果必须给外部 Agent 下一步**

所有工具结果带：`workflowKind`、`approvalSurface`、`approvalId`、`artifactIds`、`nextAction`、`budget`、`status`。禁止只返回“请去 Nomi 点一下”。

- [ ] **Step 4: 映射 MCP 异步任务但不另造事实源**

如果 MCP client 支持实验性的 Tasks，`tools/call` 可以返回 transport task；`tasks/get`/`tasks/result` 只映射 Nomi Run 的状态和 `related-task`。Nomi `ProductionRun`、event cursor 和 artifact 版本仍是唯一事实源。客户端断开后重新连接，必须通过 `nomi_get_run`/`nomi_subscribe_run` 恢复，不能依赖内存里的 MCP task。

- [ ] **Step 5: 跑单一审批面黑盒**

```bash
NOMI_EXTERNAL_AGENT_ONLY=1 \
NOMI_EXTERNAL_STOP_BEFORE_MEDIA=1 \
pnpm exec vitest run tests/production/external-agent-single-surface.test.mjs
```

必须看到 0 次正常路径 desktop-click；Nomi takeover/reconcile 点击可以保留。额外验证：重复 `tools/call`、client disconnect/reconnect 和 `tasks/get` 不会重复消费 approval 或重复提交 Job。

Commit: `feat: make MCP elicitation the single external approval surface`

---

## 6. 真实用户任务与对抗测试

### Task 10: 建立六条真实用户任务合同

**Files:**
- Create: `tests/ux/workflow-router-journeys.e2e.mjs`
- Create: `tests/ux/asset-single.walk.mjs`
- Create: `tests/ux/asset-batch.walk.mjs`
- Create: `tests/ux/asset-edit.walk.mjs`
- Create: `tests/ux/narrative-production.walk.mjs`
- Create: `tests/ux/edit-assemble.walk.mjs`
- Modify: `scripts/productionTrajectoryContract.mjs`
- Test: `tests/production/workflow-trajectory-contract.test.mjs`

- [ ] **Step 1: 封面单图任务**

输入：`帮我做一张 9:16 的 Nomi 视频封面，保留产品截图，不要视频。`

合同：route=`asset.single`；只加载封面/品牌 Skill；没有 script/storyboard/timeline；一次授权；artifact 进入项目资产。

- [ ] **Step 2: 批量海报任务**

输入：`用这套品牌规范做 6 张 3:4 产品海报。`

合同：一次 batch approval；6 个独立 item；允许用户设置并发 1/2/3；一张失败只 retry 一张；不重复扣已完成项。

- [ ] **Step 3: 图片编辑任务**

输入：`把这张图改成 9:16，人物不变，背景换成清晨窗边。`

合同：source asset → patch candidate；不新建角色，不创建分镜；用户拒绝只废弃候选。

- [ ] **Step 4: 叙事宣传片任务**

输入：`做一条约 30 秒宣传片，有字幕、声音、两个明确转场。`

合同：方向→剧本审阅→分镜审阅→materialize→授权→逐镜生成→QA→粗剪→导出；30 秒只作为该任务 target，不成为全局常量。

- [ ] **Step 5: 已有素材剪辑任务**

输入：`把项目里的 8 个视频排成 30 秒以内，加字幕和配音。`

合同：不生成新视频，不写 script/storyboard；按已有素材 duration probe 排时间轴，字幕/音频/转场落项目。

- [ ] **Step 6: 画布探索任务**

输入：`先探索三个角色造型和两个场景，不要开始生成视频。`

合同：canvas.explore；生成节点/候选可落画布；不创建 Production Run 的媒体 Job；用户可选择候选后再转 asset 或 narrative。

Commit: `test: cover generic workflow journeys and trajectory evidence`

### Task 11: 对抗矩阵与错误恢复

**Files:**
- Create: `tests/production/workflow-adversarial-contract.test.mjs`
- Modify: `tests/production/production-trajectory-contract.test.mjs`
- Modify: `electron/productionRun/productionRunService.ts`
- Modify: `electron/productionRun/productionRunDriverOps.ts`
- Test: `electron/productionRun/workflowRecovery.test.ts`

- [ ] **Step 1: 覆盖模型能力变化**

测试：目标 5 秒但模型只支持 4/8；音频 required 但模型无原生音频；只有尾帧模型不支持 first frame；参考图超过 provider 上限；key missing/locked。

- [ ] **Step 2: 覆盖运行时故障**

测试：HTTP 503、polling fetch failed、进程重启、MCP 重复调用、用户拒绝、审批超时、同一 batch item 重试；每个场景都要求保留 providerTaskId、idempotencyKey、retry lineage，且不能重复提交已成功 Job。

- [ ] **Step 3: 对账完整轨迹**

`validateProductionTrajectory()` 必须拒绝：手写 artifact、脚本自批准、无 `skill.loaded`、无 `artifact.adopted`、无 model capability snapshot、无 providerTaskId、无抽帧/音频证据、无根因迭代记录。

- [ ] **Step 4: 单进程和重启恢复分别测试**

读 projection 不得把同一进程内正在 submitting 的 Job 误标 `submission_unknown`；新 service 实例才可对 stale submission 进入 recovery。

Commit: `test: make workflow recovery and model adaptation fail closed`

---

## 7. 真实媒体验收门

### Task 12: 参数化媒体验收，不把 30 秒误当全局常量

**Files:**
- Modify: `tests/production/real-draft-film.test.mjs`
- Modify: `tests/production/real-film-acceptance.test.mjs`
- Modify: `src/workbench/preview/timelineSubtitleTransitionContract.ts`
- Modify: `scripts/analyze-real-film.mjs`
- Create: `tests/production/real-workflow-media-acceptance.test.mjs`

- [ ] **Step 1: 把 30 秒变成 fixture profile**

```js
const profile = {
  workflowKind: 'narrative.production',
  targetDurationSeconds: 30,
  toleranceSeconds: 1.5,
  minExplicitTransitions: 2,
  requireAudio: true,
  requireSubtitles: true,
}
```

同一合同可传 15、30、60；封面/海报不调用该合同。

- [ ] **Step 2: 真实媒体事实检查**

必须用 ffprobe/抽帧验证：视频时长、音频流、音频非静音、字幕流不越界、每个 authored transition 在边界帧有视觉变化、无白帧、镜头依赖状态和字幕时间一致。

- [ ] **Step 3: 模型能力证据**

每个 Job 记录 model capability snapshot、requested/legal/actual duration、audio mode、reference roles；最终报告能解释“为什么选择这个模型”和“为什么 5 秒被适配成 4/8 秒”。

- [ ] **Step 4: 真实运行顺序**

```text
先跑全部零额度 route/approval/recovery 合同
→ 再跑一次最小真实 image pilot
→ 通过后再跑视频单镜
→ 通过后才跑完整 30 秒片
→ 抽帧、音频、字幕、转场和轨迹一起验收
```

未经用户明确授权不启动真实 provider；本计划当前阶段只写合同，不消耗额度。

Commit: `test: parameterize media acceptance by workflow profile`

---

## 8. 交付顺序和停止条件

### 8.1 实施批次

1. **批次 A：类型和 Router**：Task 1–4。只改纯逻辑/manifest/投影，零额度。
2. **批次 B：Model Capability + Execution Snapshot**：Task 5–6.5。只读模型档案并冻结执行合同，零 provider。
3. **批次 C：Asset Workflows**：Task 8–9。先跑封面、海报、编辑的 MCP dry-run。
4. **批次 D：Narrative 抽象**：Task 7。确认既有剧本审阅和外部单一审批不回退。
5. **批次 E：真实任务合同**：Task 10–11。黑盒只跑到授权前或使用 fixture provider。
6. **批次 F：真实媒体**：Task 12。一次一档、可恢复、带抽帧和音频证据。

### 8.2 每批次必须通过的门

```text
pnpm run check:filesize
pnpm run check:tokens
pnpm run check:i18n
pnpm run lint:ci
pnpm run typecheck
pnpm run test
pnpm run build
```

用户可见体验还必须通过：

- 外部 Agent 单一确认面截图/轨迹对账；
- Nomi 项目内能找到 brief、script、storyboard、asset、job、timeline、export；
- 真实任务从一句话到产物可恢复；
- 不能用测试 fixture 自己制造 `approved`、`providerTaskId` 或 `pass`。

### 8.3 方案完成的定义

只有同时满足以下条件才算完成：

1. 封面/海报不再进入宣传片流程；
2. 叙事视频仍有剧本审阅点；
3. Skill 按 Workflow Stage 渐进加载，并在 artifact 中留下证据；
4. 时长、音频、参考输入全部由模型能力适配；
5. 外部 Agent 和 Nomi 不重复确认；
6. 用户可以调并发，单个失败不会重烧全批额度；
7. 真实黑盒轨迹和项目产物完整；
8. 至少一个 30 秒真实片通过抽帧、字幕、转场、音频和连续性验收；
9. 同一套合同能切换到 15 秒/60 秒或无时长的图片 Workflow。

---

## 9. 方案自审结论

- **为什么不直接再加一个 `asset-poster` Skill？** 因为只有 Skill 没有 Workflow kind，Router 仍会把图片误送进 Production Run；必须先建立统一路由和 Run policy。
- **为什么不把所有任务都画布化？** ComfyUI/InvokeAI 的图适合执行和探索，但 InVideo/LTX 证明叙事内容仍需要 script/storyboard/timeline 中间层；海报则不需要这些中间稿。
- **为什么不把所有审批删掉？** 剧本审阅决定事实和叙事，生成授权决定真实额度，粗剪确认决定最终可见产物；删掉它们会降低可恢复性和质量。可删的是低风险重复门，不是关键门。
- **为什么不把 Seedance 固定成视频模型？** 当前档案已经证明不同模型对时长、音频、首尾帧和参考数量的约束不同；固定模型会把合法能力差异藏起来，最终表现为 400、白帧、无声音或错误参考。
- **为什么先零额度合同再真实媒体？** 之前的真实运行已经证明 provider 慢、网络轮询和 UI 审批都会暴露根因；先验证路由、审批和恢复，才能避免把额度花在错误 Workflow 上。

---

## 10. 执行交接

本计划保存后，执行顺序固定为批次 A → B → C → D → E → F。每个 Task 按“红测 → 最小实现 → 定向测试 → 全门 → commit”推进；任何真实媒体调用必须等批次 E 的零额度合同和用户明确的额度授权通过后才允许发生。
