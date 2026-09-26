# Phase -1 入口语义对账矩阵

> 状态：✅ 审计产物完成；入口对账未全部放行（迁移放行：**PARTIAL/BLOCKED**）
> 审计基线：`origin/main@1f39ea3cf`（已纳入制作镜头重开修复、Windows 付费走查 harness 和素材物化边界修复）；当前交付工作树没有生产代码改动。

## 比较规则

入口对账不是比较整个 transport 报文，而是按固定顺序比较：

```text
untrusted input
  → parse/normalize
  → canonical domain command/hash
  → policy + grant
  → auth/lease envelope
```

actor、trace、auth、lease、transport、idempotency 是允许差异，但必须显式列入 allowlist。`projectId`、target、provider、model、mode、variant、parameters、references、contractHash 和 authorization digest 的差异不能被 `omit` 掉。

## 当前对账

| 入口 | 当前 canonical 路径 | 当前结果 | 主要差异/风险 | 下一步红测 |
|---|---|---|---|---|
| Agent/MCP semantic create | `mcpGenerationTools` → `createProductionGenerationOperationStore` → Run-backed operation | **PARTIAL**：使用 `PlanCandidate`/Run owner；入口 parity helper 已存在，但端到端对等收据未补齐 | 需要把 Agent lane 的 transport wrapper 与 semantic command hash 固定对上 | 同一 candidate 从 MCP/Agent 产生相同 candidate hash/contract hash |
| ProductionRun authorization | `prepareProductionGenerationAuthorization` → envelope/gate/recheck | **PASS（局部）**：digest、project/run/plan/target 校验存在 | side-ledger commit marker 尚未实现 | grant 改 provider/model/target 的负向测试 |
| Semantic submission | `productionGenerationSubmission` → `submissionOutbox` → provider adapter | **PASS（局部）**：contract、provider payload hash、idempotency、unknown/reconcile 有守卫 | 仍需确认 `generationSingleShot` 生产调用者是否绕过主 facade | 同一 job 只允许一次 provider dispatch；unknown 只能 reconcile |
| Canvas direct single/batch | `generationRunController` → `catalogTaskActions` → `runtime.runTask`/`submissionLedger` | **FAIL（结构对账）**：不创建 semantic contract/envelope/ProductionRun | node run.id、canvas progress/result 与 Run identity 是第二条 paid lifecycle | 付费远端输入必须不能绕过 `ExecutionContractV1`/authorization |
| Storyboard row action | `storyboardRowActions` → canvas runner surface | **UNVERIFIED** | UI 入口可能走 direct runner；需要调用图确认 | 同一 storyboard target 走 semantic 与 canvas 入口时 command/hash 相等 |
| Recovery/resume | `productionRunResume` + `productionGenerationSubmission.resume` | **PASS（语义链）**：accepted→poll、unknown→reconcile、committed intent 不重提 | direct canvas recovery 语义需与 semantic path 对账 | 关闭重开、丢回执、旧 revision、foreign project |
| Task center | Run summary → `productionRunTaskCenter` → row builder | **UNVERIFIED** | Button/Panel 各自调用 builder/labels，静态证据提示投影组装重复，但尚未有 sourceRevision 对账探针 | 两个 surface 对同一 sourceRevision 得到同一 row/status/group |

## 负例矩阵

Phase 1 必须把以下差异写成会红的测试：

1. 画布 direct path 缺 `contractHash` 或 authorization digest 时，远端付费 dispatch 必须被拒绝或转入 canonical adapter。
2. Agent 与 MCP 同一输入只改变 actor/trace 时，canonical command hash 必须相同。
3. model 相同但 variant/mode 不同时，hash 必须不同，不能根据基础 model key 猜回默认 variant。
4. 同一 `runId/jobId/attempt` 换 project binding 时，submit/reconcile 必须拒绝。
5. auth/lease 包装变化不能改写 domain payload；domain hash 与 wire payload hash 不一致时必须失败。
6. provider 回执 unknown 时，所有入口都必须得到 reconcile/人工处理语义，不能有一个入口显示“失败可重试”。

## Phase -1 结论

语义链内部的 contract/auth/reconcile 对账基础已存在，但完整入口 parity 尚未放行；**direct canvas remote/paid candidate 是当前 parity 的硬红点**。这条红点已登记为后续迁移门，不在本阶段用 adapter 临时双写掩盖。
