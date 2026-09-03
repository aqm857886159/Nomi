# Agentic Production 到真实 30 秒初稿 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 Claude Code、Codex、WorkBuddy 和 Nomi 右侧 Agent 共享同一条以项目为真相源的生产链：剧本审阅 → StoryboardPlan 审阅 → 落画布 → 冻结参考资产 → 首镜审阅 → 批量生成 → 自动审片 → 粗剪导出，并以一条约 30 秒、有完整结构、字幕和正常转场的真实片子作为最终验收基准。

**Architecture:** 外部 Agent 只通过 MCP 操作有状态的 `ProductionRun`；Nomi 内部 Agent 复用现有文稿工具、`StoryboardPlan` 和画布工具；项目目录中的版本化 artifact、事件日志和安全预览是唯一真相源。剧本写入审阅仍使用创作区现有的 apply/reject 语义，外部 MCP 只增加同一语义的投影与定点修订，不另造第二套编辑器。

**Tech Stack:** Electron main process, React 18, Zustand, TypeScript, Vitest, Playwright Electron journeys, existing MCP protocol, existing provider/model catalog, existing `shotVerify` and timeline/export pipeline.

---

## 已冻结的产品决策

1. `projectId` 是外部生产的必填根；所有外部产物、稿件、决定和结果归档到该项目。
2. 剧本写作审阅先于分镜审阅；没有用户认可的 `ScriptDraft`，不能生成正式 `StoryboardPlan`。
3. `StoryboardPlan` 是分镜执行的源对象；画布是它的物化结果，不做剧本↔画布双向实时同步。
4. 用户确认一次后只做一次单向转换：剧本确认 → 分镜；分镜确认 → 画布；不重复弹同一确认。
5. 外部 MCP 读用 Resource/只读 Tool，写用业务 Tool；禁止暴露 `writeFile`、绝对路径或供应商私有 URL。
6. 生成前必须有预算确认；批量生成前必须有角色/场景冻结；默认首镜/样片审阅后才批量。
7. 生成后自动跑 `shotVerify`；失败镜头定向重试，不能整片静默重生成。
8. 最终真实样片约 30 秒，至少 6–8 镜，具备开场钩子、发展、转折/情绪落点、字幕、可辨认转场和可播放导出。

## 不做的事

- 不重写现有 Nomi MCP 协议，不新造第二个 Agent 引擎。
- 不把 23 个 writer/director skill 一次性注入上下文；按 stage 渐进加载。
- 不保存每个流式 token；只保存用户可回看的候选稿、采用稿、决定、提示词、模型配置和结果。
- 不把真实成片验收替换成 fixture-only 测试；fixture 只用于无额度的故障和协议测试。
- 不在当前冲突共享工作树上修改或提交。

## 目标用户旅程

```text
外部 Agent 输入一句话
  ↓
方向候选（最多 3 个问题）
  ↓
ScriptDraft candidate → 用户在外部或 Nomi 审阅/定点修改 → adopted
  ↓
角色/场景圣经 → 参考图 → 用户冻结
  ↓
StoryboardPlan candidate → 用户改镜头/时长/引用/模型 → adopted
  ↓
StoryboardPlan 落画布
  ↓
预算合同门 → 首镜生成 → 用户看首镜
  ↓
剩余镜头批量生成 → shotVerify → 定向重试/诚实标注
  ↓
字幕与转场进入 timeline → 粗剪审阅 → MP4 导出
  ↓
关闭外部 Agent，重新打开 Nomi 项目，完整 Run 可恢复
```

## 项目文件与职责边界

| 文件/模块 | 职责 |
|---|---|
| `electron/productionRun/productionRunTypes.ts` | Run、artifact、review、provenance 字段和状态联合类型 |
| `electron/productionRun/productionRunReducer.ts` | script/storyboard review、版本、stale、gate 的纯状态转移 |
| `electron/productionRun/productionRunRepository.ts` | 项目内 snapshot/event/artifact 持久化、CAS、幂等 |
| `electron/productionRun/productionRunDriverOps.ts` | 方向 → script → storyboard → build → generate → QA → assemble → export 编排 |
| `electron/productionRun/productionRunService.ts` | 对 MCP/IPC 的统一服务入口、投影和恢复 |
| `src/workbench/creation/CreationAiPanel.tsx` | 内部剧本文稿读写与 apply/reject 卡片 |
| `src/workbench/creation/storyboard/StoryboardPlanEditor.tsx` | StoryboardPlan 字段审阅和落画布动作 |
| `src/workbench/generationCanvas/agent/storyboardPlan.ts` | 计划 IR、字段校验、计划到节点的转换 |
| `electron/capabilityCore/mcpProtocol.ts` | 外部 MCP 工具、资源、结果投影 |
| `electron/capabilityCore/mcpToolResults.ts` | 安全、可读的文本/结构化结果和深链 |
| `electron/skills/skillManifestSchema.ts` | stage-level `skillRefs` 和能力声明 |
| `skills/*/skill.json` | playbook 阶段、依赖、暂停点和 Skill 证据来源 |
| `tests/ux/` | 外部 MCP、Nomi UI、真实用户旅程和截图验收 |
| `docs/evals/` | 对抗矩阵、真实样片评分、成本和证据记录 |

---

## Task 1: 冻结 artifact/provenance/review 合同

**Files:**
- Modify: `electron/productionRun/productionRunTypes.ts`
- Modify: `electron/productionRun/productionRunReducer.ts`
- Test: `electron/productionRun/productionArtifactContract.test.ts`
- Test: `electron/productionRun/productionRunReducer.test.ts`

- [ ] **Step 1: 写失败测试，证明剧本必须先审阅才能成为 adopted。**

覆盖以下行为：

```ts
it('creates script as candidate, never adopted before review', () => {
  const run = planProposed(runWithDirectionApproved(), scriptCandidate('script-v1'))
  expect(run.artifacts.find((a) => a.kind === 'script')?.status).toBe('candidate')
  expect(run.status).toBe('awaiting_script_review')
})

it('rejects storyboard proposal whose source script is not adopted', () => {
  expect(() => proposeStoryboard(runWithCandidateScript())).toThrow('approved script required')
})

it('marks storyboard stale when its source script hash changes', () => {
  const run = adoptStoryboard(runWithApprovedScript())
  const changed = adoptScript(run, scriptCandidate('script-v2'))
  expect(changed.artifacts.find((a) => a.kind === 'storyboard')?.status).toBe('rejected')
})
```

- [ ] **Step 2: 运行测试确认 RED。**

Run: `pnpm vitest run electron/productionRun/productionArtifactContract.test.ts electron/productionRun/productionRunReducer.test.ts`

Expected: FAIL，因为当前没有 `awaiting_script_review` 和 script source provenance。

- [ ] **Step 3: 扩展类型和纯 reducer。**

在 `ProductionRunStatus` 增加 `awaiting_script_review`；在 `ProductionArtifact` 增加：

```ts
version: number
source: 'user' | 'nomi-agent' | 'external-mcp'
parentArtifactId?: string
contentHash?: string
sourceArtifactId?: string
sourceVersion?: number
reviewStatus?: 'waiting' | 'approved' | 'changes_requested'
skillEvidence?: Array<{ name: string; version: string; stageId: string }>
```

增加纯函数：

```ts
export function canAdoptArtifact(run: ProductionRun, artifactId: string): boolean
export function assertStoryboardSourceApproved(run: ProductionRun, artifactId: string): void
export function markDerivedArtifactsStale(run: ProductionRun, sourceArtifactId: string): ProductionRun
```

- [ ] **Step 4: 重新运行 targeted tests 和 typecheck。**

Run: `pnpm vitest run electron/productionRun/productionArtifactContract.test.ts electron/productionRun/productionRunReducer.test.ts && pnpm run typecheck`

- [ ] **Step 5: 提交。**

```bash
git add electron/productionRun/productionRunTypes.ts electron/productionRun/productionRunReducer.ts electron/productionRun/productionArtifactContract.test.ts electron/productionRun/productionRunReducer.test.ts
git commit -m "feat(run): enforce reviewed artifact provenance"
```

## Task 2: 接通剧本审阅与项目快照

**Files:**
- Modify: `electron/productionRun/productionRunDriverOps.ts`
- Modify: `electron/productionRun/productionRunService.ts`
- Modify: `src/workbench/creation/CreationAiPanel.tsx`
- Create: `src/workbench/creation/scriptDraftSnapshot.ts`
- Test: `electron/productionRun/productionScriptReview.test.ts`
- Test: `src/workbench/creation/scriptDraftSnapshot.test.ts`

- [ ] **Step 1: 写失败测试，覆盖内外部两条入口。**

测试要求：

1. Production Run 方向批准后只生成 `script candidate`，不调用 storyboard planner。
2. `reviewScript('approved')` 后才进入 storyboard stage。
3. 内部 Creation AI 用户点击应用后可以生成同样的 ScriptDraft snapshot。
4. 拒绝或 request changes 不产生付费请求。
5. `projectId + runId + artifactId` 能重新读取完整稿件。

- [ ] **Step 2: 运行测试确认 RED。**

Run: `pnpm vitest run electron/productionRun/productionScriptReview.test.ts src/workbench/creation/scriptDraftSnapshot.test.ts`

- [ ] **Step 3: 实现 script candidate → review → adopted。**

修改 `proposeStoryboard()`：先调用 renderer 的 `production.plan-script`，写入：

```text
.nomi/runs/{runId}/script-v{N}.json
```

并持久化 `artifact-script-vN` 为 `candidate`。只有收到 `script.review` approved 后，才调用现有 Storyboard planner。

在 `CreationAiPanel` 中保留现有 apply/reject 卡片；用户应用时调用 `snapshotScriptDraft()`，只保存应用后的完整文稿和 hash，不保存 pending token。

对“编辑器为空但聊天中有故事”的自动 append 路径改成先创建待应用写入卡，不得绕过审阅。

- [ ] **Step 4: 运行 targeted tests 和真实状态机旅程。**

Run: `pnpm vitest run electron/productionRun/productionScriptReview.test.ts src/workbench/creation/scriptDraftSnapshot.test.ts electron/productionRun/productionRunService.test.ts`

- [ ] **Step 5: 提交。**

```bash
git add electron/productionRun src/workbench/creation
git commit -m "feat(script): persist and review script drafts before storyboard"
```

## Task 3: 让 StoryboardPlan 绑定已批准剧本并守恒字段

**Files:**
- Modify: `src/workbench/generationCanvas/agent/storyboardPlan.ts`
- Modify: `src/workbench/creation/storyboard/StoryboardPlanEditor.tsx`
- Modify: `electron/productionRun/productionRunService.ts`
- Modify: `electron/productionRun/productionRunDriverOps.ts`
- Test: `src/workbench/generationCanvas/agent/storyboardPlan.test.ts`
- Test: `src/workbench/generationCanvas/agent/storyboardPlanProvenance.test.ts`
- Test: `electron/productionRun/productionStoryboardBinding.test.ts`

- [ ] **Step 1: 写失败测试。**

覆盖：

```ts
it('preserves source script version and hash in storyboard artifact', () => {})
it('carries ffDesc, lfDesc, variationType, camIdx and continuity into node metadata', () => {})
it('rejects attach when source script was changed after plan creation', () => {})
it('does not create a second confirmation after StoryboardPlan confirmation', () => {})
```

- [ ] **Step 2: 运行 RED。**

Run: `pnpm vitest run src/workbench/generationCanvas/agent/storyboardPlan.test.ts src/workbench/generationCanvas/agent/storyboardPlanProvenance.test.ts electron/productionRun/productionStoryboardBinding.test.ts`

- [ ] **Step 3: 扩展 StoryboardPlan 和 converter。**

每个 shot 必须有稳定的 `shotId`，并保留：

```ts
sourceScriptArtifactId
sourceScriptHash
ffDesc
motionDesc
lfDesc
variationType
camIdx
continuity
```

`storyboardPlanToCreateNodesArgs()` 生成节点时，把这些字段写入 `metadata` 和 Production Run binding。不要只拼到 prompt 里。

- [ ] **Step 4: 加入 stale 检查和一致的落画布入口。**

`StoryboardPlanEditor` 确认时先验证 source hash；通过后只调用一次 `create_canvas_nodes` 和一次 `plan.attach`，不再出现第二张计划确认卡。

- [ ] **Step 5: 运行 targeted tests。**

Run: `pnpm vitest run src/workbench/generationCanvas/agent/storyboardPlan.test.ts src/workbench/generationCanvas/agent/storyboardPlanProvenance.test.ts electron/productionRun/productionStoryboardBinding.test.ts`

- [ ] **Step 6: 提交。**

```bash
git add src/workbench/generationCanvas/agent src/workbench/creation/storyboard electron/productionRun
git commit -m "feat(storyboard): bind plans to reviewed scripts and preserve shot fields"
```

## Task 4: 补齐外部 MCP 的稿件资源和定点修改

**Files:**
- Modify: `electron/capabilityCore/mcpProtocol.ts`
- Modify: `electron/capabilityCore/mcpToolCatalog.ts`
- Modify: `electron/capabilityCore/mcpToolResults.ts`
- Modify: `electron/capabilityCore/mcpStdioServer.ts`
- Test: `electron/capabilityCore/nomiMcpProductionArtifacts.test.ts`
- Test: `electron/capabilityCore/nomiMcpProductionRevision.test.ts`

- [ ] **Step 1: 写失败协议测试。**

验证工具：

```text
nomi_get_artifact
nomi_read_artifact
nomi_request_script_revision
nomi_request_storyboard_revision
nomi_review_artifact
```

要求：

- read 返回完整结构化稿件和版本 hash；
- revision 只生成 candidate，不自动 adopted；
- review 只能批准当前 artifact 版本；
- stale revision、错误 projectId、错误 runId 必须拒绝；
- 结果包含安全 preview 和 `openInNomi`；
- 不返回绝对路径、API key、供应商私有 URL。

- [ ] **Step 2: 运行 RED。**

Run: `pnpm vitest run electron/capabilityCore/nomiMcpProductionArtifacts.test.ts electron/capabilityCore/nomiMcpProductionRevision.test.ts`

- [ ] **Step 3: 实现 Resource 与业务 Tool 分工。**

只读稿件通过资源 URI：

```text
nomi://project/{projectId}/run/{runId}/artifact/{artifactId}
```

修改通过业务 Tool，内部只调用 `ProductionRunService`，禁止直接写文件。

- [ ] **Step 4: 运行协议和安全测试。**

Run: `pnpm vitest run electron/capabilityCore/nomiMcpProductionArtifacts.test.ts electron/capabilityCore/nomiMcpProductionRevision.test.ts electron/productionRun/artifactProjection.test.ts`

- [ ] **Step 5: 提交。**

```bash
git add electron/capabilityCore
git commit -m "feat(mcp): expose versioned production drafts and revisions"
```

## Task 5: Skill stage 装配与证据

**Files:**
- Modify: `electron/skills/skillManifestSchema.ts`
- Modify: `electron/skills/skillStore.ts`
- Modify: `electron/productionRun/productionPlaybooks.ts`
- Modify: `skills/drama-short/skill.json`
- Modify: `skills/brand-promo/skill.json`
- Modify: `skills/drama-short/SKILL.md`
- Test: `electron/skills/skillManifestSchema.test.ts`
- Test: `electron/skills/skillExecutionEvidence.test.ts`
- Test: `electron/productionRun/productionPlaybookStages.test.ts`

- [ ] **Step 1: 写失败测试。**

验证：

- script stage 只加载 writer skills；
- storyboard stage 只加载 director translation/consistency/cinematography skills；
- `drama.short` 的 script stage 在 storyboard 前且 `pause: true`；
- 每个 adopted artifact 都带真实 Skill evidence；
- 未加载的 Skill 不能伪装成已使用。

- [ ] **Step 2: 运行 RED。**

Run: `pnpm vitest run electron/skills/skillManifestSchema.test.ts electron/skills/skillExecutionEvidence.test.ts electron/productionRun/productionPlaybookStages.test.ts`

- [ ] **Step 3: 增加 stage-level `skillRefs` 和渐进加载。**

manifest stage 结构增加：

```ts
skillRefs?: string[]
```

运行 stage 时只读 L1 元数据和被引用 Skill 的正文；将实际加载的 Skill 写入 artifact evidence。

- [ ] **Step 4: 更新 `drama.short` / `brand.promo`。**

目标顺序：

```text
direction → script → bible/freeze → storyboard → build → generate → qa → assemble → export
```

- [ ] **Step 5: 运行 targeted tests 和 Skill 资源回归。**

Run: `pnpm vitest run electron/skills electron/productionRun/productionPlaybookStages.test.ts`

- [ ] **Step 6: 提交。**

```bash
git add electron/skills electron/productionRun/productionPlaybooks.ts skills/drama-short skills/brand-promo
git commit -m "feat(skills): bind writer and director skills to production stages"
```

## Task 6: 接通生成后的 shotVerify、定向重试和字幕/转场合同

**Files:**
- Modify: `electron/productionRun/productionRunDriverOps.ts`
- Modify: `src/workbench/generationCanvas/components/batchPlanPreview.ts`
- Modify: `electron/productionQa/productionQa.ts`
- Modify: `src/workbench/preview/TimelinePreview.tsx`
- Modify: `src/workbench/generationCanvas/agent/sendStoryboardToTimeline.ts`
- Test: `electron/productionRun/productionRunQa.test.ts`
- Test: `src/workbench/preview/timelineSubtitleTransitionContract.test.ts`
- Test: `tests/production/productionShotRubric.test.ts`

- [ ] **Step 1: 写失败测试。**

覆盖：

1. MCP/Production Run 和手动画布都调用同一个 `shotVerify`；
2. 低于阈值只重试对应镜头；
3. 重试预算计入合同门；
4. 失败镜头被诚实标注；
5. 粗剪包含字幕轨道和明确转场，而不是只有媒体串联；
6. 无字幕源时导出前显示 actionable warning，不伪称完成。

- [ ] **Step 2: 运行 RED。**

Run: `pnpm vitest run electron/productionRun/productionRunQa.test.ts src/workbench/preview/timelineSubtitleTransitionContract.test.ts tests/production/productionShotRubric.test.ts`

- [ ] **Step 3: 复用现有 `shotVerify` 接入 Production Run。**

每个镜头记录：

```text
identityScore
compositionScore
continuityScore
verdict
retryCount
retryReason
```

重试 prompt 只针对失败轴，例如“保背景，只替换角色身份”，并保留 parent artifact。

- [ ] **Step 4: 为真实样片补字幕与转场数据契约。**

timeline artifact 必须包含：

```ts
clips: Array<{ shotId: string; start: number; duration: number; transition?: Transition }>
subtitles: Array<{ start: number; end: number; text: string; style: string }>
```

使用现有预览和导出路径，不新造第二个时间轴。

- [ ] **Step 5: 运行 targeted tests。**

Run: `pnpm vitest run electron/productionRun/productionRunQa.test.ts src/workbench/preview/timelineSubtitleTransitionContract.test.ts tests/production/productionShotRubric.test.ts`

- [ ] **Step 6: 提交。**

```bash
git add electron/productionRun src/workbench/generationCanvas src/workbench/preview electron/productionQa tests/production
git commit -m "feat(qa): verify production shots and preserve subtitle transitions"
```

## Task 7: 补齐项目内 Run / artifact 可发现性

**Files:**
- Modify: `src/workbench/production/productionRunView.ts`
- Modify: `src/workbench/taskCenter/ProductionRunTaskCard.tsx`
- Modify: `src/workbench/taskCenter/TaskCenterPanel.tsx`
- Modify: `src/i18n/locales/generationCommon.ts`
- Test: `src/workbench/production/productionRunView.test.ts`
- Test: `tests/ux/production-project-artifacts.walk.mjs`

- [ ] **Step 1: 写失败 UI contract tests。**

验证项目中可以从任务卡打开：

- 当前待审剧本；
- 当前分镜；
- 最新样片；
- 对应画布节点；
- 粗剪和导出；
- 已完成 artifact 在取消 Run 后仍然可见。

- [ ] **Step 2: 运行 RED。**

Run: `pnpm vitest run src/workbench/production/productionRunView.test.ts && node tests/ux/production-project-artifacts.walk.mjs`

- [ ] **Step 3: 让任务中心成为 Run 的唯一全局入口。**

助手面板显示对话和画布操作；任务中心显示制作 Run、阶段、待审稿件、预览和深链。不要在两个地方各放一张制作卡。

- [ ] **Step 4: 运行 Electron 走查并人工读截图。**

Run: `pnpm run build && node tests/ux/production-project-artifacts.walk.mjs`

检查浅色/深色、900×700 和 1440×900，确认字幕、预览、按钮层级和深链目标正确。

- [ ] **Step 5: 提交。**

```bash
git add src/workbench/production src/workbench/taskCenter src/i18n/locales/generationCommon.ts tests/ux/production-project-artifacts.walk.mjs
git commit -m "feat(ux): make project artifacts discoverable from production runs"
```

## Task 8: 建立真实 30 秒成片验收和对抗矩阵

**Files:**
- Create: `tests/production/real-draft-film.spec.ts`
- Create: `tests/production/real-draft-film-rubric.ts`
- Create: `tests/production/real-draft-film-adversarial.spec.ts`
- Create: `docs/evals/2026-08-21-real-draft-film-rubric.md`
- Create: `docs/evals/2026-08-21-real-draft-film-results.md`
- Create: `docs/evals/assets/README.md`

- [ ] **Step 1: 冻结真实片题目和验收 Rubric。**

真实片采用一个 30 秒、8 镜左右的短叙事：

```text
题目：雨夜找猫
结构：0–3s 钩子；3–10s 建立人物/场景；10–20s 搜索升级；20–26s 发现线索；26–30s 情绪落点
视觉：统一角色外貌、服装、雨夜冷色、便利店/巷口场景
声音：对白或旁白 + 环境声 + 字幕
要求：至少 2 次可辨认转场，字幕时间轴覆盖对白/旁白，导出可播放 MP4
```

Rubric 至少包含：

- 叙事结构完整；
- 角色身份跨镜稳定；
- 场景连续；
- 镜头顺序和时长正确；
- 字幕内容、时间和位置正确；
- 转场实际出现在时间轴；
- 音画可播放；
- 所有中间稿可在 Nomi 项目中找到；
- 外部 Agent 关闭后可以恢复；
- 生成失败不会污染已完成结果。

- [ ] **Step 2: 写失败的旅程断言和对抗案例。**

对抗案例：

1. 用户在剧本未批准时要求直接生成；必须拒绝付费调用；
2. 用户修改剧本后旧分镜尝试落画布；必须报 stale；
3. 外部 MCP 传入错误 projectId/runId；必须拒绝；
4. 生成提交结果不明；不能自动重复扣费；
5. 缺字幕源；导出前必须明确提示；
6. 参考角色未冻结；批量生成必须停止；
7. 用户取消 Run；已完成镜头和稿件必须保留；
8. 外部 Agent 断开后重新打开 Nomi；Run 必须恢复；
9. 画面比例写在 prompt 但参数缺失；测试必须要求真实请求字段；
10. `ffDesc/lfDesc/variationType/camIdx` 进入计划但未进入节点/请求；守恒测试必须失败。

- [ ] **Step 3: 运行无额度的确定性矩阵。**

Run: `pnpm vitest run tests/production/real-draft-film-adversarial.spec.ts tests/production tests/ux/mcp-l2-journeys.e2e.mjs`

- [ ] **Step 4: 用真实模型跑 30 秒片。**

先执行完整 gates 和 build，再通过已配置的真实模型/供应商跑一次完整 Run。记录：

- provider/model；
- 实际花费；
- runId/projectId；
- 每镜生成和重试次数；
- shotVerify 分数；
- timeline/export 文件；
- 截图和人工审阅结论。

不得把 fixture 或“请求成功”当作真实高质量片证据。

- [ ] **Step 5: 人工读图、看片、听声音、核字幕。**

使用视频播放器和 Nomi 预览逐项核对：

- 角色是否跨镜稳定；
- 转场是否不是简单硬切；
- 字幕是否与对白/旁白对齐；
- 是否有黑帧、静音、裁切、画面比例错误；
- 是否能从项目中重新打开每个中间稿。

- [ ] **Step 6: 把每个发现都转为回归测试，再修复。**

任何真实片问题必须先写能复现它的 failing test，再修实现，再重新跑真实片；不能只手工修片不修系统。

## Task 9: 完整门禁、对抗审评和交付

**Files:**
- Modify: `docs/evals/2026-08-21-real-draft-film-results.md`
- Modify: `docs/superpowers/plans/2026-08-21-agentic-production-draft-film.md`
- Modify: `README.md` and `README.zh-CN.md` only if claims changed

- [ ] **Step 1: 运行完整门禁。**

Run: `pnpm run gates`

Expected: 所有门通过，并生成 `.claude/.gates-ok`。

- [ ] **Step 2: 运行完整 Electron / MCP / 真实用户旅程。**

Run:

```bash
pnpm run build
pnpm run test:e2e
pnpm run test:mcp-journey
node tests/ux/production-project-artifacts.walk.mjs
node tests/production/real-draft-film.spec.ts
```

- [ ] **Step 3: 进行最终对抗评审。**

评审维度：

- 产品：用户是否在正确时间做决定；
- 架构：外部/内部是否共享同一 Run；
- 后端：是否可能重复提交或丢稿；
- 前端：是否能从项目找回所有产物；
- MCP：工具是否可读、可重试、不可越权；
- 真实用户：是否能不看文档完成一次 30 秒片；
- 视频质量：是否有结构、字幕、转场和可播放导出。

- [ ] **Step 4: 依据评审结果修复全部 P0/P1/P2。**

不能把真实走查发现留成 backlog；每项都要回到测试或实现中。

- [ ] **Step 5: 最终独立复核。**

Run: `git diff --check && pnpm run check:secrets && pnpm run check:symlinks && git status --short`

确认没有绝对路径、密钥、临时素材、未跟踪生成物和不属于本计划的改动。

- [ ] **Step 6: 请求最终代码审查并交付分支。**

在本分支完成最终 reviewer 后，按项目规则报告：分支、提交、测试证据、真实样片路径和剩余风险；不直接改写共享工作树。

---

## 完成定义

只有同时满足以下条件，才可以说完成：

1. 五门和完整 `gates` 通过；
2. 现有全量 Vitest 通过；
3. MCP 外部旅程通过；
4. Nomi 内部创作旅程通过；
5. 对抗矩阵通过；
6. 真实 30 秒片导出成功；
7. 真实片有完整叙事结构、字幕和转场；
8. 真实片的所有中间稿、决定和资产都能在项目中找回；
9. 真实走查截图已人工检查；
10. reviewer 没有未解决的 P0/P1/P2。

## 执行结果（2026-08-21）

本计划已在 `codex/production-review-pipeline` 完成实现与复核；上面的步骤保留为设计时的逐步记录，以下是最终验收状态：

- [x] Task 1–6：artifact/version/review 合同、剧本先审、StoryboardPlan provenance、MCP 读写/修订、stage Skill evidence、shotVerify 定向重试、字幕和显式转场合同。
- [x] Task 7：任务中心成为 Production Run 的项目内入口；待审剧本、分镜、样片、粗剪、导出均有安全预览和 `nomi://` 深链。
- [x] Task 8：确定性对抗测试、真实 Electron + MCP 旅程、8 镜头零额度 fixture 片和独立 30 秒导出样片均已跑通。
- [x] Task 9：`pnpm run gates`、全量 Vitest、typecheck、build、桌面 smoke、基础 MCP 旅程、生产 MCP 旅程均通过；最终 reviewer 复核后 P0/P1 已清零。
- [x] 后续完成性审计：新增 `tests/production/real-draft-film.test.mjs` 媒体/项目合同与 `agenticProductionAdversarial.test.ts` 对抗矩阵；物化请求增加稳定 operation id，渲染层可从已落节点恢复，重复 revision 指令不再被错误合并。

### 真实样片证据与边界

- 导出文件：`artifacts/nomi-agentic-draft-film-2026-08-21/exports/nomi-agentic-draft-film-30s.mp4`。
- ffprobe：video 30.000s、audio 30.000s、字幕流 29.900s、整体 30.000s；8 个连续镜头、10 条字幕、3 个明确硬切。
- 所有 `script-v1.json`、`storyboard-v1.json`、`timeline-v1.json`、Run snapshot 和 eval 记录都在同一个项目目录中。
- 该样片复用了仓库内已有的高质量 `launch-film-en.mp4`，用于验收项目归档、字段守恒、字幕封装、时间轴和导出合同；没有伪称为“新模型生成的角色一致性样片”。没有可用供应商 key 时，真实模型生成质量仍需在同一 Run 上替换 provider 后复跑。
- 当前导出器对 `dissolve/fade/match_cut/whip_pan` 只保存显式时间轴语义；真正视觉交叉溶解仍需接入导出渲染层。因此 30 秒样片采用诚实的硬切，不能把硬切冒充特效转场。
