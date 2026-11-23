u1-hold-verify：通过

- 验收线：u1-hold-verify
- 实现线：u1-hold-impl
- 验收 HEAD：ca1a40bc514490b1750725ef03e4655fc367140a
- 关联任务：协作看板 #1586 · U-1（P30 改分镜不跟发生成 · 回合生成意图门禁）

## 1. 范围与变更核查

相对 `origin/main`（`a29b31fe0`）共变更 21 个文件：
- **生产代码（9 个）**：
  1. `electron/agentLane/turnGenerationHold.ts`（新增，已登记至 `docs/engineering/self-written.json` `lane-approval-gate`）：纯规则解析当轮显式「暂缓生成 / 只改参数」指令（`holdsTurnGeneration`、`recordTurnGenerationHold`），忽略引号内文本与视觉否定对象（如「不要生成文字水印」）。
  2. `electron/agentLane/laneInputIntent.mts` + `electron/shared/agentLane/laneDesktopContracts.ts`：在已消费输入激活门（及卡片答复后）向临时上下文注入 `generationHeld: true`（不接受来自渲染层 composer 或持久化状态）并向模型补充当轮暂缓指令。
  3. `electron/agentLane/laneDesktopTools.ts` + `electron/agentLane/laneAskUserTool.ts` + `electron/agentLane/laneExtendedDesktopPorts.ts`：在 `before_tool` 准备门预检前拦截 `wire.toolName === 'generate' && input.context?.()?.generationHeld`，抛 `LaneDomainFailure(code: 'generation_held_by_user')`；并在 `ask_user` 答复与 `generate` 报价卡 `redirected` 答复时同步记录当轮 hold。
  4. `electron/capabilityCore/generationTransportAdapters.ts`：删除 `capability === "plan"`（草稿修改 `patch`）隐式触发 `policyVerdict` / `full_auto` 代答的旁路，仅 `present` 与未藏卡的 `create` 进入代答；修改已出价草稿仅保存候选，下一次代答须经显式 `present`。
  5. `electron/agentLane/laneExtendedTools.ts` + `electron/shared/agentCapabilities/verbs/writeVerbs.ts`：收口 `draft_shots` 回执（`draftNextStep` 与 `notWhen`），保存草稿/修改参数后直接收尾，仅在本轮用户明确要求生成时调用 `generate`。
- **治理与基线（6 个）**：`docs/fixes/2026-11-23-agent-turn-generation-hold.root-cause.json`、`docs/plan/2026-11-23-agent-turn-generation-hold.direction-check.md`、`docs/engineering/concept-owners/agent-lane.turn-generation-hold.json`、`docs/engineering/concept-owners/production.spend-card-hand-over.json`、`docs/engineering/self-written.json`、`scripts/model-face-baseline.json`（仅 `draft_shots` 描述同步更新）。
- **测试与走查（6 个）**：`electron/agentLane/laneExtendedDesktopPorts.test.ts`、`electron/agentLane/laneExtendedTools.test.ts`、`electron/capabilityCore/generationTransportAdapters.test.ts`、`tests/agent-runtime/lane-storyboard-review.test.mts`、`tests/agent-runtime/laneL1Scenarios.mts`、`tests/ux/agent-spend-waiting-owner.walk.mjs`。
- **路径隐私核查**：全量 diff 及本报告均含 **0 处**本机绝对路径或工作树路径泄露。

## 2. 独立实跑命令与结果

### 2.1 三套核心变更单测（`npx vitest run --maxWorkers=2`）
- `electron/agentLane/laneExtendedDesktopPorts.test.ts`：51/51 passed
  - P30 六镜只改不生（`Make every shot 8 seconds.` / `先别生成，把每个镜头改成 8 秒` / `Don't generate yet, make every shot 8 seconds`）：6 镜均保存为 8s，模型 `generate` 调用 0 次、`present` 0 次；
  - 违令强制批量（`request` / `direct` 双档）：`draft_shots` 6 镜正常保存，同轮 `generate` 在预检前拦截并返回 `Generation is on hold for this turn`，`present` 0 次；
  - `full_auto`（`policy: 'direct'`）正例与反例：后续显式请求 `Generate shot 1 now`、同轮 `把每个镜头改成 8 秒并直接生成`、以及 3 条去水印/视觉否定句（`生成一张不要带文字水印的海报`、`生成一张海报，不要生成文字水印。`、`Generate a poster. Do not generate text watermarks.`）均正常放行至 `present` 并返回 `policy:full_auto`；
  - 引号与视觉内容反例（`生成一张印着「先别生成」的海报`、`Generate a poster that says "do not generate."`、`Generate a poster without generating text watermarks.`、`Generate images without generating videos.`）：`holdsTurnGeneration` 全部返回 `false`。
- `electron/agentLane/laneExtendedTools.test.ts`：35/35 passed（验证 `draft_shots` 回执明确按保存草稿收尾，不误报已开跑）。
- `electron/capabilityCore/generationTransportAdapters.test.ts`：32/32 passed
  - `editing a previously presented draft never queues another policy handover`：在 `direct`（全自动）档下，对已出价草稿执行 `patch` 时 `handOver` 0 次、`readRun` 0 次；随后显式调用 `present` 时正常返回 `spendDecision: { decidedBy: "policy:full_auto" }` 且 `handOver` 精确 1 次。
- **合计**：3 passed (3)，**118 passed (118)**，0 failed。

### 2.2 独立双向变异反例测试（全拦 / 不拦 / 还原旧旁路）
1. **M1（全拦 `generate`）**：将 `laneExtendedDesktopPorts.ts` 改为无条件拦截 `generate` → 运行 `laneExtendedDesktopPorts.test.ts`：**20 failed / 31 passed**（所有明确生成正例与去水印正例全红，`exit=1`）。
2. **M2（完全不拦 hold）**：将 `laneExtendedDesktopPorts.ts` 改为 `if (false)` → 运行 `laneExtendedDesktopPorts.test.ts`：**3 failed / 48 passed**（违令强制批量双档与先停后生前段全部变红，`exit=1`）。
3. **M3（还原旧 `plan -> full_auto` 代答旁路）**：将 `generationTransportAdapters.ts` 改回 `capability === "create" || capability === "plan"` → 运行 `generationTransportAdapters.test.ts`：**1 failed / 31 passed**（已出价草稿 `patch` 误触发 `policy:full_auto` 变红，`exit=1`）。
4. **恢复复绿**：`git checkout -- .` 后重跑上述 2 套单测 → **2 passed / 83 passed (83)**（`exit=0`）。

### 2.3 仓库门岗实跑（在 `ca1a40bc514490b1750725ef03e4655fc367140a` 全量验证）
- `node ./scripts/check-concept-owners.mjs`：✅ 通过（399 个概念 · 写接口 1047 个 · 第二写口 0 新增 · 未登记共享边界 0 新增）
- `pnpm run check:self-written`：✅ 通过（20/20 单测，新增代码文件 1 个，0 个未认领）
- `pnpm run check:model-face-frozen`：✅ 通过（10/10 单测 + 变异回绿，基线与代码一致）
- `pnpm run check:root-cause-contracts`：✅ 通过（55/55 单测）
- `pnpm run check:filesize`：✅ 通过
- `node scripts/fix-churn.mjs --range origin/main..HEAD`：✅ 通过（1 热点 fix 带有效 `Direction-Check`）
- `pnpm run check:model-schema`（24/24，9470 ≤ 10000 token）、`check:tool-face`、`check:verb-host-conformance`（17/17）、`check:boundaries`、`check:boundary-owners`、`eslint`（12 文件）：✅ 全部通过（0 错）

### 2.4 `door-map` 调用方核查
- `node scripts/door-map.mjs decideByPolicyAfterDraft`：唯一写入口 `electron/capabilityCore/generationTransportAdapters.ts:613`。
- `nomi_generation_plan` `patch` 全部调用方（2 处）：
  1. `electron/agentLane/laneVerbTransport.ts:125`（桌面 `draft_shots` 改草稿）：仅保存候选，不再隐式触发 `full_auto` 代答；用户显式要求生成时经 `generate` → `present` 照常走原审批/全自动路径。
  2. `electron/capabilityCore/mcpGenerationToolCatalog.ts:78` + `electron/capabilityCore/mcpGenerationTools.ts:461`（外部 MCP `plan` 改草稿）：仅保存候选，不隐式触发代答；建草稿仍走 `create`，出价仍走 `present`。

## 3. ★9 验收条款与未验证范围核对
- P30 六镜只改不生、显式「别生成」0 次、`full_auto` 显式生成正例、去水印与引号反例：✅ 全部独立实跑通过
- 真实模型 API / 真付费 / Windows / 真桌面窗口截图：本轮零付费确定性夹具验证，按 `unverified` 诚实记账；`full_auto` 用户可见开关体验与 `NF-1105-0001` / `NF-1119-0001` 归属说明见 PR 正文。
