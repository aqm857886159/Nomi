v-1609-accept：通过

- 验收线：v-1609-accept
- 实现线：u1-hold-impl
- 验收 HEAD：6b59e26a55adab49eef6799c52b5e810bc2c94aa
- 关联任务：协作看板 #1586 · U-1（PR #1633 · P30 改分镜不跟发生成 · 回合生成意图门禁 + C59 KV-cache 前缀恒等修复）

## 0. `6b59e26a55ad` C59 KV-cache 增量独立复验（`v-1609-accept`）

- **增量 diff 核查（4 文件 +28/-10）**：
  1. `electron/agentLane/laneInputIntent.mts`：移除把 `TURN_GENERATION_HOLD_*` 拼入 `quote` 的逻辑，`quote` 严格只留给压缩后摘录，保障 `systemPrompt` 前缀逐字节恒等；保留 `held` 派生与 `input.context.generationHeld = true`。
  2. `electron/agentLane/laneExtendedTools.ts` + `electron/agentLane/laneExtendedDesktopPorts.ts`：新增 `isGenerationHeld?: () => boolean`（接 `() => Boolean(input.context?.()?.generationHeld)`），当 `generationHeld` 为真时在 `draft_shots` 成功回执 `userSees` 尾部追加当轮暂缓提示（落入尾部 `toolResult`，零 `systemPrompt` 变异）；`laneExtendedDesktopPorts.ts` 的 `generate` 硬拦截保持不变。
  3. `electron/agentLane/laneExtendedDesktopPorts.test.ts`：新增 `keeps the system prompt byte-identical on held turns and carries the hold reminder in draft_shots tool receipts` 回归用例，同时锁定 held/unheld 回合 `system` 逐字节恒等且仅 held 回合的 `draft_shots` `tool-result` 带暂缓提示。
- **独立实跑验证（全部 0 错，0 本机路径泄露）**：
  - **Vitest（`--maxWorkers=2`，2/2 套 87/87 passed）**：`electron/agentLane/laneExtendedDesktopPorts.test.ts`（**52/52 passed**）+ `electron/agentLane/laneExtendedTools.test.ts`（**35/35 passed**）。
  - **Agent Runtime（`tsc -p tests/agent-runtime/tsconfig.json` + `node --test --test-concurrency=1`，15/15 passed）**：
    - `tests/agent-runtime/lane-context-budget.test.mts`：**10/10 passed**，其中 **`C59 the 24 recorded user turns reduce total input by 60 percent and add under 2k tokens per turn`** 复验通过（含第 8 轮「先别生成」在内全会话 24 回合 `system` 消息字节级恒等，总输入缩减 `95.59%`）；
    - `tests/agent-runtime/lane-storyboard-review.test.mts`：**5/5 passed**。
  - **4 项仓库门岗（0 错）**：`node scripts/lint-changed.mjs`（12 个改动文件 0 错）✅、`node scripts/check-boundaries.mjs`（68/68）✅、`node scripts/check-root-cause-contracts.mjs` ✅、`node scripts/fix-churn.mjs --range origin/main..HEAD`（2 个热点 fix 均带有效 `Direction-Check`）✅。

## 1. 基线实现（`ca1a40bc5144`，原由独立线 `u1-hold-verify` 全量核验）摘要

> `ca1a40bc514490b1750725ef03e4655fc367140a` 为 `6b59e26a55adab49eef6799c52b5e810bc2c94aa` 的上游基线（经干净 merge `origin/main` 与上述 4 文件 C59 补修推进至 `6b59e26a55ad`）。

- **核心不变量全覆盖**：
  - `electron/agentLane/turnGenerationHold.ts`（已登记 `docs/engineering/self-written.json` `lane-approval-gate`）：解析当轮显式「暂缓生成 / 只改参数」，忽略引号内文与视觉否定对象（如「不要生成文字水印」）。
  - `electron/capabilityCore/generationTransportAdapters.ts`：删除 `capability === "plan"`（草稿修改 `patch`）隐式触发 `policyVerdict` / `full_auto` 代答的旁路；`decideByPolicyAfterDraft` 唯一写入口为 `generationTransportAdapters.ts:613`。
  - `electron/capabilityCore/generationTransportAdapters.test.ts`：**32/32 passed**；3 项双向变异反例（M1 全拦 20 fail / M2 不拦 3 fail / M3 还原 `plan -> full_auto` 旧旁路 1 fail）全红并恢复复绿。
  - 治理与基线门岗全绿：`check:concept-owners`、`check:self-written`、`check:model-face-frozen`、`check:root-cause-contracts`、`check:filesize`、`check:model-schema`、`check:tool-face`、`check:verb-host-conformance`、`check:boundary-owners`。

## 2. 未验证范围（诚实记账）

- 真实模型 API / 真付费 / Windows / 真桌面窗口截图：本轮零付费确定性夹具与真实 loopback 协议栈验证，按 `unverified` 诚实记账；`full_auto` 用户可见开关体验与 `NF-1105-0001` / `NF-1119-0001` 归属说明见 PR 正文。

## 结论

`6b59e26a55adab49eef6799c52b5e810bc2c94aa`（PR #1633）已彻底修复 `C59` 24 回合 `systemPrompt` KV 缓存恒等回归，核心 Vitest（87/87）、`lane-context-budget` + `lane-storyboard-review`（15/15）与全部门岗全绿，零本机路径泄露，签发 **通过**。
