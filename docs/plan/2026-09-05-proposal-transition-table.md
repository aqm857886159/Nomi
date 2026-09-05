# Agent Host proposal 转换表（reducer 只查表）

> 📎 执行方案 · 2026-09-05 · 状态：✅ 已交付
> 分支 `refactor/proposal-transition-table-20260905`

## 为什么做（底层逻辑）

Host 的 proposal 状态机原来没有「机器」，只有一串 `||`。`proposal.put` 里那个 30 行的布尔表达式同时承担了**六件不同的事**：载荷形状、身份唯一性、时间单调、卡片一致性、生命周期合法性、**以及跨域准入**。最后一件被压在表达式中段的一个否定分支里（`!deferredCanvasAdmission && (target 不等 || preconditions 不等)`），所以它拒绝时只能吐一个字符串 `proposal_transition_invalid`——**不说是哪一维不匹配**。

2026-09-05 那次 `proposal_transition_invalid`（创作区队列是 document target、canonical canvas adapter 造出 canvas target、reducer 没有跨域准入格）正是这个结构的必然产物：现象是「审批完什么都没发生」，排查成本全花在「到底哪个条件假了」上。

**这次改的是可诊断性与可扩展性，不是放宽准入**：把 (来源域 × 目标域 × 当前状态 × 动作) 做成显式数据表，reducer 查一次表；表里没有的格子直接拒绝，错误对象带上格子坐标。新增一个 `TargetRef` 种类时，编译器会先拦住你（`UncoveredProposalDomain`），而不是让它悄悄落进默认拒绝。

## 范围

- **动**：`electron/projectAgentHost/projectAgentProposalTransitions.ts`（新，纯数据 + `resolveTransition`，206 行）、`projectAgentProposalReduction.ts`（新，两条 proposal 命令的归约体，按既有 `reduceProjectAgentQueueMutation` 模式从 switch 里抬出来）、`projectAgentReducer.ts` 的 `proposal.put` / `proposal.transition` 两支改为委派（821 → 636 行，`check:filesize` 通过）、`projectAgentRecordReduction.ts` 收下 `findTurn` / `findQueueForTurn` / `assertSingleRunningTurn` 三个记录查找 helper（原来是 reducer 私有，两处都要用，移动而不是复制）、`projectAgentReducerContract.ts` 的错误对象、两个测试文件。
- **不动**：准入语义本身（行为等价）、`persistApprovedProposal` 的 re-anchor 修法（PR #… 的 `2026-09-05-canonical-storyboard-proposal-transition` 合同继续有效）、渲染层 `src/workbench`、`.github/workflows`、`scripts/check-*`。
- **回滚**：`git revert` 单个 commit 即可；表与 reducer 在同一 commit，没有并行版可回退到一半。

## 表：域轴（只在 `put` 生效）

`域 = TargetRef["kind"]`。同名类型的唯一 owner 仍是 `electron/shared/capabilityTargeting.ts`，本表不复制词表。

| source（队列 target） | target（approval ref target） | 规则 | 拒绝理由 |
|---|---|---|---|
| `document` | `document` | `queue-identity` | — |
| `canvas` | `canvas` | `queue-identity` + `deferred-canvas-edges` | — |
| `canvas-result` / `asset` / `timeline` / `export` / `artifact` / `production` | 同名 | `queue-identity` | — |
| **`document`** | **`canvas`** | **`host-anchored-upstream`（显式关闭格）** | `host_anchor_required` |
| 其余 55 格 | | 表中无 | `cross_domain_admission_absent` |

`document → canvas` 是**显式的一格**而不是掉进默认分支：这类写入（renderer-owned storyboard）真实存在，但它的 Host 台账必须由调用方先 re-anchor 回队列 target，再以 `document → document` 入表。reducer 保持 fail-closed——这是上游根因合同 `2026-09-05-canonical-storyboard-proposal-transition.root-cause.json` 里 `proposal.put` 那条不变量的原文要求，本次不动它。

`deferred-canvas-edges` 是唯一允许改写冻结队列项的规则：canvas 队列在无 preconditions 时采纳 ref 的 edge preconditions。

## 表：生命周期轴

`absent` 是「尚无台账记录」的坐标，与 `PROJECT_AGENT_PROPOSAL_LIFECYCLES` 组合使用，**不新起一份状态词表**（`check:vocabularies`）。

| from | action | to | 域轴 | 缺格时的码 |
|---|---|---|---|---|
| `absent` | `put` | `pending` | 查域轴（`queue-admission`） | — |
| `pending` | `claim` | `claimed` | 已在准入时冻结（`recorded-anchor`） | — |
| `pending` | `expire` | `expired` | 同上 | — |
| `pending`/`claimed`/`expired` | `put` | — | — | `record_exists` / `approval_already_recorded` |
| `absent` | `claim`/`expire` | — | — | `record_not_found` / `approval_not_recorded` |
| `claimed`/`expired` | `claim`/`expire` | — | — | `proposal_transition_invalid` / `lifecycle_action_unavailable` |

## 盘点：每条 transition 原来藏在哪

| # | 原位置 | 原写法 | 现在 | 测试 |
|---|---|---|---|---|
| 1 | `projectAgentReducer.ts:67` | `isProposalTransition(from,to)` 私有 helper | `LIFECYCLE_TABLE` 三格 | `projectAgentProposalTransitions.test.ts`「resolves every … cell」；`projectAgentProposalReducer.test.ts`「rejects proposal events that run backward…」 |
| 2 | `proposal.put` 的 `record_exists` 条件 | `proposalApprovals.some(v => v.ref.approvalId === …)` | 表格 `fromState ≠ absent + put` | 表驱动 + 「rejects a new approval that reuses a settled tool call or receipt identity」 |
| 3 | `proposal.put` 的 `deferredCanvasAdmission` | 谓词里两个 `.target.kind === "canvas"` 判断 | `ADMISSION_TABLE` `canvas>canvas` 格的 `rules` | 表驱动；reducer 级由既有 canvas 提案用例覆盖 |
| 4 | `proposal.put` 大 `||` 链中段 | `!deferredCanvasAdmission && (target 不等 \|\| preconditions 不等)` 顺带吞掉所有跨域 | `ADMISSION_TABLE` 缺格 / `host-anchored-upstream` 格，带坐标 | 「reports the missing table cell for a cross-domain proposal…」（新） |
| 5 | `proposal.transition` ×3 处 | `mutation.payload.lifecycle === "claimed"` 就地判别动作 | `resolveProposalTransitionAction` + `settlement.toState` | 「maps only settleable lifecycles onto a table action」（新） |

**邻接守卫（明确不进表）**：`turn.transition` 在有 pending/claimed approval 时抛 `proposal_transition_invalid`、`execution.recover` 把 approval 终结掉——这两条不是 proposal 生命周期的 *动作*，它们是**处置**（移除或终结记录），语义 owner 是 turn 状态机。放进本表会把两个状态机搅在一起，故留在 reducer 并在此登记。

## 覆盖缺口（诚实标注）

- **表级**：768 格（8×8×4×3）全部由 `projectAgentProposalTransitions.test.ts` 遍历断言，期望值在测试里独立声明，不回读实现。
- **reducer 级**：只有 `canvas>canvas`（既有用例）、`document>document`、`document>canvas`（本次新增回归）三格真正走过 reducer。其余 6 个同域格与 55 个跨域格**只有表级覆盖**——它们在 reducer 里走的是同一次 `resolveTransition` 调用，没有分支差异，故不为每格再造一个 Host 状态。

## 验收门

`pnpm run typecheck` / `check:filesize` / `check:boundaries` / `check:vocabularies` / `pnpm run gates` 全绿，且 `electron/projectAgentHost` 全套 28 个测试文件继续绿（无删断言、无放宽断言）。
