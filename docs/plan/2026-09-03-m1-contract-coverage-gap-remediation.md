# M1 转发壳暴露出的四份根因合同覆盖缺口 — 返还计划

> ⏳ 已拍板·未开工 · 2026-09-03
> **一句话**：`hostLifecycle.test.ts` 这个转发壳被删掉后，rc-01/02/05/06 四份 R21 合同各自指向一个已不存在的回归测试；本文记录**逐条读断言核实过的**真实覆盖、仍然缺的不变量，以及为什么这次没有直接改合同 JSON。

## 背景（怎么发现的）

修一条 flaky 测试时顺出来的。完整机制见两条教训：
[`compat-shim-keeps-command-text-changes-its-meaning`](../lessons/compat-shim-keeps-command-text-changes-its-meaning.md)（主线）与
[`complexity-invariants-need-counters-not-wall-clock`](../lessons/complexity-invariants-need-counters-not-wall-clock.md)（同一次事故的另一面）。
QA 侧追记见 [`2026-09-01-agent-m0-red-lights.md`](../qa/2026-09-01-agent-m0-red-lights.md) 末节。

简述：commit `0b6441c6`（M1 round-2 transplant）删掉 `electron/projectAgentHost/hostLifecycle.ts` 及其 80 行 5 用例测试，原路径只留 3 行 `import './projectAgentHost.test'`。四份合同都把这个路径列为**唯一** `regression_tests`，`check:root-cause-contracts` 查的是 `pathExists`，壳在就一直绿。2026-09-03 壳已按 P1 删除。

## 已核实的真实覆盖（逐条读过断言，不是按文件名猜）

| 合同 | 不变量 | 状态 | 证据 |
|---|---|---|---|
| rc-01 | 1. 一个 durable Host owner | ✅ 有 | `projectAgentHost.test.ts:173` "persists command idempotency and replays the original receipt after restart"；`projectAgentExecutionCoordinator.test.ts:1056` "atomically terminalizes process-restart orphans exactly once without running the model" |
| rc-01 | 2. Pi session 不投影出第二份历史 | ❌ **缺** | 实搜未找到任何断言 |
| rc-01 | 3. 已结算 idempotency key 不得二次派发 | ✅ 有 | 同上 `:173` |
| rc-02 | 1. 每个模型工具命名一个用户意图 | ✅ 有 | `electron/harness/tools/modelToolSurfaceManifest.test.ts:10` "projects the generation chain as two semantic intents" |
| rc-02 | 2. Host-only transition 不进模型投影 | ✅ 有 | 同文件 `:28`，在 `:38` 遍历 `GENERATION_HOST_ONLY_TRANSITIONS` |
| rc-02 | 3. alias 删除与语义替换同 commit | ❌ **缺** | 这是 commit 形状规则，运行时测试表达不了，需要门岗或显式降级 |
| rc-05 | 1. 模型可见结果都经 safeParse | ⚠️ 至多部分 | 未找到断言模型可见投影上 safeParse 的测试 |
| rc-05 | 2. 凭据/私有路径/超大载荷脱敏或拒绝 | ❌ **缺（安全项）** | `electron/harness` 内唯一脱敏是 `errorFacts.mts`，它洗的是**网络错误消息**，不是工具结果载荷 |
| rc-05 | 3. 被拒结果发错误码且不进模型上下文 | ✅ 有 | `projectAgentExecutionCoordinator.test.ts:3056` "terminalizes a running turn when the model runtime fails" |
| rc-06 | 1. 所有 item 在 `execution_settled` 前终态 | ❌ **未实现** | `grep -rn execution_settled electron/` **零命中**；`projectAgentHost.ts` 里的 `settled` 只是分区 FIFO 尾的局部 promise 变量。现存的是更窄的提案级结算（`recordProposalSettlement`），不是 gating completed 的通用屏障 |
| rc-06 | 2. approval/budget/receipt/artifact/context 落盘先于 completed | ✅ 有 | `projectAgentIpc.test.ts:497`、`projectAgentProposalReceiptStore.test.ts:127` |
| rc-06 | 3. 未知外部效果进 reconcile、不盲目重投 | ✅ 有 | `projectAgentExecutionCoordinator.test.ts:2462` "settles an earlier Canvas approval done and a later unresolved approval failed without redispatch" |

**另有一条独立缺口**：RL3 红灯的主角 `markDeviated` 已从全仓消失；`deviated` 字段还在 `projectAgentState.ts:261,267` 的校验闸里用，但**测试里每一处都是 fixture 赋值，没有一条断言**。

## 为什么这次没有直接改合同 JSON（重要）

试过，`check:root-cause-contracts` 会红——**而且它红得对**。

`validateRootCauseChange` 的规则是：**任何被本次 diff 改动的 v3 合同都要走完整 `validateContract`**，其中 `recurring` 合同要求 `prevention.enforcement_path`、`prevention.artifacts`、`regression_tests`、`legacy_paths.removed_paths` **全部在本次 diff 中被改动**。设计意图写在源码注释里：「只有本次新增/修改的合同能为本次改动背书」。

也就是说：**合同不是靠改 JSON 修好的，是靠做它描述的那件事修好的。** 要让门岗绿，我就得在这个 diff 里去动 `projectAgentHost.ts`、`projectAgentExecutionCoordinator.ts` 等生产文件，假装这次改动就是这四份合同描述的修复——那是**糊弄门岗**，正是本文要暴露的那类事的翻版。

所以：合同保持原样（仍指向已删路径，是**可见的**锈，不是隐藏的），缺口记录在本文 + QA 追记 + 两条教训里。

## 返还顺序（建议，逐条独立可交付）

每一条都应当在**它自己的 diff 里**同时：补上真实回归测试 → 更新对应合同的 `regression_tests`/`artifacts` → 让 `check:root-cause-contracts` 自然变绿。这正是门岗想要的形状。

1. **rc-05 不变量 2（安全项，优先）** — 模型可见结果的凭据/私有路径/超大载荷脱敏。这是四条缺口里唯一直接碰信任边界的，且 R20 明确「碰钱碰信任的用标准实现或对齐标准语义」。
2. **rc-06 不变量 1** — 先裁决：`execution_settled` 是要**实现**，还是把合同降级到 M1 实际建成的提案级结算。别让一条代码里不存在的状态名继续挂在 invariant 上。
3. **RL3 `deviated`** — 要么补断言，要么在红灯清单里明确降级；现状是「记在已通过里但无覆盖」。
4. **rc-01 不变量 2 / rc-02 不变量 3** — 前者需要一条 Pi session 不产生第二份历史的测试；后者是 commit 形状规则，考虑做成门岗而不是测试。

## 不做什么

- 不为了让门岗变绿而把合同改指到没验过的文件（把覆盖缺口洗成绿灯）。
- 不因为「合同指向的文件没了」就删合同——它们记录的问题分析仍然有效，缺的是覆盖。
