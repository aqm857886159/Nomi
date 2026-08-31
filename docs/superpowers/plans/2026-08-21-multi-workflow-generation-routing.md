# Nomi 多工作流生成路由与 Skill 编排实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 Nomi 根据用户真正要做的事选择最小必要工作流：封面/海报不再被迫走剧本分镜生产线，叙事视频仍保留可恢复的 Production Run，并且两者都能在 Claude Code、Codex、WorkBuddy 等 Agent 桌面端完成确认，最后把产物和轨迹落回 Nomi 项目。

**Architecture:** 复用现有 `skill.json + SKILL.md + PlaybookRun`，增加一个轻量的 workflow kind/路由层，不另造第二个 Agent。MCP 只负责把 workflow 暴露给外部 Agent：只读上下文走 resources，方法论走 prompts，实际动作走 tools，付费动作通过 MCP elicitation 询问真人；Nomi 负责持久化状态、资产、失败恢复和无 elicitation 客户端的接管兜底。每条工作流使用自己的中间产物和审批策略，但共享模型目录、素材导入、生成请求、项目资产和审计轨迹。

**Tech Stack:** Electron + React + TypeScript；现有 `electron/skills/skillManifestSchema.ts`、`electron/skills/playbookOrchestrator.ts`、`electron/capabilityCore/mcpProtocol.ts`、`electron/capabilityCore/mcpToolCatalog.ts`、`electron/capabilityCore/dispatcher.ts`、模型 catalog/archetype 输入映射；Vitest、真实 MCP 黑盒测试、零额度 UI 走查。

---

## 0. 先把四个概念分开

这次不把“Skill、工作流、MCP、Nomi 界面”当成一个东西：

| 概念 | 它回答什么问题 | Nomi 里对应什么 |
|---|---|---|
| Skill | 这一类创作应该怎么想、怎么写 prompt、怎么审美 | `SKILL.md`，例如 `director-cinematography`、`director-consistency` |
| Workflow / Playbook | 这次任务要经过哪些阶段、哪些阶段依赖前一步、在哪里停下来问人 | `skill.json.stages` + `PlaybookRun` |
| MCP | 外部 Agent 如何发现上下文、调用动作、被询问确认 | `resources/*`、`prompts/*`、`tools/call`、`elicitation/create` |
| Nomi 项目 | 结果和中间稿在哪里可找、失败后从哪里继续 | 项目资产、Run、画布节点、时间轴、事件和深链 |

一句话：**Skill 是“方法”，Workflow 是“路线”，MCP 是“遥控器”，Nomi 项目是“收货和恢复的地方”。**

这也回答“是不是相当于 Skill 被调用”：是，但不是“每次都调用 20 多个导演 Skill”。正确做法是先选一个工作流，再由该工作流的每个阶段按需加载 1–4 个相关 Skill。现有 MCP 已经用 `resources/list` 只列技能摘要，用 `resources/read` / `prompts/get` 按需读取正文，符合渐进披露。

## 1. 外部实现调研：哪些值得直接借

### 1.1 MCP 官方协议：资源、提示、工具、询问各司其职

MCP 官方规范把服务器能力拆成 Resources、Prompts、Tools，客户端可提供 Elicitation；安全原则要求动作前有明确同意、用户能理解并拒绝。Elicitation 的 schema 只支持扁平的字符串/数字/布尔/枚举字段，因此“确认一次本批生成”应是一个简单的确认请求，不要把整个分镜 JSON 塞进审批表单。

借鉴到 Nomi：

- `resources/list`：只列 `director-*` / `writer-*` 技能摘要。
- `resources/read` 或 `prompts/get`：只加载当前 workflow 当前 stage 需要的正文。
- `nomi_generate` / `nomi_generate_batch`：只做生成动作，不负责替用户编剧或编排整部片。
- `elicitation/create`：在 Claude/Codex/WorkBuddy 内问“这次要生成什么、预计多少额度、确认吗”。
- `decline` / `cancel`：都必须返回可恢复状态，不能让 Run 永远停在“等待”而没有下一步。

### 1.2 LangGraph：图可以暂停、并行、从 checkpoint 恢复

LangGraph 的核心不是“多放几个 Agent”，而是持久化 state、用 interrupt 暂停、用 thread/checkpoint 恢复；独立 I/O 任务可并行，依赖任务必须等前置完成，副作用在 interrupt 前必须幂等。

借鉴到 Nomi：

- Production Run 是一个有依赖的 DAG，不是单纯数组循环。
- 海报批量生成是同一 workflow 内的并行 item，不需要剧本审阅。
- 用户拒绝或 provider 暂时失败时保存 checkpoint，恢复同一 item，禁止整批重跑。
- “已生成的结果不要因下一次审阅重算”成为测试不变量。

### 1.3 ComfyUI：可复用的是 workflow/subgraph，不是把所有节点摊给用户

ComfyUI 官方 workflow templates 把完整 workflow 和可复用 subgraph blueprint 分开；复杂节点可以封装成一个用户能理解的“文字生图”或“改图”原语。

借鉴到 Nomi：

- 画布节点是底层执行图；用户/外部 Agent 默认看到的是“海报生成”“首帧→视频”“品牌宣传片”这种 workflow 原语。
- Workflow 可以落画布，但“落画布”不是所有任务的前置条件。
- 参考图、参数和结果必须以独立结构化记录保存，不把 workflow 藏在图片元数据里。

### 1.4 Canva MCP：创建、选择、编辑、提交不能混成一次 regenerate

Canva 的官方 MCP 验证链是 `generate-design` 先返回候选，用户选择后 `create-design-from-candidate`；编辑走 `start-editing-transaction → perform-editing-operations → commit-editing-transaction`，不能把一次小改动重新生成整张设计，也不能把未 commit 说成已保存。

借鉴到 Nomi：

- 海报/封面先生成候选或批次，再由用户选“采用哪一张”；改标题、换 logo、换截图走 patch，不重跑整张。
- 结果必须区分 `candidate`、`adopted`、`committed`。
- 外部 Agent 读到的是可追溯 artifact，不是一个失效的供应商 URL。

### 1.5 InVideo / LTX：视频产品也不是一条“Prompt 直出最终片”

InVideo Vision 的官方流程是先把文字和参考图变成固定的 9-shot storyboard，先锁角色、光线和 art direction，再从单帧 extract 到视频；InVideo 还允许按 Agent 回合设置 credits、项目额度和“生成前询问”。LTX 则明确区分完整创作套件、开发者 API 和自托管模型，不能把 API 能力误当成 Studio 工作流。

借鉴到 Nomi：

- 叙事视频需要 storyboard/continuity；海报不需要。
- “一键初稿”是可编辑 draft，不是最终交付。
- 生成预算必须在 workflow 层可见，而不是每个底层模型调用各弹一张互不相干的卡。

### 1.6 Cline：审批面应跟着用户所在的 Agent，而不是跟着窗口猜

Cline 同时支持终端询问、桌面 IPC 审批和自动批准模式；拒绝后返回给 Agent 继续调整，不把任务卡死。这个模式比“只要 Nomi 窗口开着就把人赶回 Nomi”更符合外部 Agent 的真实使用方式。

## 2. 目前 Nomi 的真实边界与这次拦截

### 2.1 现有代码其实已经有两种路线，但还没有统一路由

- `skills/brand-promo/skill.json` 是叙事视频 playbook：`script → storyboard → build → generate → assemble`。
- `electron/capabilityCore/mcpToolCatalog.ts` 的 `nomi_generate` 是单次素材生成，已经支持 `intent=image/video/text/audio`、`aspect_ratio`、`resolution`、`duration`、`seed`、首帧/尾帧描述和 `nomi_import_asset`。
- `electron/skills/playbookOrchestrator.ts` 已有 stage DAG、`dependsOn`、`pause` 和阶段工具白名单。
- `electron/capabilityCore/mcpProtocol.ts` 现在的设计是：客户端声明 elicitation 时在 Agent 内确认；客户端不支持时，Nomi 开着则落应用内 SpendConfirmDialog；两边都不能确认则拒绝付费动作。

### 2.2 营销海报为什么被拦

这次不是内容审核拦截，也不是 provider 拒绝，更不是已经扣费后失败。它停在“确认生成”安全卡，说明付费闸门在 provider 请求之前生效，所以没有生成图片、没有消耗额度。

实际体验表明，当前海报 pilot 走的是通用 `nomi_generate` 的**应用内兜底面**。这通常意味着外部 Agent 没有在 MCP `initialize` 中声明 `capabilities.elicitation`，或者运行的已安装包还没有包含最新的 elicitation-first 路由。问题不是“要不要安全闸”，而是“安全闸出现在哪”：

- 从 Nomi 内发起：Nomi 的 SpendConfirmDialog 应保留。
- 从 Claude/Codex/WorkBuddy 发起，且客户端支持 elicitation：确认应出现在 Agent 对话里，Nomi 不再打断。
- 客户端不支持 elicitation：才允许 Nomi 卡兜底，并且 MCP 结果要明确返回 `approvalSurface: "nomi-ui"` 和下一步，不能让 Agent 误以为生成器挂死。

下一版还要把“6 张海报”变成一次批次授权：展示模型、参考图数量、输出尺寸、最大尝试次数和预算上限，用户确认一次；每张结果仍单独记 artifact、prompt、引用、状态和失败原因。

## 3. 用户真正会遇到的工作流矩阵

| 用户说什么 | Workflow kind | 中间产物 | 最少审批 | 是否需要 storyboard / timeline |
|---|---|---|---|---|
| “做一张封面图” | `asset.single` | asset candidate → adopted asset | 一次付费确认；可选采用确认 | 否 |
| “做 6 张产品海报” | `asset.batch` | batch brief → 6 candidates → selected/adopted assets | 一次批次预算确认；必要时只审失败项 | 否 |
| “把这张图改成竖版/换背景” | `asset.edit` | source asset → edit candidate → adopted asset | 一次付费确认；改动 patch 优先 | 否 |
| “探索 3 个角色/构图方向” | `canvas.explore` | text/reference/config nodes → media nodes | 画布方案确认 + 生成预算确认 | 否；画布是探索面 |
| “做 30 秒宣传片” | `narrative.production` | direction → script → storyboard → jobs → QA → rough cut → export | 方向、剧本、分镜、预算/冻结、样片/镜头、粗剪；可合并相邻低风险门 | 是 |
| “把已有镜头排成片并加字幕” | `edit.assemble` | timeline draft → QA → export | 粗剪/导出确认 | 不需要重新写剧本/分镜 |

### 用户界面应该怎么表现

用户只应该看到一个“当前任务卡”，而不是被迫理解所有内部阶段：

```text
海报：确认本批生成（6 张 · gpt-image-2 · 3:4 · 2K · 预算上限 X）
视频：剧本已成稿 → 审阅剧本
视频：分镜已成稿 → 审阅分镜
```

同一个任务卡在 Agent 外部和 Nomi 内部是同一个 durable approval；正常路径只出现一个面，另一面是接管入口，不是第二次确认。

## 4. 目标架构：一个基础执行层 + 多个可组合 workflow

### 4.1 Manifest 增加工作流身份和审批策略

在 `electron/skills/skillManifestSchema.ts` 的可选字段中加入：

```ts
workflowKind?: "asset.single" | "asset.batch" | "asset.edit" |
  "canvas.explore" | "narrative.production" | "edit.assemble"

approvalPolicy?: {
  spend: "none" | "once" | "batch" | "per_item" | "per_shot"
  review: "none" | "candidate" | "stage" | "per_item"
  fallbackSurface: "nomi_ui" | "agent_only" | "either"
}
```

`workflowKind` 负责路由，`stages` 负责执行顺序，`pause` 负责阶段暂停；不让 Agent 从 description 猜“这是不是要走 Production Run”。没有新字段的旧 Skill 继续按 legacy 单段工作。

### 4.2 工作流不是大一统，而是可组合 stage

共享 stage 原语：`intake`、`load_skill`、`import_asset`、`compose_prompt`、`create_candidates`、`select_candidate`、`generate_batch`、`review_candidate`、`materialize_canvas`、`assemble_timeline`、`qa`、`export`。

示例：

```text
asset.single       = intake → load_skill → authorize_once → generate → adopt
asset.batch        = intake → load_skill → authorize_batch → generate_parallel → select/adopt
asset.edit         = import/source → describe_patch → authorize_once → generate_edit → adopt
canvas.explore     = intake → create_nodes → authorize_once → generate_nodes → inspect
narrative.production = direction → script(review) → storyboard(review) → materialize
                      → budget/freeze → dependency-aware generate → QA → rough-cut/export
edit.assemble      = import/read timeline → arrange → subtitle/transition QA → export
```

任何 workflow 都可以把一个 stage 的结果作为另一个 workflow 的输入，例如：

```text
asset.single(角色参考图) → narrative.production(角色锚)
asset.batch(6 张海报) → edit.assemble(海报轮播视频)
canvas.explore(选中的构图) → asset.edit(统一品牌排版)
```

### 4.3 批量并行和连续依赖是两种不同关系

- `asset.batch` 的 6 张海报默认互相独立，可以并行；并发数由用户或策略设置控制。
- 叙事视频中只有显式声明 `previousShotId` / `firstFrameRef` 的镜头才依赖上一镜；角色/场景锚是另一类依赖。
- 当前这次 6 镜 storyboard 的 authored plan 是 `s1 → s2 → … → s6`，但 production binding 的 metadata 曾丢掉 `previousShotId`、`firstFrameRef`、`continuityLocks`，导致调度器可能把连续镜头误当独立镜头。这是必须修的字段守恒问题，不应靠“把并发调成 1”掩盖。

## 5. 实施任务

### Task 1: 把 workflow kind 接到现有 Skill Pack

**Files:**

- Modify: `electron/skills/skillManifestSchema.ts`
- Modify: `electron/skills/skillStore.ts`
- Modify: `electron/skills/playbookOrchestrator.ts`
- Test: `electron/skills/skillManifestSchema.test.ts`
- Test: `electron/skills/playbookOrchestrator.test.ts`

- [ ] **Step 1: 写失败测试**：旧 manifest 无 `workflowKind` 仍可加载；`asset.batch` 能通过；未知 kind、未知审批值必须拒绝；stage 只能使用该 workflow 声明的工具。
- [ ] **Step 2: 运行失败测试**：`pnpm exec vitest run electron/skills/skillManifestSchema.test.ts electron/skills/playbookOrchestrator.test.ts`，先确认新字段尚不存在。
- [ ] **Step 3: 最小实现**：增加上述两个可选字段；旧包默认 `workflowKind="canvas.explore"`，不得默认升级为 Production Run。
- [ ] **Step 4: 运行测试**：同一命令必须全绿，并保留 legacy skill 回归。

### Task 2: 增加 workflow router，不让 Agent 自己猜路线

**Files:**

- Create: `electron/skills/workflowRouter.ts`
- Test: `electron/skills/workflowRouter.test.ts`
- Modify: `electron/capabilityCore/mcpToolCatalog.ts`
- Modify: `electron/capabilityCore/mcpProtocol.ts`

- [ ] **Step 1: 写路由红测**：输入“做一张封面图”得到 `asset.single`；“做 6 张海报”得到 `asset.batch`；“做 30 秒宣传片”得到 `narrative.production`；“把已有素材剪成片”得到 `edit.assemble`；含糊输入返回最多 3 个候选，不直接启动付费动作。
- [ ] **Step 2: 运行红测**：`pnpm exec vitest run electron/skills/workflowRouter.test.ts`。
- [ ] **Step 3: 实现**：先匹配显式用户意图/已选 skill，再匹配 manifest `workflowKind`，最后才用 description；禁止用“有视频”作为 Production Run 的唯一条件。
- [ ] **Step 4: MCP 暴露**：`nomi_intake_brief` 返回 `workflowKind`、预计中间产物、审批次数和是否进入 Nomi 时间轴；外部 Agent 可在一次询问中确认路线。
- [ ] **Step 5: 验证**：重复运行路由单测，并用 MCP `resources/list` / `prompts/get` 验证只加载当前路线需要的 skills。

### Task 3: 统一审批面，但不删除付费安全闸

**Files:**

- Modify: `electron/capabilityCore/mcpProtocol.ts`
- Modify: `electron/capabilityCore/mcpToolCatalog.ts`
- Modify: `electron/capabilityCore/mcpToolResults.ts`
- Modify: `electron/spend/spendGrant.ts`
- Test: `electron/capabilityCore/nomiMcpElicitation.test.ts`
- Test: `electron/capabilityCore/nomiMcpApps.test.ts`

- [ ] **Step 1: 写真实失败测试**：MCP client 声明 elicitation 且 Nomi App 开着时，`nomi_generate` 不应弹 Nomi SpendConfirmDialog；不声明 elicitation 时才返回 `approvalSurface="nomi-ui"`；取消必须返回“未生成、未扣费”。
- [ ] **Step 2: 写批量授权测试**：6 个独立 image item 只有一个 `elicitation/create`，授权包含 `count=6`、预算上限和模型/画幅摘要；某一项失败只能重试该 item。
- [ ] **Step 3: 实现**：增加 `nomi_generate_batch`（每项保留独立 artifact/job），或等价地给现有生成请求增加 batch contract；授权令牌绑定 `projectId + workflowId + batchId + maxItems + maxSpend`，不能扩大到别的项目。
- [ ] **Step 4: 结果可观测**：所有工具结果都带 `workflowKind`、`approvalSurface`、`authorizationId`、`artifactIds`、`nextAction`；不能只返回“请去 Nomi 点一下”。
- [ ] **Step 5: 验证**：`pnpm exec vitest run electron/capabilityCore/nomiMcpElicitation.test.ts electron/capabilityCore/nomiMcpApps.test.ts`，再跑零额度 Agent-only UI 测试。

### Task 4: 修复 storyboard 依赖字段守恒

**Files:**

- Modify: `electron/productionRun/productionRunArtifactHelpers.ts`
- Modify: `electron/productionRun/productionRunIpc.ts`
- Test: `electron/productionRun/productionStoryboardBinding.test.ts`
- Test: `electron/productionRun/productionRunIpc.test.ts`

- [ ] **Step 1: 写红测**：绑定 metadata 经过 service 和 IPC 后仍包含 `previousShotId`、`firstFrameRef`、`continuityLocks`、`narrativeGoal`、`actionChain`、`dramaticBeat`、`transition`。
- [ ] **Step 2: 运行红测**：`pnpm exec vitest run electron/productionRun/productionStoryboardBinding.test.ts electron/productionRun/productionRunIpc.test.ts`，旧 IPC helper 应丢掉这些字段。
- [ ] **Step 3: 实现**：只保留经过白名单清洗的字段；IPC 复用 `productionRunArtifactHelpers.storyboardMetadata`，不保留第二份漂移的 sanitizer。
- [ ] **Step 4: 验证调度**：给 s1→s2→s3 的 job metadata，确认 s2 在 s1 adopted 前不会提交，s3 在 s2 adopted 前不会提交；无 `previousShotId` 的 anchor 和独立海报 item 可以并发。

### Task 5: 海报/封面 workflow 落项目，但不落 Production Run

**Files:**

- Create: `skills/asset-poster/SKILL.md`
- Create: `skills/asset-poster/skill.json`
- Modify: `electron/capabilityCore/mcpToolCatalog.ts`
- Modify: `electron/capabilityCore/dispatcher.ts`
- Test: `electron/capabilityCore/assetWorkflowJourney.test.ts`

`asset-poster/skill.json` 的实际阶段应是：

```json
{
  "name": "asset.poster",
  "version": "1.0.0",
  "workflowKind": "asset.batch",
  "description": "当用户要做封面、海报、产品图、社交媒体视觉稿时调用；不写剧本、不建分镜、不进时间轴。",
  "tools": ["nomi_import_asset", "nomi_generate_batch", "nomi_get_artifact"],
  "requiredProviders": ["image"],
  "permissions": ["read-only", "create"],
  "approvalPolicy": { "spend": "batch", "review": "candidate", "fallbackSurface": "either" },
  "stages": [
    { "id": "brief", "goal": "确定用途、画幅、文案和参考事实", "tools": ["nomi_import_asset"], "pause": false },
    { "id": "generate", "goal": "一次授权后生成候选海报批次", "tools": ["nomi_generate_batch"], "dependsOn": ["brief"], "pause": true, "modelPrefs": [{ "kind": "image" }] },
    { "id": "adopt", "goal": "用户选择要保留的候选并保存到项目资产", "tools": ["nomi_get_artifact"], "dependsOn": ["generate"], "pause": true }
  ]
}
```

- [ ] **Step 1: 先写 journey 红测**：海报 workflow 不允许调用 `production.plan-script`、`production.plan-storyboard`、`arrange_storyboard_to_timeline`；结果必须出现在项目资产库。
- [ ] **Step 2: 实现 skill pack 与 batch contract**。
- [ ] **Step 3: 用真实参考图做零额度 dry-run**：检查请求摘要、审批面和落盘路径，不调用 provider。
- [ ] **Step 4: 只有用户明确授权真实海报试跑时，才执行一次小批次 pilot；不得自动继续 6 张全量。

### Task 6: 叙事视频 workflow 保留，但合并低风险审阅

**Files:**

- Modify: `skills/brand-promo/skill.json`
- Modify: `skills/brand-promo/SKILL.md`
- Modify: `electron/productionRun/productionRunDriverOps.ts`
- Test: `electron/capabilityCore/mcpConversationJourney.test.ts`
- Test: `tests/production/production-trajectory-contract.test.mjs`

- [ ] **Step 1: 维持三道创作门**：方向/剧本/分镜仍然是用户真正会改内容的门；不能因为想快就自动采用。
- [ ] **Step 2: 合并生成门**：预算、冻结、sample/shot 的确认按用户策略合并；默认串行保护连续性，允许用户显式设置 `maxConcurrentJobs`。
- [ ] **Step 3: 粗剪和导出合并为一个 Agent 确认（已有 `nomi_approve_rough_cut` 方向），Nomi 内只留“查看/接管”，不再第二次弹卡。
- [ ] **Step 4: 轨迹合同区分 `mcp-elicitation` 与 `nomi-ui-takeover`，保证外部 Agent 真正完成了确认，而不是测试脚本代点 DOM。

### Task 7: 为每种 workflow 建真实用户任务，不允许假绿

**Files:**

- Create: `tests/production/asset-workflow-journey.test.mjs`
- Modify: `tests/ux/production-mcp-journey.e2e.mjs`
- Modify: `scripts/productionTrajectoryContract.mjs`
- Create: `docs/evals/2026-08-21-multi-workflow-baseline.md`

- [ ] **Step 1: 零额度任务**：封面单图、6 张海报批次、角色参考图→叙事视频、已有素材→时间轴，各自检查 route、tool coverage、approval surface、artifact/project 落盘。
- [ ] **Step 2: 负向任务**：封面请求不得进入 storyboard；视频请求不得跳过 script/storyboard；不支持 elicitation 的客户端不得无声等待。
- [ ] **Step 3: 真实任务指标**：workflow routing accuracy、approval count、agent-only approval rate、artifact persistence、providerTaskId trace rate、per-item retry rate、dependency violation count。
- [ ] **Step 4: 验证命令**：

```bash
pnpm exec vitest run electron/skills/skillManifestSchema.test.ts electron/skills/playbookOrchestrator.test.ts electron/skills/workflowRouter.test.ts
pnpm exec vitest run electron/capabilityCore/nomiMcpElicitation.test.ts electron/capabilityCore/assetWorkflowJourney.test.ts
pnpm exec vitest run electron/productionRun/productionStoryboardBinding.test.ts electron/productionRun/productionRunIpc.test.ts
pnpm run typecheck
pnpm build
```

## 6. 审批节点的最终判断

不建议“所有流程都保留所有审批”，也不建议删除安全闸。建议按风险和用户真正要改的内容分层：

| 阶段 | 封面/海报 | 30 秒叙事视频 |
|---|---|---|
| 方向确认 | 可选；含糊时才问一次 | 保留；决定故事走向 |
| 剧本审阅 | 不需要 | 保留；这是最值得人改的一稿 |
| 分镜审阅 | 不需要 | 保留；决定镜头和连续性 |
| 付费确认 | 一次批次授权 | 一次预算/冻结授权，之后按策略提交 |
| 每张/每镜确认 | 默认不需要；只审候选或失败项 | 依赖链/高成本镜头可逐镜，其余按并发策略 |
| 粗剪/导出 | 不需要 | 合并成一次 Agent 端确认 |

## 7. 验收门和明确不做的事

### 必须满足

1. 用户说“封面图”，Nomi 不会凭空创建剧本、分镜、时间轴。
2. 用户说“30 秒故事”，Nomi 不会把单次 `nomi_generate` 当成完整制作，也不会丢失剧本/分镜审阅。
3. Agent 支持 elicitation 时，正常确认全在 Agent 端；Nomi 只保存结果和提供接管入口。
4. Agent 不支持 elicitation 时，Nomi 卡必须明确显示“这是外部确认的兜底”，并返回可行动的 nextAction。
5. 批量生成只询问一次预算，但每个 item 独立可重试、可追踪、可删除。
6. 任意 workflow 的最终结果和中间产物都能在 Nomi 项目中找到。
7. 没有真实 provider 调用、抽帧/审片和轨迹证据，不得声称“质量通过”。

### 明确不做

- 不把所有任务统一改成 Production Run。
- 不让 `SKILL.md` 直接拥有任意代码执行权限；Skill 只声明方法和最小工具白名单。
- 不让 MCP 工具通过环境变量绕过付费确认。
- 不用“把并发设成 1”掩盖 storyboard 依赖字段没有传到底层的问题。
- 不因一次海报生成失败而自动进入内容生产或重复扣费。

## 8. 当前结论

这次海报被拦截其实暴露了一个正确但未完成的边界：**付费闸门是对的，审批面和 workflow 路由还不够清楚。** Nomi 现在已经有 playbook、skill 资源、单次生成、素材导入和 MCP elicitation 的积木；下一步不是再造一个巨型 Agent，而是把这些积木按 `asset.*`、`canvas.*`、`narrative.*`、`edit.*` 组合起来，并把“哪个客户端负责问人”记录在结果里。

本计划完成后，“做一张封面图”和“做一部 30 秒片”会是两种可解释、可恢复、可单独验收的用户体验，而不是同一套长流程的两个入口。

## 9. 参考资料

- MCP Specification / Elicitation：<https://modelcontextprotocol.io/specification/2025-06-18/index>、<https://modelcontextprotocol.io/specification/2025-06-18/client/elicitation>
- LangGraph Interrupts / Persistence：<https://docs.langchain.com/oss/python/langgraph/interrupts>、<https://docs.langchain.com/oss/python/langgraph/persistence>
- ComfyUI 官方 workflow templates / subgraph blueprints：<https://github.com/Comfy-Org/workflow_templates>
- InVideo storyboard 与 credits 审批：<https://help.invideo.io/en/articles/14754413-creating-storyboards-with-invideo>、<https://help.invideo.io/en/articles/14718313-how-credits-are-charged-when-using-ai-agents>
- Canva MCP workflow verification：<https://www.canva.dev/docs/mcp/verify-integration/>
- LTX Platform / API / self-hosted 边界：<https://help.ltx.io/hc/en-us/articles/32487503247122-Understanding-the-difference-between-LTX-Platform-the-LTX-2-API-and-self-hosting-the-open-source-model>
- Cline MCP / approval modes：<https://github.com/cline/cline/blob/main/docs/sdk/guides/permission-handling.mdx>
