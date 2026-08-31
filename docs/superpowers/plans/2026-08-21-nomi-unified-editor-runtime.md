# Nomi 统一创作运行时与 AI 剪辑工作台实施方案

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 Nomi 统一成一个可路由的创作运行时：生成类 Workflow 负责产出资产，Editor Workbench 负责可预览、可撤销、可恢复的剪辑，Claude Code/Codex/WorkBuddy 与 Nomi 右侧 Agent 共用同一套命令、Run、审批和项目产物。

**Architecture:** 保留一个 `ProductionRun` 事实源和一个编辑事实源 `EditorDocument`。`WorkflowDefinition` 决定当前任务需要哪些阶段、Skill、模型能力、审批和并发；`EditorCommandBus` 是时间轴唯一写入口；Agent 只能生成 `EditProposal`，不能直接改 Store；生成、转码、渲染和导出复用 `ProductionRun`，先在付费前编译 `DraftExecutionSnapshot`，审批后 seal 成不可变 `ExecutionSnapshot`。

**Tech Stack:** Electron + React 18 + TypeScript + Zustand + Zod + Vercel AI SDK + FFmpeg + Vitest + Playwright；继续复用现有 `AssetRef`、Timeline 纯函数、Canvas Proposal transaction、ProductionRun、MCP elicitation 和 Render Manifest。HyperFrames 与 Remotion 都通过同一个 `MotionGraphic` 合同接入：HyperFrames 是 Agent 生成 HTML/CSS/GSAP/MJ 图像动画的首选动态合成 adapter，Remotion 是 React 组件 adapter；二者都不能拥有第二套 Nomi 时间轴、项目状态或审批。HyperFrames 的合同和 Skill 路由在零额度阶段先落地，真正 smoke/render 在 EditorCore 稳定后做垂直闭环。

**Non-goals:** 不把 30 秒写成全局常量；不把封面、海报强行走剧本/分镜；不做完整 Premiere/CapCut 竞品；不增加第二个 Editor Store、第二个 Run 或第二个审批状态机；不在本计划的零额度阶段调用 provider；不允许 Agent 任意写文件、网络或 Electron API。

**Canonical plan notice:** 本文件是本轮归一后的唯一执行入口，覆盖并替代 `2026-08-21-agent-editor-workbench.md`、`2026-08-21-unified-workflow-runtime.md`、`multi-workflow-generation-routing.md`、`2026-08-21-agentic-production-draft-film.md`、`2026-08-21-real-30s-continuity-acceptance.md`、`2026-08-21-external-agent-single-approval.md` 和 `2026-08-21-blackbox-human-approval-next-round.md` 中相互重叠的实施顺序；后四份保留为验收 fixture/历史证据，不能作为新的架构入口。已批准的产品基线仍是 `docs/superpowers/specs/2026-08-08-agentic-production-experience-design.md`。

---

## 0. 先用一句话理解这套系统

用户说的是目标，Nomi 先判断“这是哪种工作”，再用对应 Workflow 组织 Skill、模型、审批和产物：

```text
用户一句话
   ↓
Workflow Router
   ↓
生成资产 / 读取已有素材 / 进入编辑器
   ↓
AssetRegistry
   ↓
EditorCommandBus → EditProposal → 用户确认
   ↓
EditorDocument（时间轴唯一事实源）
   ↓
Preview / Render Manifest / Export
```

上层 Workflow Runtime 和下层 Editor Workbench 的分工固定为：

| 层 | 负责什么 | 不负责什么 |
|---|---|---|
| Workflow Runtime | 路由、阶段、Skill、模型能力、预算、审批、并发、恢复 | 不直接改时间轴 |
| ProductionRun | 异步 Job、Provider task、成本、事件、重试、恢复 | 不拥有第二条时间轴 |
| AssetRegistry | 资产身份、版本、来源、父子关系、生命周期 | 不决定资产在时间轴上的位置 |
| EditorCommandBus | 时间轴插入、删除、裁剪、移动、字幕、音频、转场、替换 | 不调用 Provider |
| EditorDocument | 当前剪辑事实、revision、时间轴和资产绑定 | 不保存聊天历史或 Provider 状态 |
| Render Manifest | 从 EditorDocument 派生预览/导出输入 | 不反向修改编辑状态 |
| MCP / Nomi Agent | 读取状态、提出计划、触发同一命令和审批 | 不维护自己的 Run 或 timeline |

---

## 1. 调研依据与固定决策

### 1.1 读过的顶尖实现

- [LangGraph interrupts](https://langchain-ai.github.io/langgraph/how-tos/human_in_the_loop/breakpoints/)：checkpoint、interrupt、resume；Nomi 用于审批和崩溃恢复。
- [OpenHands Skills](https://docs.openhands.dev/overview/skills)：公共规则常驻，专项 Skill 按阶段渐进加载；Nomi 不把二十多个导演 Skill 一次灌入上下文。
- [ComfyUI server routes](https://docs.comfy.org/development/core-concepts/route_overview)：工作流先校验，再形成不可变执行请求，进入队列并按 task/history 回读；Nomi 用于 `ExecutionSnapshot`。
- [InvokeAI Workflow API](https://github.com/invoke-ai/InvokeAI/blob/main/docs/src/content/docs/development/Guides/workflow-api.mdx)：保存的 Workflow 和可执行 Graph 分开，结果先进入 staging；Nomi 用于“候选→采用→提交”。
- [MCP Tools](https://modelcontextprotocol.io/specification/2025-11-25/server/tools)、[Resources](https://modelcontextprotocol.io/specification/2025-11-25/server/resources)、[Elicitation](https://modelcontextprotocol.io/specification/2025-11-25/client/elicitation)：Tool 做动作、Resource 读内容、Elicitation 做唯一外部确认；MCP Tasks 只做传输层异步包装。
- [InVideo storyboard](https://help.invideo.io/en/articles/14754413-creating-storyboards-with-invideo)：先锁角色/灯光，再选单帧进入视频；Nomi 不整板重生成。
- [LTX Studio](https://ltx.studio/platform/ai-video-generator)：script→scene→shot→timeline；Nomi 保留叙事中间层，但区分 Studio 项目层与模型 API 层。
- [Canva MCP transactions](https://www.canva.dev/docs/mcp/verify-integration/)：候选生成、用户选择、transaction edit、commit、export；Nomi 用于批量资产和局部 patch。
- [HyperFrames README](https://github.com/heygen-com/hyperframes#readme)、[HTML schema](https://hyperframes.app/docs/6-reference/html-schema)、[Core](https://github.com/heygen-com/hyperframes/blob/main/packages/core/docs/core.md)：HTML 是动态视觉 composition 的源文件，`data-*` 声明时间/轨道，脚本负责可 seek 的动画，框架负责媒体播放和逐帧渲染；Nomi 用于可编辑的 MotionGraphic artifact，不用于替代 Nomi Timeline。
- [HyperFrames review loop](https://github.com/heygen-com/hyperframes/blob/main/skills/hyperframes-core/references/review-loop.md)、[production loop](https://github.com/heygen-com/hyperframes/blob/main/skills/hyperframes-core/references/production-loop.md)：plan→sketch→build→final look 与 blocks/audio/frames/assembly/transitions/captions/verify 的依赖关系；Nomi 借检查和阶段依赖，但不再复制一套 BRIEF/STORYBOARD/Studio 状态。
- [Runway Workflows with Agent](https://help.runwayml.com/hc/en-us/articles/53645211363475-Building-and-running-Workflows-with-Agent)、[LTX Flows](https://ltx.io/blog/ltx-studio-flows)、[InvokeAI Canvas workflow](https://invoke.ai/features/canvas/run-workflow/)：Skill 是会话方法，Workflow 是可保存/重跑/局部重跑的执行资产，结果先 staging 后 Adopt；这是 Nomi 归一 `WorkflowDefinition`、`SkillPack`、`StagingResult` 的依据。
- [本轮 Nomi 论文雷达](/Users/aoqimin/Desktop/Nomi-production-pipeline/docs/research/2026-08-22-radar.md)：EntityBench/InfinityStory/ShotStream/VEBench/VABench/Spotlight/MEDit-Bench 对实体记忆、镜间承接、编辑指令遵从、音画同步和时间定位 QA 的启发，已转成 PromptSpec、ExecutionSnapshot 与 J10/J11/J5 验收项。
- [Workflow/Skill 外部实现矩阵](/Users/aoqimin/Desktop/Nomi-production-pipeline/docs/research/2026-08-22-workflow-skill-matrix.md)：逐项记录 OpenChatCut/OpenScene/Dawn-Cut/OpenKlip/Runway/LTX/InvokeAI/ComfyUI/HyperFrames/MCP/OpenReelio/Crayotter，以及本地/外部 Skill 的 adopt/defer、文件锚点和可执行验收；它是本轮“调研过但不盲搬”的审计表。
- [Nomi 视频生产工作流审计](/Users/aoqimin/Desktop/Nomi/docs/research/2026-08-20-video-production-workflow-audit.md)：已发现 storyboard→canvas→batch 中 `ffDesc/lfDesc/variationType/camIdx/continuity` 蒸发、shot→shot 状态不接力、语言/污染词检查未接生产；本方案用 `StoryboardExecutionReconciliation`、handoff artifacts、snapshot bindings 和 pair-level QA 修复，而不是再堆 Prompt。
- [Nomi MCP 体验调研](/Users/aoqimin/Desktop/Nomi/docs/research/2026-08-11-mcp-experience-research.md)：Claude/Codex CLI 与富 UI host 能力不同；MCP Apps 是增强项，不是必需依赖，文本 host 必须拿到可转述摘要、progress、resource link 和一次 Nomi takeover。

### 1.2 方案固定决策

1. **一个 Runtime、多个 Workflow。** `asset.single`、`asset.batch`、`asset.edit`、`video.generate`、`canvas.explore`、`motion.graphics`、`narrative.production`、`edit.assemble` 共用一套底层运行时。`brand.promo` 与 `drama.short` 只是可迁移的 recipe/alias，不再各自拥有 driver。`motion.graphics` 是用户任务路由，不是“HyperFrames 专属 Runtime”；它可以选择 HyperFrames、Remotion 或明确指定的其它 renderer。
2. **EditorDocument 只作为编辑工作台的事实源。** Generation Canvas 仍保存生成关系，ProductionRun 仍保存异步任务；三者通过 `assetId`、artifact version 和 run binding 连接。
3. **第一阶段不重写 Timeline。** 先让 `EditorCommandBus` 适配现有 `TimelineState` 和 `workbenchStore`；迁移为更完整的 EditorDocument 只在兼容测试通过后进行。
4. **AssetRef 不另造平行身份。** 扩展现有 `src/workbench/assets/assetTypes.ts`，用 `assetId` 作为时间轴主引用，`sourceNodeId` 保留为来源和兼容字段。
5. **Agent 只写 Proposal。** UI、内置 Agent、外部 MCP 都通过 `EditorCommandBus`；没有任何入口可以直接改 Timeline Store。
6. **生成结果先成为 Asset，再通过 Proposal 插入时间轴。** Provider 成功不等于用户接受；失败、取消、重试和替换均保留父子关系。
7. **模型按能力选，不按宣传片名称选。** 时长、音频、参考图、画幅、Key 状态和并发上限由 Model Capability Resolver 决定。
8. **外部 Agent 是主确认面。** MCP client 支持 elicitation 时，正常审批只在 Agent 中发生；Nomi 只镜像状态，GUI 只作为 takeover/reconcile。
9. **低风险剪辑和高风险生成分开。** 删除停顿可以一笔 EditProposal；生成新镜头必须经过 spend gate；导出前保留最终粗剪确认。
10. **预览和导出必须从同一个 Render Manifest 派生。** 不再从当前窗口或当前 Zustand 的偶然状态拼导出请求。

### 1.3 Workflow、Skill、Renderer 的边界（本次重新归一）

你提供的调研和 HyperFrames 官方实现共同证明，四个词不能混用：

| 东西 | 通俗解释 | 在 Nomi 中的事实 | 不能做什么 |
|---|---|---|---|
| `WorkflowDefinition` | “这类任务要经过哪些步骤” | 可保存、可重跑、可版本化的阶段图/输入/输出/审批/缓存/恢复合同 | 不直接写时间轴、不等于一段 Prompt |
| `SkillPack` | “这一步应该怎么想、怎么检查” | 带版本、hash、输入/输出合同、检查项和加载证据的方法包 | 不拥有 Run、资产或时间轴 |
| `RendererAdapter` | “把已经批准的结构画出来” | FFmpeg、HyperFrames、Remotion、模型 provider 的能力适配器 | 不决定用户的剪辑事实、不自行审批 |
| `ProductionRun` | “何时执行、花了多少、失败如何恢复” | 唯一的任务、预算、provider task、重试、事件事实源 | 不再造第二个 HyperFrames/Agent Run |

固定链路：

```text
Intent / Route
  → Brief / Plan
  → WorkflowDefinition
  → 按阶段加载 SkillPack
  → Capability Preflight + Draft Execution Snapshot
  → Proposal / 唯一审批面
  → ProductionRun 执行
  → Staging（候选预览）
  → EditorCommandBus Adopt
  → Render / Export
```

HyperFrames 自己的 Skill 体系是这条边界的一个好范例：总入口负责一次路由并写入 brief，`motion-graphics` 是短动效路线，`hyperframes-core` 负责 HTML/data-* 时间合同，`hyperframes-animation` 负责 seek-safe 动画，`hyperframes-creative` 负责视觉方向，`hyperframes-cli` 负责 lint/check/preview/render；这些 Skill 按需加载，不能变成 Nomi 的二十个用户审批点。Nomi 借它的分层和检查证据，不复制它的 BRIEF/STORYBOARD/Studio 状态为第二套项目事实。

### 1.4 外部 Skill 的采用策略：不是全搬，也不是闭门自写

你提供的 OpenChatCut/OpenScene/Dawn-Cut/OpenKlip、Runway/LTX/Canva、HyperFrames 和本地各类 Skill 的共同答案是：**外部 Skill 可以作为知识和方法来源，但不能未经审查直接成为 Nomi 的执行权限。** 我们采用三层：

| 层级 | 用户是否看见 | 例子 | 进入方式 | 权限 |
|---|---|---|---|---|
| Core policy skill | 通常不看见，结果体现在行为上 | 资产血缘、PromptSpec、模型能力、视觉 QA、音频探针、费用/安全 | Nomi 内置、版本化、每次 Run 记录 hash | 可读上下文 + 产出检查，不直接写状态 |
| User-facing recipe/style pack | 用户选择“目标/风格”，不需要懂 Skill 名称 | 口播紧凑剪辑、产品发布、纪录片克制、科技 HUD、MJ 图像轻推镜、品牌字卡 | `TemplateDefinition`/style cards，选择后编译成 SkillPack 组合 | 只能影响计划/视觉语言/检查阈值，不能扩大工具权限 |
| Imported/community skill | 高级用户显式安装/启用 | 外部仓库的 prompt、转场、动效、题材方法论 | `skill-author` 转写 → license/hash/静态扫描 → sandbox → golden tests → 用户启用 | 默认 read-only；不得自动拿到 provider、文件、网络或导出权限 |

用户界面不展示二十个开关，而展示三个可懂的选择：

1. **要做什么**：封面、已有素材剪辑、叙事片、动态视觉单元等（Workflow）；
2. **想要什么感觉**：例如“纪录片克制 / 科技产品 / 轻快 UGC / MJ 图像电影化”（Recipe/Style Pack）；
3. **要不要自主**：快速草稿、每次确认、只确认花费（RunPolicy）。

Prompt 专家、摄影专家、转场专家、字幕专家等由系统在后台按阶段组合；只有当多个方向确实会改变结果时，才以 2–4 张风格卡或一个代表样片让用户选择。这样既吸收别人的 Skill，又不把学习成本转嫁给用户。

采用外部 Skill 的硬门：许可证可核验、来源/版本/hash 可追溯、输入输出 schema、工具白名单、无任意网络/文件/命令、golden fixture 和独立 QA；无法满足的只能作为研究参考，不能进入正式 Workflow。Skill、Workflow、Template、Renderer 四者在轨迹里分别记账。

可持久化的 Recipe/Template 合同：

```ts
export type TemplateDefinition = {
  templateId: string
  version: number
  workflowKind: WorkflowKind
  exposedInputs: string[]
  defaultSkillRefs: string[]
  designTokens?: string
  qualityProfile: string
  approvalDefaults: { review: 'none' | 'sample' | 'stage'; spend: 'none' | 'once' | 'batch' }
  source: { origin: 'builtin' | 'project' | 'user'; contentHash: string; license?: string }
}
```

`brand.promo`、`drama.short` 迁移为 `TemplateDefinition`/alias；旧的 15–30 秒、9:16、四段 pause、固定镜头数只作为可编辑默认值。Registry parity test 必须证明 alias 能编译成合法 `WorkflowDefinition`，而不是创建空 Run。

---

## 2. 当前代码事实与必须修的根因

### 2.1 当前可复用的基础

- 时间轴纯函数：[`src/workbench/timeline/timelineEdit.ts`](/Users/aoqimin/Desktop/Nomi/src/workbench/timeline/timelineEdit.ts)、[`timelineMath.ts`](/Users/aoqimin/Desktop/Nomi/src/workbench/timeline/timelineMath.ts)。
- 当前持久化状态：[`src/workbench/workbenchStore.ts`](/Users/aoqimin/Desktop/Nomi/src/workbench/workbenchStore.ts) 和 [`workbenchPersistence.ts`](/Users/aoqimin/Desktop/Nomi/src/workbench/workbenchPersistence.ts)。
- 资产引用底座：[`src/workbench/assets/assetTypes.ts`](/Users/aoqimin/Desktop/Nomi/src/workbench/assets/assetTypes.ts)，已经区分 render URL 和传输来源。
- 画布提案事务：[`proposalTxn.ts`](/Users/aoqimin/Desktop/Nomi/src/workbench/generationCanvas/agent/proposalTxn.ts)、[`proposalUndo.ts`](/Users/aoqimin/Desktop/Nomi/src/workbench/generationCanvas/agent/proposalUndo.ts)。
- Agent 流式、取消和工具确认：[`workbenchAgentRunner.ts`](/Users/aoqimin/Desktop/Nomi/src/workbench/ai/workbenchAgentRunner.ts)。
- MCP/ProductionRun 已有 event、CAS、artifact、elicitation 和 provider reconcile 基础。

### 2.2 当前根因

| 优先级 | 根因 | 用户后果 | 方案修复 |
|---|---|---|---|
| P0 | Skill manifest、Production registry、driver 不是同一事实源 | 新 Workflow 只能继续手改 driver；封面可能误入宣传片 | `WorkflowDefinition` 统一注册、路由和阶段 |
| P0 | Timeline UI 直接写 `workbenchStore`，Agent 另走 Canvas transaction | 两套写入口，无法统一 Diff、审批和撤销 | `EditorCommandBus` 适配现有 Store |
| P0 | 生成结果和时间轴没有稳定资产身份 | 同一节点多个结果混淆，局部替换困难 | `assetId` 主引用 + `sourceNodeId` 兼容来源 |
| P1 | Storyboard/画布改动可能影响已提交 Job | 运行中 prompt、模型、参考图偷换 | 付费前编译 `ExecutionSnapshot` |
| P1 | 音频、字幕、转场在 Timeline 中已有字段，但 Render Manifest 仍偏向 image/video | 用户看到有字幕/音频，导出可能丢失 | 统一 Render Manifest 并做真实 probe |
| P1 | driver 和模型默认仍有宣传片/Seedance/5 秒隐式假设 | 封面、海报、不同模型无法复用 | Workflow Policy + Model Capability Resolver |
| P1 | 外部 MCP 和 Nomi UI 容易重复确认 | 用户在两个软件之间来回切换 | 单一 approvalId、single approval surface |
| P0 | storyboard→canvas→batch 会丢 `ffDesc/lfDesc/variationType/camIdx/continuity`，且没有 shot→shot 状态接力 | 每镜单看合格，连起来像拼接；重试时又回到错误输入 | `StoryboardExecutionReconciliation` + handoff artifact + snapshot hash + pair-level transition/QA |
| P0 | HyperFrames/Remotion 只有开发侧 Skill/未来计划，尚未成为 Nomi 的运行时合同 | MJ 图像动画、标题、Logo、HUD 只能被压成普通视频，失去可编辑性 | 先固定 `MotionGraphicArtifact`/`RendererAdapter`/Skill evidence，再做 HyperFrames 垂直闭环 |
| P1 | 动态花字渲染器尚未是时间轴一等对象 | 花字修改可能整片重渲染 | `motion.graphics` Workflow + MotionGraphic timeline item + 局部重渲染 |

---

## 3. 用户路径与审批设计

### 3.1 封面单图 `asset.single`

```text
用户：帮我做一张 9:16 的 Nomi 视频封面，保留产品截图
→ Router 选择 asset.single
→ 读取封面/品牌 Skill
→ preflight 画幅、参考图、模型和成本
→ 一次 spend approval
→ 生成 1–4 个候选
→ 用户选择/采用
→ AssetRecord 落项目资产
```

不创建 script、storyboard、timeline。

### 3.2 批量海报 `asset.batch`

```text
品牌规范 + 6 个产品卖点
→ 生成 1 张样片
→ 一次批次授权（数量、预算、并发）
→ 独立 item jobs，可并发
→ 每张 candidate/adopted/rejected
→ 失败只 retry 失败 item
```

`maxConcurrentJobs` 用户可设置 1/2/3；已经 adopted 的 item 不得因为其它 item 失败而重烧。

### 3.3 本地素材剪辑 `edit.assemble`

```text
导入素材/已有时间轴
→ Agent 读取选区、转录、音频和时间轴窗口
→ 生成 EditProposal
→ 用户看到 Diff、受影响区间和时长变化
→ EditorCommandBus 应用
→ 预览/字幕/音频/转场更新
```

不创建剧本或 StoryboardPlan。

### 3.4 叙事视频 `narrative.production`

```text
Brief
→ 方向确认
→ 剧本审阅（保留）
→ 分镜审阅（按 workflow policy，可折叠但不能静默跳过）
→ materialize 到画布
→ 一次预算/并发授权
→ ExecutionSnapshot
→ 资产/首帧/视频 Job
→ QA
→ EditorDocument / Timeline
→ 粗剪确认
→ 导出
```

30 秒只是 `targetDurationSeconds`，不是系统常量。每个 Job 同时记录 requested/legal/actual duration。

### 3.5 外部 Agent 与 Nomi 内部 Agent

两者调用相同的 `ProductionRunService`、`EditorCommandBus` 和 approval record：

```text
Claude/Codex/WorkBuddy
       │ MCP tools/resources/elicitation
Nomi MCP dispatcher
       │
ProductionRun / EditorCommandBus
       │
Nomi 项目 artifact + timeline + export
```

Nomi 右侧 Agent 不是第二个系统，只是同一命令的内部 surface。MCP 不支持 elicitation 时才允许 Nomi UI takeover；takeover 不新建 approval。

### 3.6 审批矩阵

| Workflow | 保留的确认 | 可以合并的确认 | 不创建的确认 |
|---|---|---|---|
| asset.single | 一次 spend，候选采用可选 | 多候选选择可并入结果卡 | 剧本/分镜/粗剪 |
| asset.batch | 一次 batch spend，批量结果选择 | 样片确认可并入批次授权 | 每张单独 spend |
| asset.edit | 一次 spend，patch 预览 | 生成和采用可在同一 Proposal 卡 | 剧本/分镜 |
| canvas.explore | 候选冻结 | 分支选择和冻结可一并确认 | Production spend |
| motion.graphics | 一次 style/sample + render preview（已有品牌配方时可跳 sample） | 付费图像/音频输入的 spend 可与 Adopt 合并；从叙事/剪辑调用时复用原 approvalId | 剧本/分镜、逐个 motion clip 审批 |
| narrative.production | 剧本、分镜、预算、粗剪 | 方向候选和方向确认可一次 elicitation | 每个内部 reducer 再问一次 |
| edit.assemble | EditProposal、粗剪/导出 | 粗剪确认和导出可在用户选择快速模式时合并 | 重新生成所有素材 |

---

## 4. 统一数据合同

### 4.1 WorkflowDefinition

**Create:** `electron/productionRun/productionWorkflowTypes.ts`

```ts
export type WorkflowKind =
  | 'asset.single'
  | 'asset.batch'
  | 'asset.edit'
  | 'video.generate'
  | 'canvas.explore'
  | 'motion.graphics'
  | 'narrative.production'
  | 'edit.assemble'

export type WorkflowDefinition = {
  kind: WorkflowKind
  version: number
  approvalSurface: 'agent-elicitation' | 'nomi-ui' | 'mixed'
  stages: Array<{
    id: string
    semantic: 'intake' | 'direction' | 'script' | 'script_review' | 'storyboard' | 'storyboard_review' | 'motion' | 'audio' | 'captions' | 'transitions' | 'generate' | 'edit' | 'qa' | 'assemble' | 'export'
    dependsOn: string[]
    handlerId: string
    skillRefs: string[]
    toolAllowlist: string[]
    rendererRefs?: string[]
    exposedInputs?: string[]
    inputArtifacts: string[]
    outputArtifacts: string[]
    outputBindings?: string[]
    requiredCapabilities?: string[]
    checks: string[]
    executor: 'agent' | 'provider' | 'renderer' | 'qa' | 'command_bus'
    approval: 'none' | 'candidate' | 'script_review' | 'storyboard_review' | 'spend' | 'stage' | 'rough_cut' | 'export'
    optionalWhen?: string
    rerunScope?: 'stage' | 'dirty_subgraph' | 'job' | 'clip' | 'run'
    concurrency?: { default: number; max: number; userAdjustable: boolean }
  }>
  gates: Array<{
    id: string
    stageId: string
    decisionKind: 'creative' | 'script_review' | 'storyboard_review' | 'spend' | 'sample' | 'rough_cut' | 'export'
    target?: { artifactKind?: string; artifactIdExpr?: string; scope?: 'run' | 'stage' | 'artifact' | 'job_set' }
    approvalMode: 'none' | 'user_review' | 'spend' | 'publish'
    policyHash: string
    dependsOn?: string[]
  }>
  intakePolicy?: { maxQuestions: number; runShape: 'linear' | 'dag' | 'neither'; complexity?: 'simple' | 'complex' }
  durationPolicy?: { targetDefault?: number; min?: number; max?: number; source: 'brief' | 'profile' | 'capability' | 'recipe' }
  audioPolicy: 'off' | 'if_supported' | 'required' | 'separate_track'
  optionalStages?: Array<{ stageId: string; when: string; skipReason: string }>
  cachePolicy?: { reuseUnchangedNodes: boolean; keyFields: string[] }
  allowedArtifacts: Array<'brief' | 'asset' | 'direction' | 'motionGraphic' | 'script' | 'storyboard' | 'promptSpec' | 'designSpec' | 'keyframe' | 'audioPlan' | 'audioArtifact' | 'executionSnapshot' | 'qaReport' | 'preview' | 'decision' | 'timeline' | 'export'>
}

export type NarrativeStageGraph = {
  stages: Array<{ id: 'direction' | 'script_draft' | 'script_review' | 'storyboard_draft' | 'storyboard_review' | 'sample' | 'spend_seal' | 'batch_generate' | 'shot_qa' | 'rough_cut' | 'audio' | 'captions' | 'transitions' | 'final_qa' | 'export'; dependsOn: string[]; inputKinds: string[]; outputKinds: string[]; gateId?: string }>
  invariant: 'script_adopted_before_storyboard' | 'sample_before_batch' | 'qa_before_export'
}

export type WorkflowInvocation = {
  parentRunId: string
  childRunId?: string
  workflowKind: WorkflowKind
  inputBindings: string[]
  outputBindings: string[]
  inheritedApprovalId?: string
  rollbackScope: 'child_artifacts' | 'parent_stage'
}

/**
 * These are the smallest machine contracts used by the compiler. They are
 * deliberately vendor-neutral: a model/renderer adapter may narrow them, but
 * may not invent a second capability or quality vocabulary.
 */
export type CapabilityProfile = {
  capabilityId: string
  version: string
  taskKinds: Array<'image' | 'video' | 'audio' | 'motion' | 'transcription' | 'render'>
  features: Array<'image_generate' | 'image_edit' | 'inpaint' | 'mask' | 'video_generate' | 'i2v' | 't2v' | 'first_last_frame' | 'tts' | 'music' | 'sfx' | 'depth' | 'segmentation' | 'captions' | 'alpha_overlay'>
  duration?: { minSeconds: number; maxSeconds: number; stepSeconds?: number }
  fps?: number[]
  aspectRatios?: string[]
  audio: { native: boolean; separateTrack: boolean; modes: Array<'native' | 'separate_track' | 'none'> }
  references: { roles: string[]; maxCount: number; supportsFirstFrame: boolean; supportsLastFrame: boolean }
  execution: { async: boolean; cancel: boolean; idempotent: boolean; maxConcurrent: number }
  cost?: { currency: string; estimateUnit: string; min?: number; max?: number }
  source: { catalogId: string; contentHash: string }
}

export type QualityCheckerProfile = {
  checkerId: string
  version: string
  contentHash: string
  checkIds: string[]
  thresholds: Record<string, number | string | boolean>
  maxIterations: number
  escalation: 'none' | 'recommend_human' | 'require_human'
  evidenceKinds: Array<'frame' | 'contact_sheet' | 'waveform' | 'ffprobe' | 'source' | 'timeline'>
}

export type QualityProfile = {
  profileId: 'cover' | 'batch' | 'motion' | 'narrative' | 'edit'
  version: string
  checkerProfiles: QualityCheckerProfile[]
  requiredChecks: string[]
  preferredDuration?: { minSeconds?: number; maxSeconds?: number }
  stopPolicy: { maxIterations: number; onMissingEvidence: 'blocked'; onUnknown: 'blocked' | 'human_review' }
  audio?: { required: boolean; loudnessLufsI?: { min?: number; max?: number }; truePeakDbtpMax?: number; maxSilenceRatio?: number; requireWordSync?: boolean }
}

export type RenderManifestV2 = {
  schemaVersion: 2
  projectId: string
  runId?: string
  editorSnapshotId: string
  timelineVersion: number
  manifestHash: string
  renderSettingsHash: string
  timebase: { fps: number; dropFrame: boolean; rounding: 'floor' | 'nearest' | 'ceil' }
  layers: Array<{
    kind: 'video' | 'image' | 'motionGraphic' | 'caption' | 'text' | 'effect'
    assetId?: string
    artifactId?: string
    trackId?: string
    zIndex: number
    alpha?: number
    blendMode?: 'normal' | 'screen' | 'multiply' | 'overlay'
    startFrame: number
    endFrame: number
    sourceStartFrame?: number
    sourceEndFrame?: number
    localToGlobalFrameMap?: { localStart: number; globalStart: number; fps: number }
    caption?: { text: string; styleToken: string; safeArea: string }
    transition?: { kind: string; durationFrames: number; handoffFrameHash?: string }
  }>
  audioTracks: AudioTrackBinding[]
  rendererAvailability: Array<{ renderer: string; available: boolean; version?: string; reason?: string }>
  muxPolicy: { audioCodec: 'aac' | 'wav' | 'none'; audioMode: 'native' | 'separate_track' | 'mute'; requireAudibleProbe: boolean }
}

export type AudioTrackBinding = {
  artifactId: string
  assetId: string
  trackId: string
  role: 'voice' | 'music' | 'sfx' | 'ambience' | 'mix'
  startFrame: number
  endFrame: number
  gainDb?: number
  ducking?: { under: 'voice' | 'dialogue'; amountDb: number }
}

export type MotionGraphicRenderer = {
  rendererId: string
  preflight(input: MotionGraphicCompileInput): Promise<{ status: 'ready' | 'baked' | 'blocked'; reasons: string[]; rendererReceipt: RendererReceipt }>
  compile(input: MotionGraphicCompileInput, signal?: AbortSignal): Promise<{ compositionHash: string; sourceHash: string; dependencyLockHash: string; rendererReceipt: RendererReceipt }>
  inspect(compositionHash: string): Promise<{ lint: Array<{ ruleId: string; message: string; sourceRef?: string }>; frameEvidence: string[] }>
  preview(compositionHash: string): Promise<{ artifactId: string; previewHash: string }>
  render(compositionHash: string, manifest: RenderManifestV2): Promise<{ assetId: string; renderHash: string }>
}

export type MotionGraphicCompileInput = {
  documentSnapshotId: string
  assetManifestHash: string
  designSpec: MotionDesignSpec
  themeTokensHash: string
  props: Record<string, unknown>
}

export type RendererReceipt = { runId: string; compositionHash?: string; dependencyLockHash: string; frameEvidence: string[]; sourceRef: string; rendererVersion: string }

export type ShotExecutionContract = {
  shotId: string
  narrativeGoal: string
  actionChain: string
  dramaticBeat: string
  continuityLocks: string[]
  ffDesc?: string
  motionDesc?: string
  lfDesc?: string
  variationType?: string
  camIdx?: number
  continuityIn: { mode: 'shared_anchor' | 'tail_to_head' | 'none'; predecessorShotId?: string; handoffFrameHash?: string }
  compiledPayloadHash: string
}

export type RunPolicy = {
  allowedProviders?: string[]
  allowedModels?: string[]
  maxSpend: number
  maxConcurrentJobs: number
  maxAttemptsPerJob: number
  trustLevel: 'confirm_all' | 'confirm_spend' | 'trusted'
  approvalSurface: 'agent-elicitation' | 'nomi-ui' | 'mixed'
  workflow: { spend: 'none' | 'once' | 'batch' | 'per_item' | 'per_shot'; review: 'none' | 'candidate' | 'stage' | 'per_item' | 'per_shot' }
}
```

**Route policy is part of the definition, not a provider prompt.** The default `motion.graphics` route is a short design-led unit (normally under 10 seconds, no narration, at most one clarification, `runShape: 'neither'`) and does not create script/storyboard artifacts. A request for semantic/physical movement (`motionIntent: 'semantic'`), multiple scenes, narration, or a duration outside the route profile is routed to `narrative.production` or `video.generate` instead. `layout`, `camera`, and `assetFusion` intents may use HyperFrames; semantic motion must use an image-to-video capability. The compiler records the reason and any skipped optional stages (`audio`, `transitions`, `captions`) rather than silently running or omitting them.

The `durationPolicy` is solved from brief + recipe + model capability (min/max/step, fps, audio mode, reference slots), then shown in preflight as requested/legal/actual duration. No Skill or Workflow may hard-code “30 seconds”, “6 shots”, or a provider model key. For review/spend/export gates, the resolved target must carry `artifactId + version + contentHash + baseRevision`; an empty or stale target is rejected before elicitation.

Renderer selection is capability-driven and recorded, not exposed as a raw engine toggle:

| Need | Preferred adapter | Boundary |
|---|---|---|
| mechanical cut, trim, mux, loudness mix | FFmpeg | deterministic media operation; no creative layout state |
| HTML/CSS/GSAP title, HUD, chart, MJ parallax/ken-burns/asset fusion, alpha overlay | HyperFrames | editable composition source + seek-safe preview/render; no global timeline ownership |
| existing React/TSX parameterized motion template | Remotion | component renderer only; no second editor state |
| person/object/water semantic movement | image-to-video provider | real media generation job with capability/credit/reconcile rules |

`RendererSelectionDecision` stores candidates, capability match, cost/latency/quality score, version, user override and fallback reason in the draft snapshot. `baked` is an explicit non-editable renderer outcome (with a warning and source renderer), while `blocked` is a preflight outcome; neither may be silently represented as HyperFrames/Remotion.

### 4.2 EditorDocument

第一阶段不重写现有 `TimelineState`，采用兼容包裹：

```ts
export type EditorDocument = {
  schemaVersion: 1 | 2
  projectId: string
  revision: number
  timeline: TimelineState
  assets: Record<string, AssetRecord>
  /** v2 only; v1 readers receive a timeline projection and must not discard this field. */
  motionGraphics?: Record<string, MotionGraphicArtifact>
  source: { timelineVersion: number; migratedFrom?: number }
}
```

v2 的 `timeline` projection 必须明确包含 `motionGraphicClips`（含 `trackId/zIndex/alpha/blendMode`），并将 `artifactId/version → adopted assetId → clip` 绑定写入同一个 revision。`MotionGraphicArtifact` 只保存局部 composition duration/fps/trim；全局 start/end 只由 `MotionGraphicClip` 保存，adapter 在编译时生成 local↔global frame map。v1 读取器可忽略该轨道但不得覆盖它；迁移、round-trip、移动 clip 不生成新的 source artifact 的测试是 P0。未来如需把 `tracks/captions/graphics` 提升为更通用的结构，只能通过新的 schema migration 完成，不能在 UI、导出和 Agent 中同时保留两套字段。

### 4.3 AssetRecord

基于现有 `AssetRef` 扩展，不创建平行 AssetRef：

```ts
export type AssetRecord = AssetRef & {
  role: 'source' | 'aiGenerated' | 'reference' | 'motionGraphic' | 'voice' | 'music'
  version: number
  provenance: {
    provider?: string
    model?: string
    prompt?: string
    parentAssetIds?: string[]
    sourceArtifactId?: string
    sourceArtifactVersion?: number
    createdBy: 'user' | 'agent' | 'system'
    estimatedCost?: number
    actualCost?: number
  }
  lifecycle: 'available' | 'processing' | 'failed' | 'archived' | 'missing'
}
```

### 4.3.1 MotionGraphicArtifact（HyperFrames/MJ 动画的正式合同）

这里的“MJ 动画”按输入能力理解为“由 Midjourney 或其它图像模型产生的静态图，再做可控的镜头运动/图形动效”，不把某个供应商写进编辑器协议。静态图先注册为普通 `AssetRecord`，动画本身是一个可版本化的 `MotionGraphicArtifact`，时间轴只引用它。

```ts
export type MotionGraphicArtifact = {
  artifactId: string
  version: number
  renderer: 'hyperframes' | 'remotion' | 'baked'
  compositionId: string
  sourceEditorRevision: number
  timelineVersion: number
  sourceAssetIds: string[]
  durationFrames: number
  fps: number
  width: number
  height: number
  props: Record<string, unknown>
  propsSchema: Array<{ key: string; type: 'text' | 'number' | 'color' | 'asset' | 'image' | 'video' | 'font' | 'boolean' | 'enum'; editable: boolean }>
  motionIntent: 'layout' | 'camera' | 'semantic' | 'assetFusion'
  designSpec?: MotionDesignSpec
  designSpecHash?: string
  output:
    | { kind: 'editable'; source: { bundleRef: string; mimeType: 'text/html'; compositionHash: string; dependencyLockHash: string }; derivative?: { assetId: string; version: number; mimeType: string; codec?: string; alpha?: boolean; previewUri?: string } }
    | { kind: 'baked'; sourceRenderer: string; warning: string; editable: false; derivative: { assetId: string; version: number; mimeType: string; codec?: string; alpha?: boolean; previewUri?: string } }
  frameMapping: {
    localFps: number
    globalFps: number
    localStartFrame: number
    localEndFrame: number
    trimStart?: number
    loop?: boolean
    localOffset?: number
    nestedCompositionIds?: string[]
  }
  source: { contentRef: string; contentHash: string; sanitizedCodeHash: string; dependencyLockHash: string }
  rendererVersion: string
  skillRefs: Array<{ key: string; version: string; contentHash: string }>
  validation: {
    lint: 'pending' | 'passed' | 'failed'
    deterministicSeek: 'pending' | 'passed' | 'failed'
    previewExportParity: 'pending' | 'passed' | 'failed'
    registeredAssetsOnly: 'pending' | 'passed' | 'failed'
    diagnostics?: string[]
  }
  previewArtifactId?: string
  renderManifestHash?: string
  status: 'candidate' | 'adopted' | 'failed' | 'archived'
}

// Nomi 时间轴里的对象，不是 HyperFrames 自己的 clip/timeline 状态。
export type MotionGraphicClip = {
  type: 'motionGraphic'
  assetId: string
  artifactId: string
  artifactVersion: number
  trackId?: string
  zIndex?: number
  alpha?: number
  blendMode?: 'normal' | 'screen' | 'multiply' | 'overlay'
  startFrame: number
  endFrame: number
  propsOverrides?: Record<string, unknown>
}
```

`output.source` is the editable composition; `output.derivative` is the adopted, playable asset. A clip references both deliberately: `artifactId/version` enables props/history/editing and `assetId` points to the adopted derivative used by the global timeline. Every render records a local↔global frame mapping, fps/trim/loop/offset, nested composition IDs, layer order (`trackId/zIndex/blendMode`) and alpha. Preview and export must consume the same mapping and `compositionHash`; a HyperFrames SDK persistence queue or local composition timeline is never a second Nomi project timeline.

固定边界：

- HyperFrames adapter 只做 `EditorDocument + RenderManifest + AssetRegistry → sanitized HTML composition`，再交给 Player/Producer 做预览和逐帧渲染；它不能直接改 Nomi 项目、审批或时间轴。
- `MotionGraphicClip` 通过 `EditorCommandBus` 插入/移动/修改；用户改文字、颜色、位置或时长时，只生成新的 artifact version 并局部重渲染该 clip，不重做原始视频。
- HyperFrames 的 HTML composition 是渲染源，不是 Nomi 的编辑事实；Nomi 的 `EditorDocument` 才决定它放在哪个轨道、哪一帧开始、与哪些视频/字幕/音频相邻。
- HyperFrames hosted MCP 不作为 Nomi 后端；Nomi 使用受控的本地/沙箱 adapter，所有渲染仍归 `ProductionRun` 的 render handler。

### 4.4 EditorCommand 与 EditProposal

```ts
export type EditorCommand =
  | { type: 'timeline.insert_asset'; assetId: string; trackType: 'image' | 'video' | 'audio'; startFrame: number; durationFrames?: number }
  | { type: 'timeline.replace_asset'; clipId: string; assetId: string }
  | { type: 'timeline.split'; clipId: string; atFrame: number }
  | { type: 'timeline.trim'; clipId: string; startFrame?: number; endFrame?: number }
  | { type: 'timeline.ripple_delete'; clipIds: string[]; closeGap: boolean }
  | { type: 'timeline.move'; clipIds: string[]; deltaFrames: number }
  | { type: 'timeline.set_framing'; clipId: string; patch: Partial<ClipFraming> }
  | { type: 'timeline.set_audio'; clipId: string; gainDb?: number; muted?: boolean }
  | { type: 'timeline.set_transition'; leftClipId: string; rightClipId: string; kind: 'cut' | 'fade' | 'dissolve' | 'match_cut' | 'whip_pan'; durationFrames: number }
  | { type: 'timeline.upsert_text'; clip: TimelineTextClip }
  | { type: 'timeline.remove_text'; clipId: string }
  | { type: 'timeline.insert_motion_graphic'; assetId: string; artifactId: string; artifactVersion: number; derivativeHash: string; compositionHash: string; startFrame: number; endFrame: number; trackId?: string; zIndex?: number }
  | { type: 'motion.propose_props_patch'; clipId: string; artifactId: string; artifactVersion: number; propsPatch: Record<string, unknown> }
  | { type: 'motion.adopt_rendered_version'; clipId: string; artifactId: string; artifactVersion: number; assetId: string; compositionHash: string }
  | { type: 'timeline.remove_motion_graphic'; clipId: string }
  | { type: 'timeline.insert_generation_result'; jobId: string; assetId: string; assetVersion: number; expectedJobArtifactHash: string; trackType: 'image' | 'video' | 'audio'; startFrame: number; durationFrames?: number }

export type EditProposal = {
  proposalId: string
  projectId: string
  baseRevision: number
  commands: EditorCommand[]
  summary: string
  affectedClipIds: string[]
  diff: Array<{ kind: 'add' | 'remove' | 'change'; label: string; before?: string; after?: string }>
  estimatedCost: number
  estimatedDurationMs?: number
  approval: {
    kind: 'none' | 'editor_apply' | 'spend'
    surface: 'agent-elicitation' | 'nomi-ui' | 'mixed'
    approvalId?: string
  }
  status: 'draft' | 'approved' | 'committed' | 'rejected' | 'aborted' | 'needs_recovery'
}
```

### 4.5 ExecutionSnapshot

Provider 第一次提交前固定：

```ts
export type ExecutionSnapshot = {
  schemaVersion: 1
  snapshotId: string
  runId: string
  status: 'draft' | 'sealed' | 'executing' | 'completed' | 'aborted'
  editorRevision?: number
  timelineVersion?: number
  assetManifestHash: string
  capabilitySnapshotHash: string
  sourceArtifactId?: string
  sourceArtifactVersion?: number
  sourceArtifactHash?: string
  planHash: string
  policyHash: string
  promptSpecHash?: string
  compiledPromptHash?: string
  promptCompilerVersion?: string
  providerAdapterVersion?: string
  durationResolution?: {
    requestedRange?: { minSeconds?: number; maxSeconds?: number; preferredSeconds?: number }
    legalRange: { minSeconds: number; maxSeconds: number; stepSeconds?: number }
    selectedSeconds: number
    actualSeconds?: number
    rounded: boolean
    reason: string
    sourceRefs: string[]
  }
  jobs: Array<{
    jobId: string
    clipId?: string
    shotId?: string
    provider: string
    modelKey: string
    taskKind: string
    prompt: string
    requestedDurationSeconds?: number
    legalDurationSeconds?: number
    actualDurationSeconds?: number
    audioMode: 'native' | 'separate_track' | 'none'
    referenceRoles: string[]
    referenceAssetIds: string[]
    previousJobId?: string
    shotContractArtifactId?: string
    shotContractVersion?: number
    shotContractHash?: string
    promptSpecArtifactId?: string
    promptSpecVersion?: number
    promptSpecHash?: string
    continuityPolicy?: 'shared_anchor' | 'previous_shot' | 'none'
    transitionPlanArtifactId?: string
    transitionPlanVersion?: number
    qualityProfileId?: string
    qualityProfileVersion?: string
    rendererDecisionHash?: string
    compiledPayloadHash?: string
    memoryRefs?: { entityIds: string[]; sceneId?: string; styleId?: string; version: number; contentHash: string }
    idempotencyKey: string
  }>
}
```

### 4.6 Artifact ledger、音频计划与质量证据

所有中间稿都必须能在 Nomi 项目里被重新打开，而不是只留在 Agent 对话。`ArtifactRecord` 是统一目录的最小合同；`ProductionArtifact.kind` 由它投影，旧 run 通过 migration 保留未知字段而不伪造完成状态。

Owner 规则：`ProjectArtifactCatalog` 是 artifact 内容/版本/生命周期的唯一 owner；`AssetRegistry` 是媒体文件与 probe 的唯一 owner；`EditorDocument` 只保存不可变的 asset/artifact refs、timeline placement 和 manifest hash；`ProductionRun` 只保存 artifact IDs、stage/job index 和 event projection。旧 `ProductionRun.artifacts` 迁移为 catalog refs，driver 不得双写两处；`asset` kind 只是 catalog 中指向 AssetRegistry 的 provenance projection，不是第二个媒体库。catalog append-only 校验 parent DAG 无环、同 artifactId version 单调、adopt 必须 hash 精确匹配 candidate、retryOf 必须匹配父 job/artifact hash。

```ts
export type ArtifactRecord = {
  artifactId: string
  version: number
  /** Content kind; candidate/retry are lifecycle/attempt metadata, not a second content taxonomy. */
  kind: 'brief' | 'direction' | 'promptSpec' | 'designSpec' | 'script' | 'storyboard' | 'keyframe' | 'audioPlan' | 'audioArtifact' | 'executionSnapshot' | 'motionGraphic' | 'asset' | 'preview' | 'qaReport' | 'decision' | 'timeline' | 'export'
  projectId: string
  parentArtifactIds: string[]
  contentHash: string
  content: { kind: 'json' | 'text' | 'html' | 'binary'; schemaVersion: number; uri?: string; inlineRef?: string; contentHash: string; codec?: string }
  source: { workflowKind?: WorkflowKind; stageId?: string; runId?: string; jobId?: string; attempt?: number; retryOf?: string; skillRefs?: Array<{ skillId: string; version: string; contentHash: string }>; rendererRef?: string; createdAt?: string; createdBy: 'user' | 'agent' | 'system' }
  preview?: { uri: string; mimeType: string; expiresAt?: string }
  status: 'candidate' | 'adopted' | 'rejected' | 'failed' | 'archived'
}

export type ProjectArtifactCatalog = {
  projectId: string
  schemaVersion: number
  revision: number
  records: Record<string, ArtifactRecord>
  retention: { keepRejected: true; keepFailedEvidence: true; maxVersions?: number; userCleanupTombstones: true }
  index: { byRunId: Record<string, string[]>; byStageId: Record<string, string[]>; byParentId: Record<string, string[]> }
  read(projectId: string, artifactId: string, version?: number): Promise<ArtifactRecord>
  list(projectId: string, filter?: { kind?: ArtifactRecord['kind']; runId?: string; status?: ArtifactRecord['status'] }): Promise<ArtifactRecord[]>
}

export type AudioPlan = {
  voice?: { scriptArtifactId: string; voiceRef?: string; timing: 'natural' | 'word_aligned' }
  ambience?: Array<{ assetId?: string; description?: string; startFrame: number; endFrame: number; gainDb?: number }>
  music?: { assetId?: string; mood?: string; bpm?: number; startFrame: number; endFrame: number }
  ducking?: Array<{ under: 'voice' | 'dialogue'; amountDb: number; attackFrames: number; releaseFrames: number }>
  sync?: 'none' | 'beat' | 'caption' | 'word'
  sourceSkillRefs: Array<{ skillId: string; version: string; contentHash: string }>
}

export type AudioArtifact = {
  artifactId: string
  version: number
  sourcePlanId: string
  assetId: string
  trackId: string
  mode: 'native' | 'tts' | 'music' | 'sfx' | 'mix'
  startFrame: number
  endFrame: number
  sampleRate: number
  channels: number
  timingHash?: string
  actualDurationSeconds?: number
  actualCodec?: string
  muxStatus: 'pending' | 'muxed' | 'audible' | 'blocked'
  mixPolicy: { codec: 'aac' | 'wav' | 'none'; ducking?: AudioPlan['ducking']; loudnessTargetDb?: number }
  status: 'candidate' | 'adopted' | 'failed' | 'archived'
}

export type QualityReport = {
  reportId: string
  artifactId: string
  checks: Array<{ id: string; severity: 'info' | 'warning' | 'error'; status: 'pass' | 'fail' | 'skipped'; finding: string; category?: 'black_frame' | 'continuity' | 'caption' | 'transition' | 'audio' | 'instruction' | 'layout' | 'security'; evidenceUris: string[]; confidence?: number }>
  frameEvidence: Array<{ uri: string; startFrame?: number; endFrame?: number; timelineFrame?: number; sourceMs?: number; hash: string }>
  audioEvidence?: { waveformUri: string; meanDb?: number; peakDb?: number; silenceRatio?: number; syncFindings?: string[] }
  humanEscalation: 'none' | 'recommended' | 'required'
  checkerVersions: Array<{ id: string; version: string; contentHash: string }>
}

export type QualityGateResult = {
  status: 'pass' | 'fail' | 'blocked'
  requiredCheckIds: string[]
  optionalCheckIds: string[]
  checkResults: Record<string, { status: 'pass' | 'fail' | 'blocked'; evidenceHashes: string[] }>
  requiredFindingIds: string[]
  profile: 'cover' | 'batch' | 'motion' | 'narrative' | 'edit'
  reportId: string
  gateInputHash: string
  generatedBy: { checkerId: string; version: string; contentHash: string }
}
```

`director.sound`/music/voice 只能产 `AudioPlan` 或 `AudioArtifact`；它们的叙述不会被拼进视觉视频 prompt。导出必须显式声明 audio track/mux policy，不能再以“容器有 AAC”冒充有声。候选/失败/重试通过 `status`、`attempt`、`retryOf` 表达，不新增 `candidate`/`retry` 内容 kind。封面、动效、叙事视频各自选择不同 `QualityReport` checks；不使用一套“所有流程都抽 6 镜”的伪通用 QA。

叙事镜头还要有独立的故事与接缝合同，避免“每个镜头好看但整片像拼接”:

```ts
export type TransitionPlan = {
  fromShotId: string
  toShotId: string
  storyFunction: 'causal' | 'temporal' | 'spatial' | 'emotional' | 'contrast'
  kind: 'cut' | 'dissolve' | 'match_cut' | 'whip_pan' | 'cover' | 'custom'
  prelude?: string
  postlude?: string
  cutPoint?: number
  handoffFrameAssetId?: string
  handoffFrameHash?: string
}
```

`previousShotId/firstFrameRef` 只在 continuity policy 声明时才是依赖；独立镜头可以并发。声明了 handoff 的下一镜必须等上一镜 adopted + QA 通过，并在生成前 pair-lint、生成后 boundary evidence 验证。这样“不是所有镜头都依赖上一个镜头”成为可计算的 DAG，而不是一条默认串行链。

### 4.7 调度与能力选择合同

`ProductionRun` 使用依赖 DAG，而不是把所有镜头串成一条队列：无依赖的参考图/独立镜头/音频准备可以在 `RunPolicy.maxConcurrentJobs` 和 provider/model lane cap 内并发；有 `firstFrameRef`、`previousShotId` 或 handoff 依赖的镜头必须等待上游 adopted + QA 通过。每个 job 记录 `waveIndex`, `dependencyJobIds`, `queuedReason`, `reservationId`, `attempt`, `providerTaskId`；取消释放 reservation，未知 ETA 不显示假进度。

模型和 renderer 的选择都写入 `DraftExecutionSnapshot`：候选、能力匹配、成本、预计延迟、质量约束、用户 override、拒绝原因和 fallback。Resolver 消费 capability profile（时长 min/max/step、fps、比例、音频模式、参考槽、取消/异步语义），不从 Skill 正文读取 Seedance、30 秒或固定音频开关。

重试、恢复、对账只读取这个快照；编辑新版本只能创建新快照，不能修改旧 Job 的 prompt、模型、参考或合法时长。

---

## 5. 分阶段执行计划

### Task 0A：统一事实源、跨进程写入口与 DecisionRecord（P0 前置）

这是所有 UI、Workflow 和真实媒体任务之前的硬门。没有它，后续“唯一时间轴/唯一审批/唯一 Run”都只是口号。

**Files:**
- Create: `shared/editor/editorDocumentTypes.ts`
- Create: `shared/editor/editorCommandCore.ts`
- Create: `electron/editor/editorDocumentService.ts`
- Create: `electron/editor/editorDocumentRepository.ts`
- Create: `electron/editor/editorMutationReceipt.ts`
- Create: `electron/editor/projectLeaseService.ts`
- Create: `electron/productionRun/productionOutbox.ts`
- Create: `electron/productionRun/projectArtifactCatalog.ts`
- Create: `electron/capabilityCore/decisionRecord.ts`
- Create: `electron/capabilityCore/decisionRecordService.ts`
- Create: `src/desktop/editorBridge.ts`
- Modify: `electron/capabilityCore/dispatcher.ts`, `gateway.ts`, `mcpProtocol.ts`
- Test: `electron/editor/editorDocumentService.test.ts`, `decisionRecordService.test.ts`, `productionOutbox.test.ts`

- [ ] 定义唯一编辑 owner：main 的 `EditorDocumentService`；renderer 的 Workbench/Timeline/Canvas store 只能是 projection 或兼容读，不再作为外部 MCP 的写入口。
- [ ] 定义编辑 CAS：`editorRevision`、`documentHash`、`baseRevision`；两个客户端同时写时，旧 proposal 必须返回 stale，不得覆盖。
- [ ] 定义统一批准事实：

```ts
export type DecisionRecord = {
  decisionId: string
  targetType: 'gate' | 'proposal' | 'artifact'
  targetId: string
  targetVersion?: number
  targetHash?: string
  actorId: string
  actorRole: 'user' | 'human-simulator' | 'agent'
  surface: 'mcp-elicitation' | 'nomi-ui' | 'takeover'
  elicitationId?: string
  commandId: string
  policyHash: string
  decisionKind: 'review' | 'adopt' | 'spend' | 'apply' | 'export'
  decision: 'approved' | 'changes_requested' | 'rejected' | 'cancelled'
  createdAt: string
  expiresAt?: string
  revokedAt?: string
  revocationReason?: string
}

export type ReviewPacket = {
  gateId: string
  artifactId: string
  artifactVersion: number
  artifactHash: string
  kind: 'direction' | 'script' | 'storyboard' | 'sample' | 'rough_cut' | 'qa'
  requiredFields: string[]
  payload: { summary?: string; textUri?: string; previewUris?: string[]; contactSheetUri?: string; waveformUri?: string; findings?: string[]; cost?: number; model?: string }
  surfaceCapabilities: { text: boolean; image: boolean; video: boolean; audio: boolean; apps: boolean }
  fallback: 'inline' | 'resource_link' | 'nomi_deep_link'
  approvalId: string
}
```

- [ ] `ProductionGate`、`EditProposal.status`、`confirmPlan/confirmSpend`、MCP elicitation 都只能投影或创建 DecisionRecord；重复决策返回第一次 receipt，不重复消费。
- [ ] `planTrust/spendTrust` 只能缓存重新询问策略，不得扩大 DecisionRecord 的目标、预算、模型或版本范围。
- [ ] 定义跨域落地顺序：`job.ready → asset.registered → editor.apply.pending → EditorMutationReceipt.committed → job.adopted`；任何一步崩溃，启动恢复都能重放且不重复插入。
- [ ] 统一 `ProjectLeaseService.acquire/renew/release/assertOwner`，MCP 和 IPC 走同一个 lease；读取不受写 lease 影响。
- [ ] 对现有 `nomi_generate`、canvas tools、generation queue 和 gateway confirm 建立 legacy origin；正常 Workflow/Editor journey 不得把它们当成新的 ProductionRun 事实源。
- [ ] 统一旧枚举：`TrustLevel key_confirm|budget_only|confirm_all` 迁移为 `RunPolicy trusted|confirm_spend|confirm_all`；旧 `ProductionArtifact.kind` 迁移到 `ArtifactRecord.kind`（新增 promptSpec/designSpec/keyframe/audioPlan/motionGraphic/preview/qaReport/decision），未知旧值保留为 `legacy` 并阻断付费/导出，不能同时维护两套 approval/trust 语义。
- [ ] 对 raw `nomi_generate`、canvas.*、任意 `nomi_start_playbook` 做 public-tool black-box：正常新路径必须先 resolve Workflow→preflight→Proposal/Run；legacy 工具结果明确 `origin:'legacy'`，不计入统一旅程的预算、审批或完成证据。
- [ ] 先落零额度 `MotionGraphicArtifact` 合同和 `RendererAdapter` 接口；HyperFrames 只注册为 `rendererRef`/capability，不把本机 `/Users/.../.agents/skills` 目录误当成 Nomi runtime skill。
- [ ] 将 HyperFrames agent-side Skill 的 `hyperframes`、`hyperframes-core`、`hyperframes-animation`、`hyperframes-creative`、`hyperframes-cli` 映射成可验证的 `SkillPack` 记录（version/contentHash/read receipt）；运行时按 `motion.graphics` 阶段按需加载，缺 body/hash 直接 fail closed。
  - [ ] `ProjectArtifactCatalog` 作为 brief/direction/promptSpec/designSpec/script/storyboard/keyframe/audioPlan/audioArtifact/ExecutionSnapshot/QA/motion source/preview/decision/timeline/export 的唯一可寻址目录；候选/失败/重试由 lifecycle/status/attempt/retryOf 表达。MCP Resources、Nomi Task Center 和项目重开都从它读取，不另造聊天附件或 HyperFrames persistence。
- [ ] Catalog 由 main 持久化并提供 `list/read`、版本/CAS、retention 和旧 `ProductionArtifact` migration；故障注入后重开项目，外部 Agent 提交的 script/storyboard/preview/QA/motion source 仍能按 `projectId/runId/artifactId@version` 找到。
- [ ] 为仓库 24 个 markdown-only craft skill 生成最小 `legacy-read-only` manifest（含 source/license/hash/routeHints）；用户目录 `shot-breakdown`/`viral-video-producer` 先跑 capability report，缺 audio/obsolete tool/固定时长时显示 blocked，不得进入付费 stage。
- [ ] `skillInventory.json` 覆盖 origin/main 的 31 个 `SKILL.md` 与 7 个 manifest，为每项记录 `kind`（knowledge/workflow/route-adapter/check/connector/renderer）、route/stage、adopt/defer/legacy-read-only、source/hash/license；外部 `.agents/.codex` skill 只能登记为 source/overlay/connector，不能宣称已由 Nomi runtime 执行。

红测必须证明：

```ts
await service.applyProposal({ baseRevision: 3, idempotencyKey: 'x' })
await expect(service.applyProposal({ baseRevision: 3, idempotencyKey: 'y' })).rejects.toMatchObject({ code: 'editor_revision_conflict' })
expect(await service.applyProposal({ baseRevision: 3, idempotencyKey: 'x' })).toEqual(firstReceipt)
```

运行：`pnpm exec vitest run electron/editor electron/capabilityCore/decisionRecordService.test.ts electron/productionRun/productionOutbox.test.ts`

### Task 0：干净基线、样张和协议评审

**Files:**
- Create: `docs/design/agent-editor-workbench.md`
- Create: `docs/mockups/agent-editor-workbench.html`
- Create: `docs/superpowers/specs/nomi-unified-editor-contract.md`
- Test/inspect: current repository baseline

- [ ] 在基于 `origin/main` 的 sibling worktree 中记录 branch、HEAD、冲突和门禁基线；不在当前脏工作树上实施。
- [ ] 固定 baseline artifact `docs/audit/baseline-origin-main-d3bf0aba.md`：记录 `git show d3bf0aba:<path>` 的事实、`git status --short`、冲突/落后提交数，以及 filesize/tokens/i18n/lint/typecheck/test/build/e2e 命令的原始摘要；后续“已修复/已通过”必须与该基线区分。
- [ ] 所有 §2 的当前代码行号以 `origin/main=d3bf0aba` 的 `git show` 为准；当前脏 worktree 的修改只能标 historical/unverified，不能当完成证据。
- [ ] 阅读 `docs/design/nomi-design-system.md`、`TimelinePanel.tsx`、现有 Agent Panel、Production Run Task Card，画出真实壳层样张。
- [ ] 样张必须包含：空项目、选中片段、待确认 Proposal、生成中、失败可恢复五种状态。
- [ ] 在 `nomi-unified-editor-contract.md` 固化上面的五个数据合同和旧 Timeline 迁移规则。
- [ ] 评审未通过前不改用户可见 UI，不引入 Electron/Remotion。

**Acceptance:** 另一位工程师能从样张和协议复述“用户在哪儿看到提案、点什么确认、如何撤销、失败后回到哪里”。

### Task 1：WorkflowDefinition 与 Router

**Files:**
- Create: `electron/productionRun/productionWorkflowTypes.ts`
- Create: `electron/productionRun/productionWorkflowRegistry.ts`
- Create: `electron/productionRun/workflowRouter.ts`
- Modify: `electron/skills/skillManifestSchema.ts`
- Modify: `electron/skills/playbookOrchestrator.ts`
- Modify: `electron/productionRun/productionPlaybooks.ts`
- Create: `electron/productionRun/templateRegistry.ts`
- Modify: `electron/productionRun/productionRunDriverOps.ts`
- Create: `electron/productionRun/productionRunMigration.ts`
- Modify: `electron/productionRun/runQaStage.ts`, `electron/productionRun/buildQaStageOutcome.ts`
- Modify: `electron/capabilityCore/mcpBriefIntake.ts`
- Modify: `electron/capabilityCore/mcpToolCatalog.ts`
- Test: `electron/productionRun/workflowRouter.test.ts`, `electron/productionRun/templateRegistry.test.ts`
- Test: `electron/productionRun/workflowDefinitionCompiler.test.ts`, `electron/productionRun/workflowDeadlockDetector.test.ts`

- [ ] 先写红测：封面→`asset.single`、六张海报→`asset.batch`、已有素材加字幕→`edit.assemble`、30 秒宣传片→`narrative.production`、模糊请求→`needsClarification`。
- [ ] 让 registry 由 WorkflowDefinition 产生 `nomi_start_playbook` 的合法枚举，不再只靠 `productionPlaybooks.ts` 手写。
- [ ] `playbookOrchestrator.ts` 只保留拓扑排序和静态 StagePlan；禁止在生产路径创建带 cursor/status 的第二个 `PlaybookRun`。ProductionRun 的 `stageId/revision` 是唯一运行游标。
- [ ] WorkflowDefinition 同时派生 Skill manifest 校验、ProductionRun 初始 stages、gate policy、handler registry 和 MCP playbook enum。
- [ ] 编译器拒绝环/悬挂 stage、不可达 gate、重复 producer、输入输出 schema 不匹配、unknown executor/tool/renderer capability；每个 stage 必须有 checkpoint、rerun scope、structured error/nextAction。
- [ ] `narrative.production` 的 golden graph 固定为 `direction → script_draft → script_review → script_adopted → storyboard_draft → storyboard_review → sample → spend_seal → batch_generate → shot_qa → rough_cut → audio/captions/transitions (conditional) → final_qa → export`；`changes_requested` 产生新 artifact version/revisionOf，旧稿保留且下游仍 blocked。
- [ ] 注册 `motion.graphics`：输入是文字/品牌 token/普通 image asset（包括 MJ 生成图），输出是 `MotionGraphicArtifact` + 可 Adopt 的 `MotionGraphicClip`；其 renderer 可按能力选择 HyperFrames 或 Remotion，不能由 Agent 直接传 raw HTML/JS 绕过 schema。
- [ ] `motion.graphics` 的默认 skillRefs 为 `hyperframes`、`hyperframes-core`、`hyperframes-animation`、`hyperframes-creative`、`hyperframes-cli`；涉及图片/音频时再按需加载 `media-use`，不把所有导演 Skill 灌进一次会话。
- [ ] WorkflowDefinition 明确 `exposedInputs`（文字、静态图、时长、画幅、主题 token、是否透明背景、音频/节拍）和 `outputBindings`（artifact → asset → timeline clip），禁止通过“最后一个 URL”猜输出。
- [ ] 显式 workflow 优先；其次使用项目素材类型和动作词；无法确定时最多返回 3 个候选并提出一个问题。
- [ ] 未知 Workflow 必须返回结构化错误，不创建空 Run。
- [ ] 每个 Workflow 都有“不能调用其它 Workflow handler”的红测；例如 `asset.single` 不得调用 script/storyboard/arrange handler。
- [ ] `nomi_intake_brief` 返回 `workflowKind`、plannedSkills、approvalPlan、willCreate、willNotCreate。

示例断言：

```ts
expect(route('做一张视频封面').kind).toBe('asset.single')
expect(route('把已有视频加字幕').kind).toBe('edit.assemble')
expect(route('帮我做点东西')).toMatchObject({ needsClarification: true })
```

Run：`pnpm exec vitest run electron/productionRun/workflowRouter.test.ts`

### Task 1A：SkillPack 归一、Prompt 编译与阶段加载（P0）

这一步解决“我们有二十多个 Skill，但到底谁在什么时候生效”的问题。现有 `SKILL.md` 很有价值，但目前主要是正文注入；`skill.json` 的 tools/permissions/stages/modelPrefs 还没有完整地成为运行时硬约束。不能继续靠把更多长 Prompt 拼进上下文来解决质量问题。

当前仓库盘点（以 `origin/main`=`d3bf0aba` 代码为准）：31 个 `SKILL.md` 中只有 7 个带 `skill.json`（包含 `drama.short`）；`brand.promo`、`drama.short`、`workbench.creation`、`workbench.generation`、`workbench.storyboard.planner` 有专用路径，但多数 `director.*`/`writer.*` 目前是高价值正文知识，未有 manifest、阶段产物或可执行 QA。`agentChatV2.ts` 目前按 `workbench.creation.*` 前缀二分工具组，其它 Skill 默认拿 canvas tools，未真正执行 `manifest.tools`/stage 白名单；`creation-edit` 还声明了当前不存在的 `creation_read/creation_write` 工具。这个差距必须在测试里显式变红，不能把“正文能被读到”当成“Workflow 已经执行”。Task 1A 同时为缺失 manifest 的内置 craft skill 生成最小 read-only manifest；迁移完成前它们不得进入付费 stage，但不能因此让 narrative route 永久失去 writer/director 知识。

**Files:**
- Create: `electron/skills/skillPackTypes.ts`, `electron/skills/skillInventory.json`
- Create: `electron/skills/skillPackResolver.ts`
- Create: `shared/prompt/promptSpec.ts`, `shared/prompt/promptPatternLibrary.ts`
- Create: `shared/prompt/promptCompiler.ts`
- Modify: `electron/skills/skillStore.ts`, `electron/skills/skillManifestSchema.ts`, `electron/skills/skillExecutionEvidence.ts`
- Modify: `electron/productionRun/productionWorkflowRegistry.ts`, `electron/productionRun/productionRunService.ts`
- Test: `electron/skills/skillPackResolver.test.ts`, `electron/skills/skillInventory.test.ts`, `shared/prompt/promptCompiler.test.ts`, `shared/prompt/promptPatternLibrary.test.ts`, `electron/productionRun/skillEvidence.test.ts`

**统一 SkillPack 合同：**

```ts
export type SkillPack = {
  skillId: string
  version: string
  contentHash: string
  source: { origin: 'builtin' | 'project' | 'user' | 'community'; url?: string; license?: string; installId?: string }
  installPolicy: 'builtin' | 'project' | 'external'
  resourceRefs?: string[]
  role: 'route' | 'plan' | 'prompt' | 'edit' | 'motion' | 'design' | 'media' | 'qa' | 'ops'
  appliesTo: Array<{ workflowKind: WorkflowKind; stageId: string }>
  dependencies?: string[]
  inputSchema: string
  outputSchema: string
  allowedTools: string[]
  checks: string[]
  contextBudget?: { maxTokens: number; priority: number; truncation: 'selected_sections' | 'summary_only' | 'fail' }
  approval: 'none' | 'proposal' | 'spend' | 'review'
  failurePolicy: 'fail_closed' | 'return_findings' | 'retry_local'
  evidence?: { sourcePath: string; selectedSections?: string[]; loaderVersion: string; loadedAt: string; source: 'loaded' | 'declared-external' | 'missing'; inputHash?: string; outputHash?: string }
}
```

旧 `skill.json` 迁移为 `SkillManifest v3` 时增加机器可验证的领域和产物字段（旧 manifest 只通过 migration 读取，不并行维护两套运行语义）：

```ts
type SkillManifestV3 = {
  skillId: string
  version: string
  contentHash: string
  source: { origin: 'builtin' | 'project' | 'user' | 'community'; url?: string; license?: string; installId?: string }
  installPolicy: 'builtin' | 'project' | 'external'
  tools: string[]
  approval: 'none' | 'proposal' | 'spend' | 'review'
  failurePolicy: 'fail_closed' | 'return_findings' | 'retry_local'
  domain: 'narrative' | 'visual' | 'prompt' | 'edit' | 'motion' | 'audio' | 'design' | 'qa' | 'ops'
  routeHints?: string[]
  inputs: Array<{ name: string; schema: string; required: boolean }>
  outputs: Array<{ kind: string; schema: string }>
  requiredCapabilities: Array<{ kind: 'text' | 'image' | 'video' | 'audio' | 'timeline' | 'renderer'; family?: string }>
  stages: Array<{
    id: string
    consumes: string[]
    produces: string[]
    tools: string[]
    checks: string[]
    pause: 'none' | 'proposal' | 'spend' | 'review' | 'export'
  }>
  dependencies?: string[]
}
```

运行时工具集合严格计算为：

```text
effectiveTools = manifest.tools ∩ stage.tools ∩ registeredTools ∩ workflow.toolAllowlist
```

未知工具、声明与实现不一致、缺 provider/renderer capability 都在启动/Preflight 时报结构化错误；不能因为 `SKILL.md` 写了“不要生成”就相信模型会自觉遵守。

**Prompt 不再是一段不可追踪的长字符串，而是中间结构：**

```ts
export type PromptProvenance = Array<{
  skillId: string
  version: string
  contentHash: string
  stageId?: string
  inputHash?: string
  outputHash?: string
  loadReceiptId?: string
  order?: number
}>

export type PromptPatternLibrary = {
  patternId: string
  mediaKind: 'image' | 'video' | 'motion' | 'audio'
  orderedParts: Array<'subject' | 'state' | 'action' | 'temporal' | 'camera' | 'lighting' | 'style' | 'references' | 'constraints' | 'negative'>
  antiPatterns: string[]
  capabilityFixtures: string[]
}

export type PromptBase = {
  subject: string
  action: string
  composition?: string
  lighting?: string
  style?: string
  negative?: string[]
  referenceRoles?: Array<{ assetId: string; role: 'identity' | 'scene' | 'prop' | 'style' | 'first_frame' | 'last_frame' | 'motion' | 'audio' | 'mask' | 'depth' }>
  provenance: PromptProvenance
}

export type ImagePromptSpec = PromptBase & {
  mediaKind: 'image'
  camera?: string
  modelConstraints?: { aspectRatio?: string; resolution?: string; outputs?: number }
}

export type VideoPromptSpec = PromptBase & {
  mediaKind: 'video'
  camera?: string
  temporal: string
  continuity?: { anchorIds: string[]; firstFrameRef?: string; lastFrameRef?: string }
  modelConstraints?: { durationSeconds?: number; aspectRatio?: string; audio?: 'native' | 'none' | 'separate_track' }
}

export type MotionPromptSpec = PromptBase & {
  mediaKind: 'motion'
  motionIntent: 'layout' | 'camera' | 'semantic' | 'assetFusion'
  temporal: string
  motionDesignSpecHash: string
  modelConstraints?: { durationSeconds: number; fps: number; aspectRatio?: string; alpha?: boolean }
}

export type PromptSpec = ImagePromptSpec | VideoPromptSpec | MotionPromptSpec

export type ShotPromptSpec = VideoPromptSpec & {
  /** Required only for a video generation shot; image/keyframe and standalone routes use the discriminated media contract instead. */
  route: 'video.shot'
  shotIntent: string
  ffDesc: string
  motionDesc: string
  lfDesc: string
  cameraPlan?: string
  variationType?: string
  camIdx?: number
  continuityIn?: { mode: 'shared_anchor' | 'tail_to_head' | 'none'; assetId?: string; hash?: string }
  continuityOut?: { mode: 'handoff' | 'open' | 'none'; assetId?: string; hash?: string }
  memoryRefs?: { entityIds: string[]; sceneId?: string; styleId?: string; version: number; contentHash: string }
}

export type MotionDesignSpec = {
  designSpecHash: string
  beatGrid?: Array<{ beat: number; label: string; emphasis: 'low' | 'medium' | 'high' }>
  layers: Array<{ id: string; role: 'background' | 'subject' | 'text' | 'ui' | 'accent' | 'caption'; zIndex: number }>
  choreography: Array<{ layerId: string; from: string; to: string; startFrame: number; endFrame: number; easing?: string }>
  transitions: Array<{ type: 'dissolve' | 'cover' | 'push' | 'scale' | 'light' | 'custom'; durationFrames: number; between?: string[]; storyFunction?: TransitionPlan['storyFunction']; cutPoint?: number; prelude?: string; postlude?: string; handoffFrameHash?: string }>
  typography?: { fontId: string; fontAssetId?: string; fontManifestHash: string; weights: string[]; safeArea: string; contrastMinimum: number }
  tokenSet: string
  sourceSkillRefs: PromptProvenance
}

export type RendererSelectionDecision = {
  requestedCapability: 'media_cut' | 'audio_mix' | 'motion_composition' | 'ai_video'
  selected: 'ffmpeg' | 'hyperframes' | 'remotion' | 'provider' | 'baked' | 'blocked'
  candidates: Array<{ renderer: string; capabilityMatch: string; version?: string; available: boolean }>
  reason: string
  scoring: { cost?: number; latencyMs?: number; qualityConstraints: string[]; userOverride?: string }
  fallback?: 'none' | 'ask_user' | 'fail_preflight' | { kind: 'baked'; sourceRenderer: string; editable: false; warning: string }
}
```

Prompt Skill 只负责填槽、冲突检查和模型无关表达；`promptCompiler` 再由 Model Capability Resolver 翻译成具体 provider 的 prompt/参数。静态图、视频镜头、MotionGraphic 不允许共用一套“万能 prompt”：图片禁止凭空加入运镜，视频必须写动作演进，动效必须有 `MotionDesignSpec`/beat/choreography。这样 `director.cinematography`、`director.shot-translation`、`director.action`、`director.performance`、`director.staging`、`director.art-design`、`director.consistency` 不会互相覆盖或把同一条要求重复四遍。

**按任务加载，不按总目录全灌：**

| Workflow | 先加载的 SkillPack | 只在需要时加载 |
|---|---|---|
| `asset.single` | `design-direction`、`brand-guidelines`、图像生成、视觉 QA | `thumbnail-cover-design`、特定品牌/题材包 |
| `asset.batch` | 品牌/设计、样片 QA、批量映射 | 单行修复/局部编辑 |
| `asset.edit` | 视觉分析、局部编辑、前后对比 QA | 遮罩/特定媒体处理 |
| `canvas.explore` | `director.art-design`、`director.consistency`、视觉锚点审图 | 题材、摄影、古装等专门包 |
| `motion.graphics` | HyperFrames route/core/animation/creative/CLI、`create-motion-graphics`、设计 token、视觉 QA | `media-use`、keyframes、音频节拍 |
| `narrative.production` | writer 结构/剧本审阅、director 镜头/一致性/转场、video-gen、sound、视觉 QA | action、performance、staging、题材包 |
| `edit.assemble` | transcription、talking-head、visual-analysis、music/voice、EditCommand QA | HyperFrames（有动态花字时） |

加载策略固定为：Route Skill → 当前阶段的 2–5 个 domain Skill → 检查 Skill；每个 Skill 必须有 loader-owned `skill.loaded`/`skill.applied` evidence。Skill 只产结构化计划、PromptSpec、EditCommand 或 QA findings，不能直接写 Store、Run、文件或 provider。

**现有 Skill 的归类决定：**

- `writer.*` 与 `workbench.creation/storyboard-planner`：叙事/文稿阶段，不进入封面、批量海报或已有素材编辑。
- `director.*`：镜头/动作/表演/调度/一致性/转场的 prompt 与审片规则；不是每镜都全部加载。
- `director-keyframe-review`、`visual-analysis`、`visual-quality-gate`：生成后的检查层，不把检查清单伪装成生成 Prompt。
- `director-sound`、`music`、`voice`、`transcription`：音频/口播阶段，和视频生成解耦；音频是否启用由模型能力和 Workflow Policy 决定。
- `hyperframes*`、`create-motion-graphics`：动态视觉阶段；生成 `MotionGraphicArtifact`，不直接变成扁平 MP4。
- `skill-author`：只负责把外部方法论转成经验证的 SkillPack，不得在运行中任意安装并扩大工具权限。

Canonical resolver 必须保留 alias 表和来源：`talking-head`→`talking-head-guide`、`sound`→`director.sound`、`music`/`voice`→对应 audio skill 包、`visual QA`→`visual-quality-gate`。用户目录中的 `video.shot-breakdown` 与 `video.viral-producer` 先作为 recipe/stage 迁移候选；它们当前有硬编码时长、过时 `export` 工具或把音频混在视频文本里，必须显示 `blocked/missing capability`，不能在选择器里伪装为可运行。`skills.list` 增加 `scope: craft|workflow|all`，让外部 Agent 能发现经过 capability report 的用户 Workflow，而不是只看到 director/writer 摘要。

**红测：**

- 只请求 `asset.single` 时不得加载 `writer.screenwriter` 或 `storyboard` 阶段工具。
- PromptSpec 必须保留 reference role、duration/audio 能力约束和 skill provenance；冲突字段 fail closed，不取最后一条字符串。
- 缺 `skill.json`/正文 hash/版本时只能标 `legacy-read-only`，不能产生 `skill.loaded` 或进入付费 stage。
- loader 缺内置 ref 必须 `missing/blocked`；`declared-external` 只有 sourcePath/contentHash/read receipt 才能作为参考输入，不能计入 `skill.applied`。每次 evidence 记录 selectedSections、inputHash、outputHash、loaderVersion、loadReceiptId 和应用顺序。
- `manifestRuntimeParity.test.ts` 遍历内置与用户 manifest 的 top/stage tools，对照真实注册表和 route adapter；未知/过时工具（如 `creation_read/creation_write/export`）直接 FAILED，不回退成全量工具。
- QA Skill 只返回 findings，不得直接修改已批准的 PromptSpec/EditorDocument。
- `StoryboardExecutionReconciliation` 必须逐镜对账 `ffDesc/lfDesc/variationType/camIdx/continuity`, `narrativeRole`, `TransitionPlan` 与最终 job payload；任何字段蒸发、改写后未重新 lint 或污染词未执行都 fail closed。
- Prompt lint 必须区分 image/keyframe、video、motion：图片不发运镜/声音，视频写动作演进，精确文字/logo/UI 转为 caption/MotionGraphic，不把 `director.sound` 的说明拼进 video prompt；negative 只有 capability 支持时才下发，否则作为 lint-only constraint。

运行：`pnpm exec vitest run electron/skills/skillPackResolver.test.ts shared/prompt/promptCompiler.test.ts electron/productionRun/skillEvidence.test.ts`

### Task 2：EditorCommandBus 适配现有 Timeline

**Files:**
- Create: `src/workbench/editor/editorTypes.ts`
- Create: `src/workbench/editor/editorCommands.ts`
- Create: `src/workbench/editor/editorValidation.ts`
- Create: `electron/editor/editorCommandBus.ts`, `src/workbench/editor/editorCommandClient.ts`
- Modify: `src/workbench/workbenchStore.ts`
- Modify: `src/workbench/timeline/timelineEdit.ts`
- Test: `src/workbench/editor/editorCommandBus.test.ts`

- [ ] 先写红测：insert、replace、split、trim、ripple_delete、move、caption、transition、audio gain 的 command 能返回新 Timeline 和 inverse。
- [ ] shared `editorCommandCore` 只做纯 reducer/validation；`electron/editor/editorCommandBus.apply(command, { projectId, baseRevision })` 是唯一持久化/CAS 入口，renderer 的 `editorCommandClient` 只是 IPC proxy。Workbench/Timeline/Canvas 只能 dispatch typed IPC 并订阅 projection，过渡期适配器只读，不允许 human UI 继续直接写 Zustand。
- [ ] 成功 revision 加一，失败 revision 不变；不存在 clip/asset、负帧、轨道冲突、超出边界都返回结构化错误。
- [ ] 将 Canvas `proposalTxn` 的 barrier、compensation、reconciliation 抽成通用接口，保留原有 Canvas event payload。
- [ ] 把所有 human UI、内置 Agent、Canvas、MCP 的 timeline mutation 替换成同一 command bus；本任务结束后任何写入口（不只是新 Agent）都必须经过 bus。

运行：

```bash
pnpm exec vitest run src/workbench/editor/editorCommandBus.test.ts src/workbench/timeline
```

### Task 3：EditorDocument 与 AssetRegistry 迁移

**Files:**
- Create: `src/workbench/editor/editorDocument.ts`
- Create: `src/workbench/editor/timelineDocumentAdapter.ts`
- Create: `src/workbench/editor/assetRegistry.ts`
- Create: `src/workbench/editor/editorMigration.ts`
- Modify: `src/workbench/assets/assetTypes.ts`
- Modify: `src/workbench/workbenchPersistence.ts`
- Modify: `src/workbench/timeline/timelineTypes.ts`
- Modify: `src/workbench/generationCanvas/agent/storyboardPlan.ts`, `src/workbench/generationCanvas/agent/shotLanguage.ts`, `src/workbench/generationCanvas/agent/nodePromptOptimizer.ts`, `src/workbench/generationCanvas/agent/verifyFocusForVariation.ts`
- Modify: `src/workbench/export/renderManifest.ts`
- Test: `src/workbench/editor/editorMigration.test.ts`, `assetRegistry.test.ts`, `src/workbench/generationCanvas/agent/storyboardPlanContinuity.test.ts`, `src/workbench/generationCanvas/agent/shotLanguageProductionMode.test.ts`, `src/workbench/generationCanvas/agent/nodePromptOptimizer.test.ts`, `src/workbench/generationCanvas/agent/variationFocusQa.test.ts`, `electron/productionRun/storyboardCanvasBatchReconciliation.test.ts`

- [ ] 扩展现有 `AssetRef` 为 `AssetRecord`，保留 render URL/transport origin 分离。
- [ ] 增加 discriminated `EditorDocumentV1`/`EditorDocumentV2` schema、round-trip 和 idempotence 测试；旧 payload 仍可读取，不能让 normalizer 静默抹掉新字段。
- [ ] storyboard→canvas adapter 必须保存 `ffDesc/lfDesc/variationType/camIdx/continuity` 与 compiled hash；读写/导出 reader 都从 v2 projection 读取，不再把字段只留在 planner 内存。
- [ ] 修改 `storyboardPlanToCreateNodesArgs` 的过时“no shot→shot chain”分支：当 Workflow continuity policy 为 `previous_shot` 时写入 `previousShotId/continuityLocks/narrativeGoal/actionChain/handoffFrameRef` 与依赖边；`none` 才允许独立镜头。`shotLanguage` 在编辑器模式为 advisory，在付费 production mode 通过 `assertShotLanguageClean` 阻断，并在 prompt 改写前后各留一条 finding/evidence。
- [ ] `storyboardPlanContinuity.test.ts` 用六镜 golden fixture 验证 materialize→batch payload 的字段守恒、条件依赖边和取消/重试；`shotLanguage`、`NodePromptOptimizer`、`verifyFocusForVariation` 必须在生产前与改写后各跑一次，不能只在纯核/开发预览中检查。
- [ ] 首期 `TimelinePanel`、`PreviewWorkspace` 和播放器只消费 `TimelineProjectionV1`；v2 metadata 通过 `timelineDocumentAdapter` 注入，不新建第二个 Store。
- [ ] 将 Timeline clip 的主身份迁移为 `assetId`；旧 `sourceNodeId` 和 URL 继续兼容读入。
- [ ] 同一 Canvas node 的不同 result 必须得到不同 assetId；同一 result 被剪成两段可复用同一 assetId。
- [ ] 旧项目打开时执行纯迁移：读 v1→生成 v2→校验→备份→写入；失败时只读打开并保留修复入口。
- [ ] 画布删除/重生成触发 registry reconcile；被时间轴引用的资产只能 archived/missing，不能物理删除。
- [ ] 导出绑定必须包含 `projectId + runId + timelineVersion + manifestHash`；不能从当前打开窗口的 aspect ratio 或 generationNodes 反推另一个项目的导出。

迁移红测：

```ts
const migrated = migrateTimeline({ sourceNodeId: 'node-1', url: 'a.mp4' })
expect(migrated.assetId).toBeTruthy()
expect(migrated.sourceNodeId).toBe('node-1')
expect(migrated.lifecycle).not.toBe('missing')
```

### Task 4：Agent 上下文与 EditProposal 编译器

**Files:**
- Create: `src/workbench/ai/editorContext.ts`
- Create: `src/workbench/editor/editorSelectionContext.ts`
- Create: `src/workbench/ai/editorProposalSchema.ts`
- Create: `src/workbench/ai/editorProposalCompiler.ts`
- Modify: `src/workbench/ai/workbenchAgentRunner.ts`
- Test: `src/workbench/ai/editorProposalSchema.test.ts`, `editorProposalCompiler.test.ts`

- [ ] 只给模型发送：当前选区、播放头前后窗口、资产摘要、项目约束、用户明确引用的内容；不发送整个项目和完整历史。
- [ ] Editor、Canvas、Timeline 三域分别声明 `scope/documentId/selectionVersion/hash`；Proposal 卡显示 context chip（当前选区/全文/选中镜头/项目素材），禁止通过 `selectedText || documentText` 隐式回落。
- [ ] Apply 前重新校验 context version/hash；用户在等待期间编辑了选区或时间轴时，Proposal 进入 stale，要求重新读取，不得静默应用旧范围。
- [ ] Zod 严格拒绝未知 command、未知 assetId、过期 baseRevision 和额外字段。
- [ ] 读工具自动确认；写工具只生成 Proposal。含生成意图的 Proposal 必须同时返回 estimatedCost、modelCandidates、`approval.kind='spend'` 和 `approval.surface`。
- [ ] Proposal 卡展示：人话摘要、影响片段、前后时长、字幕/音频影响、预计成本、预计耗时、Diff、Apply/Reject/Edit。
- [ ] 非法模型输出、revision conflict、资源缺失分别返回可执行的 `nextAction`，不能只显示通用失败。

示例：

```ts
const proposal = compileEditorProposal({
  instruction: '删掉第一个停顿，后面的内容前移',
  context,
})
expect(proposal.commands[0]?.type).toBe('timeline.ripple_delete')
expect(proposal.baseRevision).toBe(context.revision)
```

### Task 5：本地素材 AI 剪辑 MVP

**Files:**
- Create: `src/workbench/editor/transcriptCommandAdapter.ts`
- Modify: transcription/import integration
- Modify: `src/workbench/editor/editorCommandBus.ts`
- Modify: `src/workbench/export/renderManifest.ts`
- Test: `tests/ux/editor-local-footage.walk.mjs`, `src/workbench/editor/transcriptCommandAdapter.test.ts`

- [ ] 任务 J1：导入 20 分钟访谈，识别停顿/重复，生成删除提案，用户应用、撤销、再应用。
- [ ] 转录词级时间、说话人和置信度只作为分析输入，不直接写时间轴。
- [ ] 应用 ripple delete 后重算 clip duration、playhead、字幕区间和导出范围。
- [ ] 校验无负时长、无越界、音频轨不意外重叠、字幕区间落在视频范围内。
- [ ] 通过 Playwright 截图检查：用户是否看见删除范围、总时长变化和撤销入口。

### Task 6：模型能力、生成 Job 与 ExecutionSnapshot

**Files:**
- Create: `shared/catalog/capabilityProfile.ts`, `shared/quality/qualityProfile.ts`, `shared/production/shotExecutionContract.ts`
- Create: `electron/catalog/modelCapabilityResolver.ts`
- Create: `electron/productionRun/productionExecutionSnapshot.ts`
- Create: `electron/productionRun/storyboardExecutionReconciliation.ts`, `electron/productionRun/productionScheduler.ts`
- Create: `src/workbench/generation/generationJobTypes.ts`
- Create: `src/workbench/generation/generationJobAdapter.ts`
- Modify: `electron/productionRun/productionRunTypes.ts`
- Modify: `electron/productionRun/productionRunService.ts`
- Modify: `electron/productionRun/productionRunDriverOps.ts`
- Test: `shared/catalog/capabilityProfile.test.ts`, `shared/quality/qualityProfile.test.ts`, `shared/production/shotExecutionContract.test.ts`, `electron/catalog/modelCapabilityResolver.test.ts`, `productionExecutionSnapshot.test.ts`, `generationJobAdapter.test.ts`, `electron/productionRun/productionScheduler.test.ts`
- Test: `electron/productionRun/storyboardExecutionReconciliation.test.ts`

- [ ] Resolver 只从现有 archetype/catalog 派生 capability：合法时长、音频、参考角色、画幅、keyStatus、并发上限。
- [ ] 目标时长、镜头时长、模型合法时长、媒体实际时长分别记录；不把 30 秒伪装成每个 Job 的时长。
- [ ] `audio=required` 但模型不支持且没有 separate-track Workflow 时，在 spend gate 前阻断。
- [ ] 参考输入使用 `identity/scene/first_frame/last_frame/motion/audio/style` 角色，不再把所有东西放进 `referenceImages`。
- [ ] 在合同/预算 gate **之前**生成 `DraftExecutionSnapshot`，让用户看到最终模型、合法时长、参考角色、波次、并发和预计成本；审批只绑定 `snapshotId/planHash/policyHash`。
- [ ] elicitation accept 后只执行 `sealExecutionSnapshot(snapshotId, approvalId)`，不得再次 resolver 或改变 provider 请求；Provider timeout/fetch failed 保留 providerTaskId，不盲目重提。
- [ ] 同一 snapshot 重复提交只允许一个 idempotencyKey；编辑新版本只能生成新 snapshot。
- [ ] `ProductionJob` 持久化 `executionSnapshotId`、`sourceEditorRevision` 或 `sourceArtifactVersion`、`dependencyJobIds`、`waveIndex`、`assetManifestHash`；Export Job 额外保存 `editorSnapshotId`、`timelineVersion`、`renderManifestHash`。
- [ ] 每个 Job 另外保存 `shotContractArtifactId/version/hash`、`promptSpecArtifactId/version/hash`、`continuityPolicy`、`transitionPlanArtifactId/version`、`qualityProfileId/version`、`rendererDecisionHash` 和最终 compiled payload hash；重启/审计必须能重建 authored-vs-compiled 对账，不允许只留一段 prompt 字符串。
- [ ] `StoryboardExecutionReconciliation` 先做 authored-vs-compiled 对账，再允许 materialize/generate；六镜 fixture 必须证明 `ffDesc/lfDesc/variationType/camIdx/continuity`、narrative role、TransitionPlan/handoff frame 与 job payload 一一对应，任何蒸发或未经新 artifact version 的改写都阻断。
- [ ] `shared/catalog/capabilityProfile.ts` 的 fixture 至少覆盖合法时长 min/max/step、fps、aspect、native/separate audio、参考槽、cancel/idempotency、lane concurrency 和 cost；Resolver 输出候选排序、拒绝原因与 fallback。
- [ ] `shared/quality/qualityProfile.ts` 的 fixture 至少覆盖 check IDs、阈值来源、最大迭代、缺证据/未知状态、人工升级和 workflow audioPolicy；`QualityGateRunner` 只接受 registry 中存在的 checker。
- [ ] Create `electron/productionRun/productionScheduler.ts` with `enqueue(snapshot)`, `setConcurrency(runId, requested, expectedRevision)`, `reserve(jobSet)`, `release(reservationId)`, and `cancel(scope)`. It enforces provider/model lane caps and dependency waves; concurrency changes are only accepted before a wave is sealed and are shared by UI/MCP through the same RunPolicy command.
- [ ] Scheduler tests prove independent image/audio jobs run in parallel, continuity jobs wait for adopted+QA handoff, cancellation releases reservation without a second submit, and a transient provider failure resumes the same attempt/providerTaskId.

测试：目标 5 秒而模型支持 4/8 秒、音频 required、参考图超限、key missing、重复回调、进程重启和 inFlight read projection。

### Task 7：生成结果安全插入时间轴

**Files:**
- Modify: `src/workbench/generation/generationRunController.ts`
- Modify: `src/workbench/editor/editorCommandBus.ts`
- Modify: `electron/productionRun/productionRunService.ts`
- Test: `src/workbench/editor/generationInsert.test.ts`, `electron/productionRun/generationRecovery.test.ts`

- [ ] 用户说“给这里加一个过渡镜头”时，Job 只带 targetPlayhead、前后 clip assetId、estimatedCost 和 inputAssetIds。
- [ ] 生成完成先注册 `AssetRecord(role='aiGenerated')`，保留 parentAssetIds 和 job lineage。
- [ ] 只有用户确认 `timeline.insert_generation_result` Proposal 后才插入；Provider 成功不等于自动落时间轴。
- [ ] 取消、迟到回调、重复回调和项目关闭重启都不能重复插入或重复扣费。
- [ ] “只重做第 3 镜”测试必须证明其它 clip、字幕、转场和 assetId 不变。

### Task 8：字幕、音频、转场与 Render Manifest

**Files:**
- Modify: `src/workbench/timeline/timelineTypes.ts`
- Modify: `src/workbench/timeline/timelineTextEdit.ts`
- Modify: `src/workbench/export/renderManifest.ts`
- Modify: `electron/export/exportManifest.ts`
- Modify: `electron/export/ffmpegFiltergraph.ts`
- Create: `shared/quality/qualityGateRunner.ts`, `electron/productionRun/qualityGateRunner.ts`, `electron/productionRun/checkerRegistry.ts`
- Test: `src/workbench/export/renderManifest.test.ts`, `electron/export/audioSubtitleTransition.test.ts`, `shared/quality/qualityGateRunner.test.ts`, `electron/productionRun/qualityGateRunner.test.ts`, `electron/productionRun/qaFailClosed.test.ts`

- [ ] Create `shared/render/renderManifestV2.ts` and `electron/export/renderManifestV2Adapter.ts`; migrate V1 without silently dropping audio/text/overlay/effect/keyframe/motion metadata. `RenderManifestV2` is bound to `projectId/runId/editorSnapshotId/timelineVersion/manifestHash`, has typed `AudioTrackBinding`/caption/transition/motion layers, `rendererAvailability`, and an explicit `muxPolicy`.
- [ ] `rendererAvailability` must reject the current ghost `remotion-frame-render` or HyperFrames when the locked package/worker is absent; no backend name may claim a render that did not run. Add real ffprobe/waveform export tests for an audible AAC track and a silent/blocked case.

- [ ] 将字幕、音频、转场作为 Render Manifest 一等输入，不再只在 Timeline UI 中存在。
- [ ] 音频支持 native、separate-track、none 三种事实；AAC 容器存在不能代替“有可听声音”。
- [ ] `AudioPlan` 编译为明确的 `AudioArtifact`/audio track binding（voice/music/SFX/ambience、word/beat timing、ducking、mix/mux policy）；native audio 与独立 TTS/BGM 不互相冒充。若 renderer/provider 不支持音频，preflight 显示降级或单独音频阶段。
- [ ] 字幕流必须裁剪到实际视频 duration；抽帧和 ffprobe 都要检查边界。
- [ ] 只允许 authored transitions 计入质量门；cut 不冒充 dissolve/fade/match_cut。
- [ ] `QualityProfile` 按 Workflow 声明检查与阈值（cover/image、batch、motion、narrative、edit）；旧的 25–35 秒/至少 6 镜/必须字幕规则只能作为 `short-film-30s` recipe，不得阻断封面、10 秒动效、60 秒片或无字幕任务。
- [ ] Preview 和 export 从同一个 manifest 派生；manifest 带 `projectId/runId/timelineVersion/manifestHash`。
- [ ] 真实验收检查音频 waveform、mean/peak/silenceRatio、字幕越界、边界白帧和转场邻接关系。
- [ ] `QualityGateRunner` 是唯一生成 `QualityGateResult` 的 owner：它按 `QualityProfile` 选择 checks/阈值，只有实际 evidence URI/hash、checker version 和 required findings 全部满足才可 `pass`; 缺 evidence 为 `blocked`，不能由 Agent、脚本或 reducer 手写 `pass`。
- [ ] required check 不能是 `skipped`/unknown；`requiredCheckIds`、`checkResults`、`gateInputHash` 必须逐一对账。`humanEscalation='required'` 必须绑定 `requiredGateId/decisionId`，没有批准 receipt 就停在 `needs_attention`。
- [ ] `maxIterations` 耗尽不得降低阈值或伪造 pass；写入 `stopReason: 'passed' | 'max_iterations' | 'budget_exhausted' | 'blocked_real_seam' | 'human_required'` 与失败证据。

### Task 9：Workflow Stage Handler 与审批归一

**Files:**
- Create: `electron/productionRun/workflowStageHandlers.ts`
- Create: `electron/productionRun/productionRunViewProjection.ts`
- Modify: `electron/productionRun/productionPlaybooks.ts`
- Modify: `electron/productionRun/productionRunDriverOps.ts`
- Modify: `electron/productionRun/productionRunService.ts`
- Modify: `electron/productionRun/runQaStage.ts`, `electron/productionRun/buildQaStageOutcome.ts`
- Modify: `electron/capabilityCore/mcpProtocol.ts`
- Modify: `electron/capabilityCore/mcpToolCatalog.ts`
- Modify: `electron/skills/skillExecutionEvidence.ts`
- Test: `electron/productionRun/workflowStageHandlers.test.ts`, `electron/productionRun/runQaStage.test.ts`, `tests/production/external-agent-single-surface.test.mjs`, `electron/capabilityCore/mcpScriptReviewGate.test.ts`
- Test: `electron/productionRun/qaFailClosed.test.ts`

- [ ] Driver 只按 semantic stage 查找 handler，不再把 `generate/qa/assemble/export` 和 `brand.promo` 写死。
- [ ] `productionRunMigration.ts` 将旧 BRAND_PROMO stages/gates/trust/artifacts 转成冻结的 `workflowId/version/hash + recipeId/version/hash + catalog refs`；旧 run 只读/reconcile，不能被新 registry 重新解释。迁移成功后删除旧 brand-specific driver 分支；legacy tool 仅保留无状态 read-only adapter，并给出删除版本/回归门，不能无限并行。
- [ ] `brand.promo` 适配为 `narrative.production`；`drama.short` 能从 manifest/registry 启动，不再只存在 Skill 文件里。
- [ ] `artifact.review` 按 artifact kind 分流，storyboard 不再被当成 script review。
- [ ] `script_review` 是独立 durable stage/gate：`storyboard` 明确 dependsOn `script_adopted`；拒绝/修改剧本不得生成分镜或落画布。review packet 返回 script artifactId/version/hash、摘要、预览和同一 approvalId；J4 红测拒绝剧本后 provider calls=0、没有 storyboard materialize。
- [ ] asset Workflows 明确不调用 `production.plan-script`、`production.plan-storyboard`、`arrange_storyboard_to_timeline`。
- [ ] MCP elicitation、Nomi UI takeover 和内部 Agent 共用 approvalId、runId、revision 和 event cursor。
- [ ] `RunPolicy` 是唯一并发、预算、模型白名单、trust 和 approval surface 的 owner；不得同时在 WorkflowPolicy/AutomationPolicy 保存两份 `maxConcurrentJobs`。
- [ ] `buildProductionRunView()` 是唯一 Run projection；TaskCenter、EditorRunCard、AssistantTimeline 和 MCP 只消费它。`awaiting_*`、paused、needs_attention、running、failed、completed 必须分组真实显示，不能把等待审批伪装成 running。
- [ ] 缺少 Skill body/hash 时 fail closed；`declared` 不能被写成 `skill.loaded`。外部 Skill 必须提供可验证 contentHash/read receipt。
- [ ] QA/check handler 不可达或返回未知状态时必须 `blocked/needs_attention`，禁止沿用当前“审片跳过但继续 assemble”的 fail-open；只有 `QualityGateResult.status='pass'` 才能进入下游。
- [ ] 删除旧 `production.verify-shots` 的 fail-open 分支（当前不可达/异常写“审片跳过”仍继续 assemble）；`runQaStage.ts`/`buildQaStageOutcome.ts` 必须把不可达、unknown、缺证据映射为 blocked，并由 `qaFailClosed.test.ts`/`mcpScriptReviewGate.test.ts` 覆盖。
- [ ] MCP client 断线后用 `nomi_get_run/nomi_subscribe_run` 恢复；MCP Tasks 只映射 transport 状态，不生成第二个 Run。

### Task 10：Editor Workbench UI

**UI decision:** Nomi 内部界面需要调整，但不是重做编辑器。保留左素材、中预览、底部时间轴、右 Agent/Task Center 的现有壳层；只把新的 Workflow/Artifact/Run 投影接入现有 slot。用户真正感知到的变化是：右侧看到可预览的提案和一次确认、素材候选有 adopted/failed 状态、任务中心能区分“等你确认/需处理/运行中”、时间轴能编辑 MotionGraphic 属性。HyperFrames 不做第二个 Studio，不要求用户来回切换；它只是时间轴中的可编辑动效项和同一 Run 的 renderer。

| 用户当前会遇到 | 调整后看到 | 为什么必须改 |
|---|---|---|
| 一句话请求进入 generic chat，用户看不出系统选了封面、叙事片、已有素材剪辑还是动效路线 | 右侧 Agent 先给一张短的“理解/路由”卡：将做什么、不会做什么、需要补的唯一信息 | 只改后端而不改投影，用户仍无法判断系统有没有听懂，也无法阻止走错流程 |
| 每个 tool call 各弹确认，剧本/分镜/付费生成混在一起 | 按业务风险显示一次可决策 ReviewPacket；剧本审阅、付费、落轴、导出各有独立 scope，同一 `approvalId` 不双问 | 工具权限确认不能替代创作审阅；两者混用会造成重复点击或漏审 |
| Task Center 把等待审批、排队、运行、失败混成近似“进行中” | 明确分成“等你确认 / 需处理 / 运行中 / 已完成”，未知进度不画假百分比 | 用户最关心的是现在需不需要行动，以及失败能否局部恢复 |
| 生成结果只像 URL/节点结果，候选、采用稿、失败稿难区分 | 现有素材网格增加 candidate/adopted/rejected/failed 标记与单项采用/重试 | 不新增素材系统，但让中间稿可找、可比较、可恢复 |
| Motion Graphic 只能像烘焙视频看待，改字色/时长可能整段重做 | 时间轴出现一等 MotionGraphic clip；属性面板改 props，生成新版本并局部重渲染 | HyperFrames/Remotion 的价值是可编辑，不应退化为第二个外部 Studio 或不可改 MP4 |
| 模型、时长、声音、并发、成本在提交后才暴露 | 计划/预检卡显示 requested/legal/actual 时长、native/separate/none 音频、requested/effective 并发与预计成本 | 能力差异必须在花钱前解释，不能让用户靠失败学习模型限制 |

**不改的部分：** 不改主导航，不新增工作区模式，不新增第二套右侧栏、素材库、Task Center、时间轴或确认弹窗；不把 20 多个 Skill 做成用户要配置的开关。Skill/Workflow/Renderer 细节默认收起，只在 Run 详情和产物 provenance 中供审计与排错。

**Files:**
- Create: `src/workbench/editor/workflowProposalViewModel.ts`
- Create: `src/workbench/editor/components/EditProposalCard.tsx`
- Create: `src/workbench/editor/components/EditorSelectionContext.tsx`
- Modify: `src/workbench/WorkbenchShell.tsx`, `src/workbench/generationCanvas/components/AssistantTimeline.tsx`
- Modify: `src/workbench/assets/AssetLibraryPanel.tsx`, `src/workbench/assets/AssetTile.tsx`, `src/workbench/taskCenter/productionRunTaskCenter.ts`
- Modify: `src/workbench/timeline/TimelinePanel.tsx`, `src/workbench/preview/TimelinePreview.tsx`
- Modify: `src/i18n/locales/timelineEditor.ts`
- Test: component tests and Playwright screenshots

- [ ] 不新增 EditorWorkbenchShell、第二素材抽屉、第二 Task Center 或第二确认弹窗；复用现有 `WorkbenchShell` slots、`AssetLibraryContent`/`AssetTile`、`AssistantTimeline`、`TimelinePanel`、`ProductionRunTaskCard`/`TaskCenterPanel`。内部界面只做投影和入口调整。
- [ ] 右侧 Agent 面板变成“提案/运行投影”：显示影响范围、所见 Diff、预览句柄、成本/审批面、下一步；外部 Agent elicitation 与 Nomi 右侧只消费同一 `approvalId`，不会各弹一次。
- [ ] 右侧面板按四个用户能懂的状态工作：理解/路由（会做什么、不会做什么）、计划/预检（requested/legal/actual 时长、音频模式、模型/并发/成本）、运行（真实 progress/cancel/queued reason）、审阅（脚本/候选/帧/波形/QA 与一次下一步）。不把内部 Skill 名称变成必填配置。
- [ ] Task Center 将 `awaiting_*`/paused/needs_attention 与 running 分组；未知进度不画假百分比，失败显示 retry/reconcile 的真实下一步。
- [ ] 素材池复用现有网格，增加 candidate/adopted/rejected/failed 状态和单项 retry/adopt/reject，不另建 candidate store。
- [ ] 时间轴增加 MotionGraphic clip 的可见轨道/层级与属性入口；预览仍消费 durable `projectId/runId/timelineVersion`，不读当前窗口的另一份状态。
- [ ] 选区上下文显示当前范围（全文/选区/镜头/节点）和 revision/hash；Proposal 过期时明确 stale，不默默改错对象。
- [ ] 定义通用 `WorkflowProposalViewModel`，不要把 asset/artifact/revision 提案硬塞进 Canvas 的 node/edge rows：

```ts
export type WorkflowProposalViewModel = {
  proposalId: string
  workflowKind: WorkflowKind
  sourceScope: { projectId: string; editorRevision?: number; selectedClipIds?: string[]; selectedNodeIds?: string[]; artifactId?: string; artifactVersion?: number }
  changes: Array<{ kind: 'artifact' | 'asset' | 'clip' | 'node'; id: string; summary: string; preview?: string }>
  approval: { surface: 'agent-elicitation' | 'nomi-ui' | 'mixed'; approvalId?: string; decision?: 'approved' | 'rejected' | 'cancelled' }
  status: 'draft' | 'awaiting_confirmation' | 'running' | 'succeeded' | 'failed' | 'cancelled'
  nextAction?: { kind: string; label: string; targetId?: string }
  budget?: { estimated: number; authorized?: number; actual?: number }
}
```

- [ ] Canvas 继续复用 `AgentPlanCard`/`CommittedProposalCard`/`ReconcileDeviationCard`；Workflow proposal 使用同一 AssistantTimeline anchor、StepHeader、status badge 和撤销语义，但不复制第二套审批/Undo UI。
- [ ] 空项目只显示“导入素材/从一句话开始”；不展示高级 Workflow 配置。
- [ ] Proposal 卡首先显示影响范围和 Diff，再显示成本；没有成本的普通剪辑不显示虚假额度。
- [ ] 生成中显示 Job、模型、预计耗时、取消；失败显示原因、重试同一 Job 或新 attempt 的区别。
- [ ] 生成中显示 `concurrency.requested/effective/reason`、每镜 dependency（independent vs tail_to_head/first_frame）、wave 与 queuedReason；用户调并发只能发 `nomi_set_run_concurrency`/IPC proposal，wave sealed 后拒绝并解释。
- [ ] 音频状态在右侧审阅包和预览中明确显示 native/separate/none、波形、可听探针、mute/fallback；文本 host 至少得到 mean/peak/silence 摘要。
- [ ] 运行状态复用 `buildProductionRunView()` 和 `ProductionRunTaskCard`；EditorRunCard 只能是薄适配器，不重新解释 Run status。
- [ ] Agent 上下文来自当前选区和播放头，不让用户手写内部格式。
- [ ] 使用现有 token、按钮层级和 i18n；不新增全局 CSS，不复制已有 Timeline 控件。
- [ ] Playwright J1/J2/J3 截图由人工查看，检查遮挡、层级、长文案、空状态和恢复入口。
- [ ] 样张/Playwright 还覆盖“一句话 intake→route/style/capability preflight”、剧本审阅、封面、批量、MJ 动效四条分流；显示将创建/不会创建的 artifact，以及 `motion-interaction` 的 proposal→running→needs_attention 可中断/reduced-motion 状态。

### Task 11：Motion Graphic / HyperFrames 动态视觉垂直闭环（EditorCore 后的 P1）

**Files:**
- Create: `shared/motion/motionGraphicTypes.ts`, `shared/motion/motionGraphicRenderer.ts`
- Create: `shared/motion/motionGraphicBundle.ts`
- Create: `src/workbench/motion/motionGraphicTypes.ts` (projection-only re-export; no duplicate contract)
- Create: `src/workbench/motion/motionGraphicValidator.ts`
- Create: `src/workbench/motion/hyperframesCompositionContract.ts`
- Create: `src/workbench/motion/hyperframesSandbox.ts`
- Create: `src/workbench/motion/adapters/remotionAdapter.ts`
- Create: `src/workbench/motion/adapters/hyperframesAdapter.ts`
- Modify: `src/workbench/export/renderManifest.ts`
- Modify: `electron/export/exportPlanner.ts`, `electron/productionRun/workflowStageHandlers.ts`
- Test: `shared/motion/motionGraphicRenderer.test.ts`, `shared/motion/motionGraphicBundle.test.ts`, `src/workbench/motion/motionGraphicValidator.test.ts`, `rendererAvailability.test.ts`, low-resolution smoke render, preview/export parity, local rerender lineage

- [ ] `motion.graphics` 是用户能理解的任务入口：输入一句话、静态图/产品截图、品牌 token、时长/画幅、是否透明背景或节拍；输出可预览的 `MotionGraphicArtifact`，不是先烘焙成不可编辑 MP4。
- [ ] 路由先读取 `motionIntent` 与 complexity：`layout/camera/assetFusion` 可走 HyperFrames，`semantic` 转 image-to-video；simple 单 composition 只需 spec→lint→preview，complex/multi-scene 才加载 design/beat expansion 和可选 sketch。默认 `<10s`、无旁白、最多一个澄清问题，不创建 script/storyboard；超出条件显式转其它 Workflow。
- [ ] HyperFrames 是 Agent 生成 HTML/CSS/GSAP/MJ 图像动画的首选 adapter；Remotion 是 React 组件 adapter；二者都实现同一个 `MotionGraphicRenderer`，不做两套用户界面或两套时间轴。
- [ ] `MotionGraphicItem` 通过 EditorCommandBus 写入 Nomi 时间轴，包含 `artifactId/version`、props、renderer、`sourceEditorRevision`、`timelineVersion`、`assetManifestHash`、`renderManifestHash`、`compositionHash`、`rendererVersion`、`sanitizedCodeHash`、`validationState`。
- [ ] HyperFrames adapter 只做纯编译和渲染：`EditorDocument + AssetRegistry + RenderManifest + ThemeTokens → sanitized HTML composition`；不得自行持久化 Nomi 项目、创建审批、修改 Timeline 或开第二个 Run。
- [ ] 只有一个 shared `MotionGraphicRenderer` 接口（`preflight → compile → inspect → preview → render`）；`src/workbench/motion/*` 只 import shared types，HyperFrames/Remotion/baked adapter 不各自定义 MotionGraphic/Timeline 状态。
- [ ] `MotionGraphicBundle` 是受控的 contentRef，包含 HTML、JS/CSS、字体与资产 manifest、dependency lock、sourceHash/sanitizedCodeHash；不能只保存一个可变文件路径。预捆绑且 hash 锁定的 GSAP/runtime 可执行，用户/社区 composition 仍禁止任意 eval/import/fs/network。
- [ ] 静态拒绝 fs、网络、任意 eval、未注册 import、未注册媒体地址、外部 URL、非法字体、超限资源和非 token 颜色；所有输入必须经过 `outputBindings` 和 asset registry。
- [ ] HyperFrames 执行必须在受控 worker/Chromium sandbox 中，带 CSP、无网络/loopback、明确的 CPU/内存/帧数/资源配额和临时目录；记录 Chromium/CLI/package/license 版本，禁止运行时自动下载或安装社区代码。隔离失败时 preflight blocked，不把 HTML 当可信脚本。
- [ ] 使用 HyperFrames 的 `lint/check/snapshot/preview/render` 语义：单一暂停时间轴、可 seek、无 wall-clock/random/network；预览和正式导出必须使用同一个 `compositionHash`。
- [ ] HyperFrames `motion-doctrine` 的 vector ledger/seam-stamp/seam-gate、`audio clock`、caption/transition 依赖进入 `MotionDesignSpec`/`QualityReport`；相邻镜头的 pair-level handoff 不能只靠 FFmpeg dissolve。
- [ ] 先做低分辨率 smoke render 和 start/mid/end 三帧检查，再允许正式导出；只改文字/颜色/位置/时长等 props 时，只生成新的 motion artifact version 并重渲染该 item。
- [ ] MJ 静态图只是 `sourceAssetIds` 的一种输入，不写死 Midjourney API；其它图像模型输出也能进入同一条 `image asset → motion composition` 路径。
- [ ] `narrative.production`、`edit.assemble` 只有在用户提出标题/Logo/HUD/动态字幕/图表/转场包装时才依赖该阶段；普通视频生成不强制加载 HyperFrames。
- [ ] HyperFrames 的 plan→sketch→build→final look 可作为低成本视觉验证语义，但不能再问一次 Nomi 已完成的剧本/分镜审批；它落在同一 Run 的 `render-preview` gate，唯一审批面仍是 MCP elicitation 或 Nomi takeover。
- [ ] HyperFrames hosted MCP、Studio 的独立 persistence 和 BRIEF/STORYBOARD 不进入 Nomi 后端事实；Nomi 只借其 HTML 合同、Skill 分层、逐帧验证和 Producer 阶段模型。
- [ ] 单独记录 renderer package/CLI/Chromium 版本、许可证和离线可用性；零额度/生产任务不运行 `npx` 网络安装。能力不可用时 preflight 为 blocked 或明确 baked fallback，不能把 Remotion/HyperFrames backend 名字写进 manifest 后实际走 FFmpeg。
- [ ] `baked` fallback 必须在 `RendererSelectionDecision` 中显式出现，review card 标明“不可编辑、来源 renderer、额外成本/质量风险”；没有可用 renderer 则 `selected:'blocked'`，不得静默把 source composition 变成普通视频。
- [ ] MJ 静态图的 parallax 若缺 depth/mask 能力，只允许明确的 2D camera fallback，并把边缘伪影列入 motion QualityProfile；不能把“人物真的走动”误路由成 HyperFrames。
- [ ] 在 package/lockfile 与安装门禁中明确 HyperFrames/Remotion 的真实版本、许可证、Chromium 供应方式和离线打包；先做 `rendererAvailability.test.ts`，没有已安装 renderer 时必须 fail preflight，不能让现有 `remotion-frame-render` 规划器成为 ghost backend。

本任务的**合同和 Skill 映射**在 Task 0A/Task 1A 零额度阶段完成；本任务的**真实 smoke/render 垂直闭环**必须在 Task 2–8 的编辑/Run/快照闭环稳定后开始，不能作为第一阶段的入口。

### Task 12：MCP Editor Tools 与外部 Agent

**Files:**
- Create: `src/workbench/editor/editorMcpTools.ts`
- Modify: `electron/capabilityCore/mcpToolCatalog.ts`
- Modify: `electron/capabilityCore/dispatcher.ts`
- Modify: `electron/capabilityCore/mcpToolResults.ts`
- Modify: `electron/productionRun/artifactProjection.ts`, `electron/capabilityCore/mcpAppWidget.ts`
- Test: `tests/production/editor-mcp-contract.test.mjs`

- [ ] 只暴露高价值操作：read selection、read timeline summary、propose edit、review proposal、apply proposal、read job、cancel/reconcile。
- [ ] 扩展现有 artifact projection/widget，而不是另造预览协议：`nomi_get_artifact`/`nomi_get_preview`/`nomi_get_contact_sheet`/`nomi_get_quality_report`/`nomi_decide_artifact` 与稳定 `nomi://project/{projectId}/run/{runId}/artifact/{artifactId}@{version}` Resource；返回 MIME、hash、过期时间、权限、同一 `approvalId`。外部 Agent 可看脚本、分镜、图片、低清视频/关键帧、MotionGraphic source/preview、波形和 QA，不支持媒体播放时只切换到一次明确 takeover，不重复审批。
- [ ] 外部 Agent 不能直接传 Zustand action、任意 JSON patch 或任意文件路径。
- [ ] 每次写操作带 `clientId/proposalId/baseRevision/idempotencyKey`；过期 revision fail closed。
- [ ] 结果返回 `workflowKind/projectId/runId/editorRevision/proposalId/approvalSurface/nextAction`。
- [ ] 项目写入 lease 只限制并发写，读取不受影响；断线后超时回收，重复提交返回第一次结果。
- [ ] `NOMI_EXTERNAL_AGENT_ONLY=1` 黑盒必须证明正常路径 desktop-click 为 0，Nomi takeover/reconcile 除外。
- [ ] 先做 `initialize` capability negotiation：客户端支持 image/video/audio resources 和 elicitation 时直接在 Agent review packet 中展示；不支持时返回一次 `needs_user_action` + Nomi deep link，不偷偷在两个表面重复确认。Decision receipt 必须含 `clientId/sessionId/approvalId/planHash/baseRevision/issuerSurface`。
- [ ] MCP Apps/富 UI 只作为 progressive enhancement：支持的 host 可在 Agent 内嵌脚本、分镜 contact sheet、候选图、粗剪帧和成本表；Claude/Codex CLI 等文本 host 得到模型可转述摘要、`resource_link`、progress/taskId 和一次 Nomi deep link。两种表面都提交同一个 `gateId+planHash+baseRevision`，不能让 host 自己授予权限或直接 mutate。
- [ ] `nomi_list_artifacts`/`nomi_read_artifact` 与项目重开必须能找到所有中间稿和证据；MCP/右侧 Agent/Task Center 读同一 `ProjectArtifactCatalog`，不能只返回最新一个 preview。
- [ ] 新增 `nomi_set_run_concurrency`/IPC 同一命令面；输入为 requested value + expected run revision，输出 requested/effective/reason/reservation receipt；`tools/list` 在 route/stage resolve 后只暴露当前 stage 的 read/propose/review/apply 工具，legacy 只在显式 `scope=legacy`，并发送 `tools/list_changed`。
- [ ] 每个 MCP tool schema 使用 `additionalProperties:false`，catalog 注明 `readOnlyHint/destructiveHint/idempotentHint/openWorldHint`；写/花费/导出/取消/对账返回结构化 `errorCode/nextAction/retryable/receipt`，并做跨项目 scope/lease/expiry 对抗测试。

### Task 13：真实任务、对抗矩阵和媒体验收

**Files:**
- Create: `tests/ux/editor-workbench-journeys.e2e.mjs`
- Create: `tests/production/editor-adversarial-contract.test.mjs`
- Modify: `scripts/productionTrajectoryContract.mjs`
- Modify: `scripts/analyze-real-film.mjs`
- Create: `scripts/extract-frame-analysis.mjs`, `scripts/real-mcp-review-only.mjs`
- Create: `docs/evals/fixtures/narrative-promo/brief.json`, `script.v1.json`, `storyboard.v1.json`, `quality-profile.json`, `README.md`
- Create: `docs/evals/nomi-editor-workbench-real-tasks.md`
- Create: `docs/audit/2026-08-22-unified-editor-runtime.md` after implementation

必须固化以下任务：

1. J1：一句话做封面，生成四张候选，选一张落项目并导出；证明不会创建 script/storyboard/timeline。
2. J2：用品牌规范批量做六张海报，先看一张样片，设置并发 2，单项失败只重试失败项。
3. J3：导入图片，圈选区域，生成 before/after，保存新版本；原图不被覆盖。
4. J4：做一条目标约 30 秒的叙事宣传片，完成方向、剧本、分镜、样片、批量生成、QA、字幕/音频/转场和导出。
5. J5：导入已有视频，只重做第 3 个片段或删停顿；原片、非目标片段和字幕保持不变。
6. J6：选中时间轴片段，对 Agent 说“删掉停顿”，看到 Diff，应用、撤销、再应用。
7. J7：在播放头插入 AI 过渡镜头，取消一次，再用同一 proposal 逻辑成功插入；不重复扣费。
8. J8：关闭并重开应用，恢复 pending/failed Job、未应用 Proposal 和 EditorDocument。
9. J9：目标 15/30/60 秒，模型时长、音频和参考能力不同，preflight 能解释最终选择。
10. J10：导入一张 MJ/其它图像模型生成的静态图，说“做一个 4 秒轻推镜，标题从下方淡入，保持品牌色”；Router 选择 `motion.graphics`，只加载动效/设计/QA Skill，生成 HyperFrames `MotionGraphicArtifact`，用户一次确认后插入时间轴。
11. J11：只修改 J10 的文字颜色和位置；必须生成新 artifact version、只重渲染该 MotionGraphic clip，原始静态图、视频片段和其它时间轴项 hash 不变；关闭重开后仍能从 `compositionHash` 恢复预览。

J4 的 golden fixture 不把 30 秒当硬常量：`docs/evals/fixtures/narrative-promo/` 固定 brief、script v1/adopted、storyboard、素材/brand token hash、preferred duration range 与质量 rubric；逐镜保留 `narrativeGoal/actionChain/dramaticBeat/continuityLocks/ffDesc/motionDesc/lfDesc`，每个相邻边界抽 early/middle/late 三联帧并记录 `spatialContinuity/causalHandoff/characterState`。字幕边界、显式转场、波形/静音和项目重开任一缺 evidence 都是 fail/blocked。最大迭代次数、人工升级条件和停止原因写入 `QualityProfile`。

对抗测试必须拒绝：

- 手写 `approved`、`providerTaskId`、`pass`；
- 外部 Agent 绕过 Proposal 直接改 Timeline；
- 过期 revision 覆盖当前编辑；
- provider timeout 被误判为 not_found 并重复提交；
- 旧 storyboard revision 被新 Job 偷换；
- 字幕超出视频、音频静音、cut 被冒充显式转场；
- 当前窗口状态与持久化项目不一致时仍导出错误素材。
- MotionGraphic HTML 试图访问 fs/network/eval、未注册 asset 或非 token 样式；
- `asset.single`/`narrative.production` 在没有动效需求时无故加载 HyperFrames，或 HyperFrames adapter 自己创建第二个 Run/approval/timeline。

主观察器指标固定为：`review_gate_coverage`、`provenance_rate`、`bypass_count`（必须为 0）、`recovery_rate`、`decision_load`、`stale_explanation`、`continuity_pass_rate`、`subtitle_sync`、`transition_render_rate`、`audio_audibility`。子 Agent 只能读状态、提交用户意图、选择/批准/要求修订/确认，不得写 run JSON、artifact、providerTaskId 或质量 verdict；真实 provider/GUI seam 失败必须标 `blocked_at_real_seam` 并保留 trace/帧/波形，不能退回脚本手写产物。

Release thresholds：`review_gate_coverage=100%`、`provenance_rate=100%`、`recovery_rate=100%`、`bypass_count=0`、`desktop-click=0`（正常 external path）、每镜/每边界三联帧 verdict 齐全、`subtitle_sync=100%`、每个非-cut transition 有渲染证据、同一 gate 的 `approvalPromptCount=1` 且 `DecisionRecord=1`。`audio_audibility` 的 mean/peak/silenceRatio 阈值来自具体 `QualityProfile`；任何缺证据或未知状态都为 `blocked`，不算通过。

每轮验收都写 `EvaluationIteration`：`iterationId/fixture/actor/surface/inputHash/evidenceUris/metricDeltas/rootCause{symptom,impact,hypothesis,confirmedBy}/patchRefs/rerunScope/stopReason`；固定命令链为 `run → analyze → report → patch → rerun`。达到 `maxIterations` 或真实 provider/GUI seam 不可达时标 `blocked_at_real_seam`，不得降阈值或用手写 JSON 代替。

每个 J 任务都必须同时留下用户动作轨迹、Run/event、ArtifactRecord 版本、EditorDocument/canvas/timeline 投影、Job/attempt、QualityReport（抽帧/波形/字幕/边界）和 retry lineage；不接受“状态是 completed”或“MP4 存在”作为唯一证据。真实媒体验收只在零额度合同、路由、审批、恢复测试通过后执行：

```text
零额度 Workflow/Editor/MCP 合同
→ 一张真实图片 pilot
→ 一个真实视频 Job
→ 再跑完整叙事片
→ 抽帧 + ffprobe + waveform + 轨迹 + 项目重开
```

### Task 14：Electron 升级（独立基础设施任务）

**Files:**
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Inspect/modify if required: `electron/main.ts`, `electron/preload.ts`
- Test: startup, IPC security, build, e2e smoke

- [ ] 先查 Electron 官方支持计划和当前依赖兼容性，再决定目标版本；不凭记忆升级。
- [ ] 升级提交与 Editor Core、Timeline 迁移、Motion adapter 分离。
- [ ] 保持 `contextIsolation: true`、`nodeIntegration: false`、CSP 和外部导航拦截。
- [ ] 未知 IPC channel、任意 fs、任意命令执行和任意网络请求必须被拒绝。
- [ ] 升级阻塞时停在 adapter 边界，不改变产品协议，不把升级问题混入剪辑实现。

---

## 6. 实施批次

### 批次 A：零额度基础协议

Task 0A、Task 0–4、Task 1A。产物是统一事实源/跨进程 service、DecisionRecord、WorkflowDefinition、SkillPack/PromptSpec、HyperFrames MotionGraphic 合同、样张、EditorCommandBus、EditorDocument 兼容包、AssetRegistry、Proposal 编译器。只能做 schema/lint/静态安全测试，不能调用 provider 或渲染付费媒体。

### 批次 B：剪辑 MVP

Task 5、Task 8 的字幕/音频/转场部分、Task 10 的最小 UI。先完成 J1、J3、J5，证明“Agent 能安全改时间轴”。

### 批次 C：生成和恢复

Task 6–7。加入 Model Capability Resolver、ExecutionSnapshot、局部生成插入和 reconcile。先一个真实图片，再一个真实视频 Job。

### 批次 D：Workflow 与 Skill 归一

Task 9。把 `brand.promo`、`drama.short`、`asset.*`、`motion.graphics`、`edit.assemble` 接入同一 registry 和 semantic stage handler；把 prompt/导演/剪辑/设计/QA Skill 从“正文可读”变成有 stage、schema、hash、权限和证据的运行时包。

### 批次 E：动态视觉与外部 Agent

Task 11–12。先完成一个 3–5 秒 HyperFrames MotionGraphic smoke（例如 MJ 静态图的轻推镜 + 标题入场），确认 preview/export parity 和局部重渲染，再 MCP editor tools；正常外部路径必须只有 MCP elicitation。HyperFrames smoke 只消费已批准 snapshot，不重新生成整条片。

### 批次 F：真实任务和最终媒体

Task 13。真实任务必须记录 timestamp、actor、surface、tool、args hash、revision、event cursor、artifact version/hash、providerTaskId、抽帧和音频证据。

Task 14 可独立执行，不得阻塞前五个批次。

---

## 7. 每个批次的质量门

代码门：

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

体验门：

1. 真实壳层样张和实现截图同构建、同入口对账；
2. J1–J11 至少跑通主路径和一个失败恢复路径；
3. 外部 Agent 正常路径 desktop-click 为 0；
4. Nomi 项目内可找到 brief、script、storyboard、asset、job、timeline、export；
5. 预览和导出使用同一 Render Manifest；
6. 任何失败、取消、断线都能解释成本和下一步；
7. 真实视频必须通过时长、字幕、音频、白帧、转场、连续性和项目重开检查。

---

## 8. 评审流程与停止条件

### 8.1 方案评审

在 Task 0 完成后，必须并行完成六角色评审：

1. CTO：是否存在第二套 Run/Store/状态机，是否能演进；
2. 设计师：是否符合 Nomi 密度、token、层级和真实壳层；
3. 产品经理：是否解决剪辑返工，是否范围过大；
4. 前端：是否能复用现有 Timeline/Workbench/Proposal，是否产生性能问题；
5. 后端：IPC、持久化、CAS、Provider、恢复和安全边界；
6. 真实用户：是否少切换、少重复确认、能看懂 Diff、失败能自救。

每个 P0 必须在开工前修正；P1 必须有明确任务和测试；只影响后置 adapter 的 P2 可按批次安排。

### 8.2 实现评审

每个 Task 都按：

```text
写红测
→ 验证确实失败
→ 最小实现
→ 定向测试
→ 相关全量测试
→ diff/code review
→ 用户任务走查
```

不得把 mock provider 的绿色结果当真实 Provider 体验；不得手写 artifact、approval、providerTaskId 或质量 pass。

### 8.3 完成定义

只有同时满足以下条件，才可以称为完成：

1. 封面和海报不进入剧本/分镜流程；
2. 叙事视频仍保留剧本审阅；
3. EditorCommandBus 是所有时间轴写入口；
4. Proposal 有 Diff、revision、成本、撤销和补偿；
5. 生成结果以 AssetRecord 进入项目，再由 Proposal 插入时间轴；
6. 模型时长、音频、参考图按 capability 适配；
7. 外部 Agent 与 Nomi 不重复确认；
8. 单个镜头失败不会重烧整条片；
9. 预览、导出、项目重开状态一致；
10. J1–J11 可复跑，至少一条真实视频通过抽帧、音频、字幕、转场和连续性验收；J10/J11 还必须通过 HyperFrames preview/export parity 和局部重渲染 hash 不变量。

---

## 9. R7 六角色评审回填（2026-08-21 历史轮）

评审均为只读审查，没有修改业务代码、没有调用模型、没有生成媒体。

### CTO + 后端

- **P0：事实源与写入口仍会分叉。** 当前 `WorkbenchStore/TimelineState`、Canvas store、project payload、ProductionRun 都可写；已新增 Task 0A，主进程 `EditorDocumentService` + shared pure core 成为唯一写 owner，renderer 仅 projection。
- **P0：Workflow/Skill/Playbook/GenerationQueue 仍是多套运行语义。** 已规定 `WorkflowDefinition` 统一派生 stages、gates、handlers、MCP enum；`PlaybookRun` 退化为静态拓扑，不再拥有 production cursor；低层 `nomi_generate/canvas.*` 标为 legacy-compat，不进入统一 journey。
- **P0：ExecutionSnapshot 时机不安全。** 已改为合同/预算门前编译 Draft Snapshot，审批绑定 hash，接受后只 seal；Job 保存 snapshot、source revision、依赖波次和 asset manifest hash。
- **P0：生成结果与 EditorDocument 可能半成功。** 已增加 `productionOutbox` 和 `EditorMutationReceipt` 顺序，恢复时可重放。
- **P1：editorRevision/runRevision、RunPolicy、DecisionRecord、ProjectLease 必须单一归属。** 已写入 Task 0A/Task 6/Task 9，禁止重复持有 `maxConcurrentJobs` 或 approval 状态。

### 设计师 + 前端

- **P0：当前代码只有 WorkbenchDocument/TimelineState v1。** 已在 Task 3 增加 discriminated schema、round-trip/idempotence、v1 projection adapter；禁止 normalize 静默丢 v2 metadata。
- **P1：不新建第二个 WorkbenchShell、素材抽屉、Proposal/Undo UI。** Task 10 明确复用 `WorkbenchShell`、`TimelinePanel`、`AssistantTimeline`、`AgentPlanCard`、`ProductionRunTaskCard`、`AssetLibraryContent` 和 `AssetTile`。
- **P1：Canvas node/edge Proposal 与 asset/artifact Proposal 语义不同。** 已增加 `WorkflowProposalViewModel` adapter；通用卡只复用状态/锚点/撤销语义，不把资产强行显示成 node rows。
- **P1：Editor/Canvas/Timeline 选区必须显式 scope/version/hash。** 已加入 Task 4 的 `EditorSelectionContext` 和 stale guard。
- **P2：TaskCenter 等待/暂停/需处理不能显示为 running。** 已加入唯一 `buildProductionRunView()` projection 和真实 status 分组要求。

### 产品经理 + 真实用户

- **P0：不能所有任务都套宣传片审批链。** 已写入 Workflow-specific approval matrix；封面不生成剧本，批量海报一次批次授权，已有素材编辑走 edit.assemble。
- **P0：外部 Agent 审批边界必须明确。** 已统一 `approvalSurface` 和 `DecisionRecord`；Agent elicitation、Nomi UI fallback、takeover 只能消费同一个 approvalId。
- **P1：叙事视频的剧本审阅和分镜审阅不能合并。** 两者解决不同风险；可合并的是合同+预算，不是创意审阅。
- **P1：真实任务必须改成高价值用户目标。** Task 13 已改为封面、批量海报、局部图片编辑、叙事宣传片、已有素材定向剪辑，并额外保留编辑器局部修改和恢复任务。
- **P1：每条任务要记录轨迹、artifact、job、抽帧、音频、QA 和 retry lineage。** 已加入 Task 13 的 trajectory contract 和零额度停止门。

### 评审后的固定取舍

1. 先做 shared/main Editor service、DecisionRecord、WorkflowDefinition、Draft/Sealed Snapshot；不先做漂亮 UI。
2. 先完成两条可证明闭环：`asset.single` 和 `edit.assemble`；其它 Workflow 先完成路由和合同，不同时做五套编排器。
3. Electron 大版本升级后置；HyperFrames/Remotion 的**合同与 Skill 映射前置、真实渲染后置**。HyperFrames 不是被删除，而是作为 `motion.graphics` 的一等 renderer capability 在 EditorCore 稳定后做垂直闭环；它仍不拥有编辑事实源和恢复状态。
4. 正常 UI/内置 Agent/MCP 统一走 ProductionRun；低层旧工具保留兼容但不进入统一验收旅程，后续再删除。
5. 用户真正要的是“一次决定后能继续编辑”，不是更多审批；每个审批必须对应一种不同的高成本风险。

历史轮意见已转成当时的条款；本轮新增复审以 9.1 为准。

## 9.1 R7 六角色复审回填（2026-08-22，基于 origin/main d3bf0aba）

本轮先以 `git show d3bf0aba:<path>` 对账干净基线，再读本地调研、共享调研导出、官方文档和开源实现；当前工作树的脏改动不作为“已实现”证据。结论不是“所有意见已经完成”，而是把剩余合同绑定到 owner/task/test：

- **CTO/后端 P0：** `EditorDocumentService`/`EditorCommandBus`/`ProjectArtifactCatalog`/`ProductionRun` 必须只有一个写入与内容 owner；Run 只保存 artifact IDs/projection，legacy playbook/raw tools 只能 read-only adapter，并在 Task 0A/2/9 做 dual-write、stale、reopen、exactly-once/at-most-once 红测。
- **产品/真实用户 P0：** script_review 必须是独立 durable gate，拒绝/changes_requested 阻断 storyboard/provider；cover/image、existing-edit、motion.graphics 不被迫走剧本/30 秒/音频。Task 1/9/13 固定 golden graph 与同一 approval receipt。
- **设计/前端 P1：** 不重做 Nomi 壳层；Task 10 只把 route/preflight、proposal/diff、candidate/adopted/failed、waiting/attention、MotionGraphic props、音频证据接入现有 slot。MCP Apps/外部 Agent 是渐进增强，CLI 无媒体时只一次 takeover/deep-link。
- **模型/渲染 P0：** CapabilityProfile、QualityProfile、RenderManifestV2、MotionGraphicRenderer、AudioTrackBinding 和 baked/blocked decision 必须是 shared typed owner；ghost renderer、静音默认、非法字体/HTML/网络和缺 renderer 均 preflight blocked。
- **连续性/QA P1：** `storyboardPlan.ts`/`shotLanguage.ts`/`nodePromptOptimizer.ts`/`verifyFocusForVariation.ts` 真实转换器必须保留六镜字段、handoff/DAG、生产前与改写后双 lint；QA 不可达/unknown/缺证据 fail closed，真实验收保留三联帧、波形、字幕、seam 与项目重开证据。
- **Skill/外部 Agent P1：** 31 个 Nomi skill 与 7 个 manifest 进入 inventory/alias/parity；`.agents/.codex` 的 HyperFrames/LibTV 等只作为 source/connector/renderer 输入，不宣称已被 Electron SkillStore 执行。每次加载记录 body/manifest hash、selected sections、input/output hash；缺包不得写 `declared` 假证据。

未决项必须在实现前逐项关闭；任何“文档写了但没有真实 trace/截图/媒体证据”的条目仍视为未完成。
