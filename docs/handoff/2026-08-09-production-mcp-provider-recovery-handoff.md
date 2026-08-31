# Nomi MCP 宣传片制作与供应商恢复交接（2026-08-09）

> 给下一个 AI：先完整阅读仓库根目录的 `CLAUDE.md`、`AGENTS.md` 和
> `docs/design/nomi-design-system.md`。这是一个尚未提交的大型工作树，禁止丢弃或覆盖现有修改。
> 当前最重要的不是继续生成宣传片，而是修通「已知供应商不可用时安全换家」这条真实用户旅程。

## 0. 绝对不要做的事

- 不要直接推送 `main`。用户明确要求：以后只提 PR，不直接推主分支。
- 不要批准或恢复真实宣传片 Run；它仍停在新合同等待批准的安全边界。
- 不要重新调用已知不可用的供应商，也不要为了验证而触发任何真实付费生成。
- 不要把 `submission_unknown` 自动重试到另一家；请求可能已经到达供应商，会产生重复扣费。
- 不要 stage/commit 工作树里的 `node_modules` 和 `model-catalog.json`。
- 不要做批量生成和剪辑功能。用户已经明确：现阶段重点是 MCP 完整制作流程，批量生成没有必要，剪辑先不管。
- 不要把旧工作树的 58 个业务文件当成无关脏改动。这些是本轮预期实现，必须在其上继续。

## 1. 用户刚刚遇到的真实事故

界面显示：

> 提交结果不明，Nomi 已停止自动重试
> 请求可能已经到达供应商；再次提交可能重复扣费，后续任务已停在安全边界。

用户的核心投诉不是安全暂停本身，而是：这个供应商本来就不能用，Nomi 仍强迫他批准/使用该供应商，暂停后也不给可执行的换家出口。

期望行为：

1. 批准前已经知道供应商不可用：不写批准、不提交、不占预算，立即标记为确定未提交，并展示所有可执行替代项。
2. 供应商明确返回 401/402/422 或业务拒绝：这是「供应商未受理」，不是「回执未知」；不得显示可能重复扣费的文案。
3. 只有网络断开、超时、无响应等无法证明是否受理的情况进入 `submission_unknown`。
4. 用户完成对账并确认供应商没有任务后，必须释放预算预留并允许换供应商。
5. 换供应商必须撤销旧批准、生成新计划和新合同、保持暂停，并再次由用户明确批准。
6. 推荐项只是建议；用户必须能选择任何真正可执行的替代项。
7. 已完成镜头保留，只替换尚未提交的剩余镜头。

## 2. 工作目录、分支和 PR

- 工作树：`/Users/aoqimin/Desktop/Nomi-production-budget-ux`
- 当前本地分支：`codex/production-budget-ux-20260809`
- PR 远端分支：`codex/production-mcp-finalization-20260809`
- PR：<https://github.com/aqm857886159/Nomi/pull/59>
- 完成后只能这样推送 PR 分支：

```bash
git push origin HEAD:codex/production-mcp-finalization-20260809
```

当前工作树有 58 个已修改业务文件和若干新增文件，约 `1574 insertions / 326 deletions`。本交接文档本身也是新增未跟踪文件。接手后第一条命令应运行：

```bash
git -C /Users/aoqimin/Desktop/Nomi-production-budget-ux status --short --branch
```

## 3. 产品目标和已经确认的范围

总目标分两阶段：

1. 先把 Nomi 内的 MCP/Agentic 制作体验和安全恢复方案全部做完。
2. 再在 Nomi 界面内完成一支约一分钟的 Nomi 宣传片。

宣传片要求：

- 有趣的故事，不要做成讲解型广告。
- 追求传播潜力，但不能虚假宣传。
- 真实卖点：数据和工程资产保存在本地；可接任意 API；可连接 Claude、Codex；可从剧本、分镜、生成走到最终成片；项目纯开源。
- 用户希望参考实拍剪辑与 AIGC 混合的营销方式，但当前明确不做剪辑功能。
- 制作过程必须在 Nomi 中可见：方向选择、导演 skill 证据、合同、任务进度、素材位置、失败原因、替代方案和恢复动作不能是黑盒。

已参考的设计稿/方案：

- `docs/design/mockups/2026-08-08-agentic-production/nomi-agentic-production.html`
- `docs/plan/2026-08-09-production-provider-identity-recovery.md`
- 外部旧方案：`/Users/aoqimin/Desktop/Nomi产品介绍视频/videos/nomi-local-ai-studio/NOMI-AGENTIC-UX-REDESIGN.md`

## 4. 当前未提交实现已经完成的内容

以下内容已在脏工作树中实现，接手时不要从头重做：

- `(provider, model)` 身份在计划、合同、画布、renderer 和 provider 调用链中保持成对传递。
- 显式 provider 查找不会因为相同 model key 回退到另一家供应商。
- 付费提交前校验批准的 provider/model 与画布实时绑定一致。
- 本地/提交前错误可以落 `not_dispatched`；真正无法判断受理情况的错误落 `submission_unknown`。
- 提交 outbox 会在 dispatch 前持久化预算预留和 submit intent。
- idempotency key 已传到 renderer/provider 路径。
- 替代供应商选择器展示推荐项和其他候选，用户可以选择非推荐项。
- 成功 rebind 会撤销旧 gate/approval、detach 旧任务、创建 plan v2 和等待批准的新合同。
- 关闭合同弹窗只代表稍后处理，不等于拒绝或批准。
- 合同弹窗已有焦点陷阱、Escape 关闭和焦点恢复。
- 设置页可补硬预算、provider/model allowlist。
- 未经证据支持的宣传 claim 不再显示为已独立验证。
- 重启恢复对已有 provider task id 的任务走对账，不自动重新提交。
- E2E provider fixture 只能在 `NOMI_E2E=1`、`NOMI_E2E_PRODUCTION_FIXTURE=1` 且非 packaged 时启用。
- 修复 revision conflict 后的 renderer 命令重试。
- 修复确认弹窗退出时和新合同弹窗短暂叠加：`src/design/confirmDialog.tsx` 的 exit duration 已设为 0。

## 5. 已完成的验证，但不能作为最终放行依据

在最新对抗评审之前，以下都通过过：

- 聚焦测试：4 个文件，26 项通过。
- Provider recovery Electron 走查：中文、英文通过。
- Policy/budget recovery Electron 走查：中文、英文通过。
- 全量测试：470 个文件通过、1 skipped；4133 项通过、1 skipped。
- `pnpm run gates` 当时完整通过，包括 lint、typecheck、测试、renderer build、Electron build。

截图：

```text
tests/ux/shots/production-provider-recovery/
  01-provider-unavailable.png
  02-alternative-selected.png
  03-switch-confirmation.png
  04-replacement-contract-waiting.png
  en-01-provider-unavailable.png
  en-02-alternative-selected.png
  en-03-switch-confirmation.png
  en-04-replacement-contract-waiting.png

tests/ux/shots/production-budget-recovery/
```

重要：这些测试使用「第一次 preflight 通过、批准后第二次 preflight 才失败」的 fixture，避开了用户真实遇到的「批准前就不可用」路径。最新对抗评审因此判定仍有 blocker，当前禁止合并。

## 6. 最新对抗评审：必须修复的阻塞项

### 6.1 批准前不可用仍无换家出口（Blocker）

`electron/productionRun/productionRunService.ts` 在 `gate.decide approved` 写批准前做 preflight，失败后直接抛错。gate 仍 waiting、job 仍 `authorization_required`。前端 replacement planner 只找 `not_dispatched` blocker，随后错误地引导用户打开自动化设置。

建议：preflight 失败时，使用 durable `job.status -> not_dispatched` 记录失败 provider/model 和明确的错误码，保持合同 waiting；前端 reload 后直接展示替代供应商选择器。对 provider unavailable 错误不要弹「打开设置」作为默认出口。

必须新增 E2E：供应商第一次 preflight 就失败，验证没有 approval、没有 receipt、没有预算预留，并能立即选择替代项。

### 6.2 明确供应商拒绝被误判为 `submission_unknown`（Blocker）

真实 `nomi:tasks:run` IPC 会丢 Error 自定义字段。`VendorRequestError` 已通过 `NOMI_VENDOR_ERR_B64::` 把结构编码进 message，但 `runCatalogGenerationTask` 的首次提交 catch 没有利用 `parseVendorErrorFromMessage` 做 dispatch 分类。

影响：非法密钥头、HTTP 401/402/422、明确业务拒绝都会一路变成 outbox 的 `submission_unknown`，直接复现用户看到的错误文案。

建议引入诚实的状态/错误类型：

- 本地构造、密钥头、模型绑定等发送前失败：`not_dispatched`。
- 已收到 HTTP/业务失败响应且无 task id：`provider_rejected` 或等价的 `not_accepted`，释放 reservation，可换家，不自动重试。
- 网络错误、提交超时、无响应：`submission_unknown`，保留 unsettled，禁止换家，先对账。

需要端到端修改：

- `src/workbench/generationCanvas/runner/catalogTaskActions.ts`
- `src/workbench/capability/capabilityApplyHandler.ts`
- `electron/preload.ts`
- `electron/capabilityCore/rendererBridge.ts`
- `electron/productionRun/productionRunService.ts`
- `electron/productionRun/submissionOutbox.ts`
- Production job state/reducer/tests 和前端 recovery planner

### 6.3 对账确认未找到后仍不能换家（Blocker）

`job.reconcile(outcome='not_found')` 当前把 `submission_unknown` 改成 `needs_attention + provider_task_not_found`，但 replacement planner 仍只认 `not_dispatched`。

建议：用户明确二次确认后，持久化为确定可替换状态（优先 `not_dispatched` 或专门的 `provider_not_found`），provider-safe release unsettled reservation，然后开放换供应商。不能把任意 `needs_attention` 都当成安全可换。

### 6.4 已完成镜头会阻止剩余镜头换家（Blocker）

`electron/productionRun/productionProviderRecovery.ts` 当前遍历旧 gate 的全部 job。只要任一前序镜头已有 `providerTaskId` 或已 adopted，整次 rebind 就失败。

修复原则：保留完成/已受理任务和产物，只对 active + unsubmitted + 有明确安全证据的 job 创建 replacement job。新 gate 的 jobIds 只覆盖剩余任务，旧 gate/approval 仍撤销；已经产生的实际费用不能归零或丢失。

### 6.5 重启存在永久卡死窗口（Blocker）

Outbox 会依次持久化 reserve、`submit_intent_persisted`、`submitting`。`resumeUnfinishedRuns` 只恢复 `submitting` 及之后，并且 generation 只在 Run status 为 `ready` 时重启。

修复要求：

- `authorized`：可由已批准合同重新进入 outbox。
- `submit_intent_persisted`：确认还未进入 dispatch 后可继续进入 `submitting`。
- `submitting`：必须转 `submission_unknown`，绝不重发。
- running generate Run 在存在安全可继续的 authorized/submit-intent job 时，重启后重新调用 `driveGeneration`。
- 为每个崩溃窗口加测试，验证预算 reservation 不会永久占用。

### 6.6 已拿到 task id 的超时被丢成黑盒暂停（Blocker）

`RecoverableTimeoutError.detail.taskId` 在 renderer 已存在，但 `ProductionGenerationApplyError`、preload reply、`RendererApplyError` 没有透传 providerTaskId。main outbox 因为收不到 task id 只能写 `submission_unknown`。

修复要求：providerTaskId 端到端透传并先持久化为 `provider_accepted`；随后只轮询/对账，不重发。需要测试 renderer error -> preload -> rendererBridge -> outbox 的完整链。

### 6.7 rebind 跨画布和 Run 不具备崩溃一致性（Blocker）

当前顺序是先 `production.rebind-nodes` 改画布，再对 Run 做 CAS；失败后 best-effort 无条件回滚。并发命令或进程崩溃会造成画布与合同错绑，无条件回滚也可能覆盖另一次成功修改。

建议实现：

1. 每个 Run 串行化 rebind。
2. 先在 Run 中持久化 rebind intent（包含 old/new bindings 和唯一 intent id）。
3. renderer rebind 做 compare-and-set，并对已经处于目标绑定的相同 intent 幂等成功。
4. Run finalize CAS 清除 intent 并创建新计划/合同。
5. 重启时发现 pending intent，检查/补做画布绑定后 finalize；不要无条件覆盖当前绑定。

### 6.8 审批、预算 side log 与 Run event 可能半提交（Blocker）

`productionRunRepository.execute` 会先 append approvals/budget ledger，再 append Run event。进程在中间退出会留下审批/预算与 Run 状态分裂。

需要 WAL/commit marker 或单一权威事件流。最低要求：故障注入覆盖「每次 side-log append 之后、event append 之前」；重启能幂等完成事务，不能重复授权、重复释放或留下幽灵 approval。

### 6.9 成功后预算 reservation 未 settle（Major）

生成和 reconciliation 成功 adopted 后，reservation 仍可能保持 reserved，导致 `actual=0`。应使用供应商实际费用；拿不到时采用合同内明确的保守口径，并在账本中写 `settle`。不要静默把估算冒充精确账单，UI 要能说明是上限/估算。

### 6.10 供应商级故障只替换同一个 model（Major）

当前前端只替换与 blocker 相同的 `provider + model`。如果同一坏供应商在合同内承担多个模型，其他模型会被带进新合同，批准后再次调用已知坏供应商。

需要区分：

- model binding 失败：只替换该 provider/model。
- provider unavailable/auth/balance：为该 provider 下所有尚未提交的绑定分别寻找替代模型。

候选方案可能因此需要按多个 task kind/model 分组，而不是假设一个候选可以替换全部 job。

### 6.11 推荐候选不保证可执行（Major）

当前候选只检查 vendor enabled + 有 key + canonical model，未完整校验媒体类型、taskKind、调用 mapping 和策略 allowlist；backend preflight 也忽略 taskKind。

建议：

- preflight 使用 taskKind 映射到 billing kind，至少保证 image/video/audio 类型匹配。
- 候选必须经过 backend 的只读 executable preflight 才能标「可直接使用」和「推荐」。
- 需要设置的候选可以展示，但必须标明缺什么；不能撤销旧合同时才发现不可用。
- `allowedModels` 和 `allowedProviders` 都应进入排序/可批准判断。
- 候选目录读取失败必须在 UI 说明原因，不要静默退化成「查看当前阶段」。

## 7. 两个前端 P1 也需要在合并前修复

1. `src/workbench/generationCanvas/spend/SpendConfirmDialog.tsx` 的遮罩用了 `bg-nomi-ink/20`。dark theme 中 `nomi-ink` 会变亮，截图会把整个工作区洗成浅灰。改用已有 token `bg-nomi-scrim`。
2. `src/workbench/taskCenter/productionRunTaskCenter.ts` 把 `awaiting_contract`、`paused`、`needs_attention` 等映射为 `queued`，导致任务按钮保持蓝色 busy、任务中心显示「排队中」，还可能出现「取消不产生费用」。应增加独立的 `waiting_user` / `attention` group、计数和 tone；`needs_attention` 用 warning，等待批准不算正在生成。

前端非阻塞残留：合同 dialog 可补 `aria-describedby`；失败供应商不应显示 raw key；合同画幅/语言不应无故显示 Not provided；合同中的 `Allowed` 可改为「策略已配置」，避免与批准概念混淆。

## 8. 推荐接手顺序

1. 先补 6.1、6.2、6.3 的失败分类和「批准前不可用 -> 立即换家」真实 E2E；这是用户当前事故的最短闭环。
2. 修 6.4 的部分完成任务 rebind，并扩展 provider-level 多模型替换。
3. 修 task id 透传、成功 settle 和 restart recovery。
4. 实现 rebind intent/串行化和 repository WAL，补故障注入。
5. 修任务中心语义、dark scrim 和小型可访问性问题。
6. 复跑中英文 Electron 走查，逐张检查截图。
7. 跑 `pnpm run gates`，再做一次独立后端/前端/产品对抗评审。
8. 仅在所有 blocker 清零后 commit 并 push PR #59。
9. 真实宣传片 Run 继续保持暂停，等用户重新查看并明确批准新合同后再生成。

## 9. 真实宣传片 Run 的安全状态

- Project：`workspace-38d32482-06fd-4846-af8a-59688da6b4b6`
- Run：`run-46398e71-6b34-4662-a5a0-fda4b3d3922a`
- 文件：`/Users/aoqimin/Documents/Nomi Projects/Nomi 宣传片｜09_00 前交片-mslj7fgo-e5236541/.nomi/runs/run-46398e71-6b34-4662-a5a0-fda4b3d3922a/run.json`
- 上次只读核验状态：revision 21、`awaiting_contract`、plan v2。
- 旧 v1 gate 已 revoked。
- 16 个旧 `code-newcli-com / gpt-image-2` job 已 detached。
- 16 个新 `apimart / gpt-image-2` job 为 `authorization_required`。
- 所有 `providerTaskId` 都是 null。
- authorized/reserved/actual/unsettled 均为 0。

不要批准这个 Run。代码修复和 E2E 通过后，先只读重新核验状态，再让用户在 Nomi UI 中看新合同并明确批准。

## 10. 测试和检查命令

先跑聚焦测试，具体文件按修改补齐；已有核心测试包括：

```bash
pnpm vitest run \
  electron/productionRun/submissionOutbox.test.ts \
  electron/productionRun/productionRunDriver.test.ts \
  src/workbench/production/productionProviderRecovery.test.ts \
  src/workbench/taskCenter/productionRunTaskCenter.test.ts
```

真实 Electron 走查：

```bash
NOMI_E2E_LOCALE=zh-CN node tests/ux/production-provider-recovery.walk.mjs
NOMI_E2E_LOCALE=en node tests/ux/production-provider-recovery.walk.mjs
NOMI_E2E_LOCALE=zh-CN node tests/ux/production-policy-recovery.walk.mjs
NOMI_E2E_LOCALE=en node tests/ux/production-policy-recovery.walk.mjs
```

最终门禁：

```bash
pnpm run gates
git diff --check
git status --short --branch
```

如果代码有改动，不能只引用之前的绿灯；必须重新跑相关 Electron 走查和全量 `pnpm run gates`。

## 11. 关键文件索引

后端运行与恢复：

- `electron/productionRun/productionRunService.ts`
- `electron/productionRun/submissionOutbox.ts`
- `electron/productionRun/productionProviderRecovery.ts`
- `electron/productionRun/productionRunRepository.ts`
- `electron/productionRun/productionRunReducer.ts`
- `electron/productionRun/productionRunState.ts`
- `electron/productionRun/productionRunTypes.ts`
- `electron/productionRun/productionRunE2eFixture.ts`

错误分类和 task id 传递：

- `electron/vendor/vendorHttp.ts`
- `electron/tasks/taskIpcGuard.ts`
- `src/workbench/generationCanvas/runner/vendorErrorIpc.ts`
- `src/workbench/generationCanvas/runner/catalogTaskActions.ts`
- `src/workbench/generationCanvas/runner/recoverableTimeout.ts`
- `src/workbench/capability/capabilityApplyHandler.ts`
- `electron/preload.ts`
- `electron/capabilityCore/rendererBridge.ts`

前端恢复和合同：

- `src/workbench/production/useProductionStatus.ts`
- `src/workbench/production/productionProviderRecovery.ts`
- `src/workbench/production/ProductionStatusPanel.tsx`
- `src/workbench/generationCanvas/spend/SpendConfirmDialog.tsx`
- `src/workbench/generationCanvas/spend/productionContractView.ts`

任务中心：

- `src/workbench/taskCenter/taskCenterProjection.ts`
- `src/workbench/taskCenter/productionRunTaskCenter.ts`
- `src/workbench/taskCenter/taskCenterEntries.ts`
- `src/workbench/taskCenter/TaskCenterButton.tsx`
- `src/workbench/taskCenter/TaskCenterPanel.tsx`

## 12. 完成定义

只有同时满足以下条件，才能说「MCP 宣传片制作恢复方案做完了」：

- 批准前不可用、明确供应商拒绝、网络回执未知三类情况在 durable state 和 UI 上完全分开。
- 已知不可用供应商不会被再次自动调用。
- unknown receipt 不自动重试或自动换家。
- 对账确认 not found 后能释放负债并换家。
- 已完成镜头不阻止剩余镜头换家。
- provider/model/taskKind 候选经过真实可执行校验，推荐项不撒谎。
- 换供应商产生新合同并等待用户批准，旧批准不可复用。
- reserve/submit intent/submitting/provider accepted 的每个崩溃窗口都能安全恢复。
- provider task id 在超时错误链上不丢失。
- approval、budget、Run event 不会因崩溃半提交。
- 成功任务预算会 settle，未决任务保留 unsettled，确定未受理会 release。
- Nomi 任务中心不会把等待用户批准伪装成排队/生成中。
- 中英文 Electron 真实走查和全量 gates 全绿。
- 对抗评审无 P0/P1 blocker。
- PR #59 已更新；真实宣传片 Run 仍未被自动批准或付费提交。

## 13. 本交接生成时的状态

本轮在收到最新对抗评审后只做了代码阅读和问题归纳，没有开始修复上述新 blocker，也没有修改业务代码、运行付费调用、提交或推送。当前计划工具中的目标处于 paused；不要把它误标 complete。下一个 AI 应从第 6 节开始，而不是继续宣传片生成。
