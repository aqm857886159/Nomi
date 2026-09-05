# PR #452 失败门诊断

日期：2026-09-04  
PR：[#452](https://github.com/aqm857886159/Nomi/pull/452)  
审计 head：`75f8e4148ee6d539d2e54250e3c7bb5b75497f5a`  
基线：`origin/main`=`45912ae01a155a3f6592f65368d0ce3d12fc034e`

## 隔离状态

诊断在独立 worktree 完成：

`/Users/aoqimin/Documents/Codex/2026-09-04/pr452-usage-repair/work/Nomi-pr452-failure-gates-red`

分支：`codex/pr452-failure-gates-red-20260904`。目标 head 分支仍在原 worktree，`main` 工作树的既有脏文件未触碰；本 worktree 初始干净。本轮没有改生产代码、没有推送、没有合并，也没有伪造绿灯。

## CI 最早真实失败

Run `33790669994` 的 `E2E Walkthroughs (Linux)` / `MCP L1 handshake journey` 执行：

```text
xvfb-run -a pnpm run test:mcp-journey
pnpm run check:electron-install && node tests/ux/mcp-l1-handshake.e2e.mjs && node tests/ux/mcp-l2-journeys.e2e.mjs && node tests/ux/mcp-skills-integration.e2e.mjs
```

Electron 安装检查 13/13 通过；MCP L1 C1–C8 通过；C9 在真人生成确认门失败。最早真实失败是：

```text
nomi_operation_gate error= ...
"errorCode":"receipt_invalid"
"message":"Generation approval receipt projectRevision does not match the current scope"
"recoveryActions":["This confirmation is no longer valid; confirm again in Nomi."]

Error: nomi_operation_gate: ✗ This confirmation is no longer valid; confirm again in Nomi.
    at tests/ux/mcp-l2-journeys.e2e.mjs:39:11
```

发生在 C9 `operation_plan`、`operation_preview` 和确认卡出现之后，点击 `[data-production-action="confirm"]` 返回 gate 结果时；供应商提交尚未发生。日志中的 DBus `Unknown address type` 是 Electron/Linux 环境噪声，不是最早失败点。

Run `33790669994` 的 `Quality Gate` / `Require every validation surface` 只执行了 fail-closed 汇总：

```text
test "failure" = "success"
```

因此它不是第二个独立根因。其余该 run 的 Validation Scope、Contracts、Unit、Workers Builds 通过；Canvas、Mac Package 按 scope 跳过。

## 单一根因假设

假设：C9 在新项目切换并导入参考资产后，没有在发起付费 gate 前证明项目 manifest revision 已稳定；授权封存时读取的 revision 与确认回执提交时从 live project resolver 读取的 revision 不同，安全校验按设计拒绝了收据。

证据链：

1. C9 直接执行 `project_create` → hash 切换 → `session_open`，随后 `asset_import`，然后立即 `operation_plan` / `operation_preview` / `operation_gate`（`tests/ux/mcp-l2-journeys.e2e.mjs:220-275`）；这里没有 revision-stable 等待或 revision 取证。
2. 生产接线在 `mcpStdioServer.ts:283-298` 以当前 `readWorkspaceProject(...).revision` 创建授权 envelope。
3. `runOwnedGenerationGateAuthority.ts:78-92` 把该 envelope revision 写入 challenge/receipt 范围。
4. `productionRunApprovalReceipt.ts:24-39` 在 gate decide 时重新读取 live project revision，并要求 receipt revision 完全相等；不相等即 `ReceiptScopeError`，再由 MCP 层映射为 `receipt_invalid`。
5. 另一个多镜真实旅程已有同类时序说明：新项目建好后 board 初始化会继续改 revision，必须等 digest 稳定后再开 session。PR #452 的生产 diff 只涉及 Host usage 字段、状态校验和 resident projection，没有修改 generation gate、project revision 或 receipt 代码；因此当前失败不能归因于 usage ledger 的直接逻辑改动。

这只是已被 CI 日志和代码路径支持的最小假设；本轮未声称已通过一次本地真实 Electron 重跑。

## PR #452 已有改动（现状，不是本轮新增）

- `electron/projectAgentHost/projectAgentExecutionCoordinator.test.ts`：新增 terminal usage 写入并 reopen 恢复的协调器测试。
- `electron/projectAgentHost/projectAgentReducer.ts`：async result 接受并校验 usage，再写入 terminal turn。
- `electron/projectAgentHost/projectAgentState.ts`、`projectAgentStateValidationPrimitives.ts`：snapshot usage schema 与整数校验。
- `electron/projectAgentHost/projectAgentTurnExecution.ts`、`electron/shared/projectAgentContracts.ts`：Host async result/envelope/turn 类型携带 usage。
- `src/workbench/ai/ProjectAgentResidentShell.tsx`：优先从 Host snapshot 投影当前线程的累计/最近 usage，legacy 时回退旧 store。

这些改动没有在本轮修改，也没有宣称它们已通过失败的 C9 gate。

## 最小修复范围建议

优先修复测试/真实 harness 的时序，不放宽 receipt revision 安全边界：在 C9 的 asset import 和/或 session open 后，通过真实项目读取边界等待 project revision 连续稳定，再进行 plan/preview/gate；若需要共享 helper，范围应限于 `tests/ux/mcp-l2-journeys.e2e.mjs` 及其 journey helper。

只有在能用真实 app harness 重现“项目无用户写入却在 gate 确认期间继续 revision 漂移”后，才考虑生产层修复；候选 seam 是 `electron/capabilityCore/mcpStdioServer.ts` 的授权快照与 `electron/productionRun/productionRunApprovalReceipt.ts` 的校验，但不得简单删除或放宽 `projectRevision` 比较。

本轮没有足够证据证明需要生产改动，因此没有新增红测或生产修复代码。

## 后续绿测最低要求

修复后必须重新取得真实证据：

- Host async result boundary：terminal response 的 usage 进入 durable Host snapshot；非法 usage 被拒绝。
- 磁盘持久化：关闭/重新创建 coordinator 后 snapshot 中仍保留 usage，格式通过 state validator。
- coordinator reopen/restore：恢复的是同一 turn/thread 的 Host 状态，不是 renderer store 的假数据。
- renderer resident UI：真实 Electron UI 从 Host snapshot 投影累计与最近 usage，并覆盖 legacy fallback。
- C9 真实 app harness：真实项目、asset import、operation plan/preview、确认卡、receipt decide 全链路通过，且供应商 fixture hit 仍为零额度/仅预期调用。
- Quality Gate：必须由真实 E2E 成功驱动汇总绿灯；不能用 `test "failure" = "success"` 的汇总日志替代。
