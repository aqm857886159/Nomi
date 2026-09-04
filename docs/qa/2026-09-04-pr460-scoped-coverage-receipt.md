# PR #460 scoped coverage receipt

日期：2026-09-04
分支：`codex/agent-usage-ledger-rebaseline-20260904`
基线：`origin/main=0c17317328dcfd29d72fb3c8235353981d92058d`（已合入 #461 MCP test hardening）
PR：[#460](https://github.com/aqm857886159/Nomi/pull/460)

## Scope rule

这是 changed-function receipt，不是仓库级 coverage，也不是把大文件整文件纳入分母。`productionRunService.ts` 只计本 PR 修改的 command duplicate/receipt span；Host 只计本 PR 实际增加的 usage validation/persistence span；`ProjectAgentResidentShell.tsx` 没有进入本 PR，usage pill/UI 改动转到 image2-confirmed 后续 PR。没有使用 `exclude` 隐藏本次修改。

## H/B/E/T/N production-entry matrix

| 类别 | 生产入口断言 | 证据 |
| --- | --- | --- |
| Happy | Run-owned gate 真实 receipt approve、`authorizeGeneration` 转发 sealed revision；Host terminal usage 落入 turn | `electron/productionRun/productionGenerationAuthorizationFlow.test.ts`；`electron/projectAgentHost/projectAgentExecutionCoordinator.test.ts` |
| Boundary | malformed sealed gate 不发 challenge；request-time expiry；non-waiting gate；duplicate 无 receipt no-op / valid receipt re-verify；semantic public fallback 不泄漏 handoff | 同上；`electron/productionRun/productionRunService.test.ts`；`electron/capabilityCore/mcpSemanticGenerationFlow.test.ts` |
| Error | C9 revision drift 返回 `receipt_invalid`；foreign/malformed receipt scope/catch；decline/no receipt；malformed Host usage 返回 `async_result_stale` | `productionGenerationAuthorizationFlow.test.ts`、`productionRunService.test.ts`、`productionRunApprovalReceipt.test.ts`、`projectAgentAssistantReducer.test.ts` |
| Timeout | semantic confirmation timeout 不 decide/start；sealed authorization request-time expired 不发 challenge | `mcpSemanticGenerationFlow.test.ts`、`productionGenerationAuthorizationFlow.test.ts` |
| Network | semantic gate request network failure 从 production handler 抛出，invoke 仅一次且不启动 provider task | `mcpSemanticGenerationFlow.test.ts` |

外部 provider 在 production Run tests 中只作为受控 transport seam；临时项目目录、真实 HMAC receipt authority、Run repository 和 production entry 均实际执行。timeout/network 测试只 mock 协议/外部依赖边界，不以 mock 代替 durable user-task effect；均断言没有 start/provider side effect。

## Red then green evidence

每个新增保护断言均在临时撤掉对应保护后用同一测试命令验证过红，临时改动随后恢复且没有提交：

- C9：去掉 confirmation 后的 revision check，`promise resolved "{ approved: true, run: ... }" instead of rejecting`，exit 1；恢复后同一 drift test green。
- public fallback：去掉 `built.leaseHandle` fallback，实际 `leaseHandle: undefined`；exit 1。
- public challenge privacy：不剥离 `handoff` 时，`expected ... not to have property "handoff"`；exit 1。
- duplicate receipt：恢复旧的早退时 `verifyReceipt` 期望 1 次、实际 0 次；exit 1。
- scope/catch：去掉 expected-field loop 时 promise resolved；不映射 generic catch 时收到原始 `Error` 而非 `code: receipt_invalid`；exit 1。
- malformed/expired/non-waiting gate：改变各自生产错误 contract 时，三条 exact message assertion 均 exit 1。
- Host usage：去掉 reducer 的 usage validator 时，malformed usage 收到 `code: invalid_mutation` 而非 `async_result_stale`；exit 1。

## Fresh raw V8 output

命令（无全量 test/build）：

```sh
coverage_dir=$(mktemp -d /tmp/nomi-460-coverage-final4.XXXXXX)
pnpm exec vitest run \
  electron/capabilityCore/mcpSemanticGenerationFlow.test.ts \
  electron/productionRun/productionGenerationAuthorizationFlow.test.ts \
  electron/productionRun/productionRunApprovalReceipt.test.ts \
  electron/productionRun/productionRunService.test.ts \
  electron/projectAgentHost/projectAgentAssistantReducer.test.ts \
  electron/projectAgentHost/projectAgentExecutionCoordinator.test.ts \
  -t 'semantic generation flow|Run-owned paid generation authorization|production approval receipt scope|production run service projection boundary|ProjectAgentHost assistant async finalization|persists terminal model usage' \
  --coverage --coverage.provider=v8 \
  --coverage.include=electron/capabilityCore/mcpSemanticGenerationFlow.ts \
  --coverage.include=electron/capabilityCore/runOwnedGenerationGateAuthority.ts \
  --coverage.include=electron/productionRun/productionRunApprovalReceipt.ts \
  --coverage.include=electron/productionRun/productionRunService.ts \
  --coverage.include=electron/projectAgentHost/projectAgentReducer.ts \
  --coverage.include=electron/projectAgentHost/projectAgentState.ts \
  --coverage.include=electron/projectAgentHost/projectAgentStateValidationPrimitives.ts \
  --coverage.include=electron/projectAgentHost/projectAgentTurnExecution.ts \
  --coverage.reporter=text --coverage.reporter=json \
  --coverage.reportsDirectory="$coverage_dir"
```

原始 JSON：`/tmp/nomi-460-coverage-final4.QiPlCR/coverage-final.json`
命令结果：`6 passed`，`61 passed | 74 skipped`，exit `0`。选定文件 raw summary 是 `Statements 48.94% (762/1557)`、`Branches 42.16% (600/1423)`；这两个数字包含大量未改动 legacy code，不能作为 scoped gate，也没有被冒充为 100%。

## Changed-function receipt

下表由上述 raw JSON 的 `statementMap`/`branchMap` 按精确 changed span 计算；分母不包含大文件无关函数：

| production scope | exact span / V8 carrier | statements | branches |
| --- | --- | ---: | ---: |
| `handleSemanticGenerationGate` | `mcpSemanticGenerationFlow.ts:20-50` | 9/9 | 13/13 |
| `assertCurrentProjectRevision` + `approvalReceiptForGate` | `productionRunApprovalReceipt.ts:18-60` | 24/24 | 38/38 |
| Run-owned revision gates and durable revision forwarding | `runOwnedGenerationGateAuthority.ts` additions at `74,134,147,173,210,221`; V8 enclosing carriers `74,134-152,173,208-226` | 13/13 | 100% of added gate arms |
| `productionRunService` duplicate receipt boundary | `productionRunService.ts:544-568` | 13/13 | 17/17 |
| Host async usage validation and persistence | `projectAgentReducer.ts:588-594,703-706` | 5/5 | 4/4 |
| Host snapshot usage acceptance | `projectAgentState.ts:124` | 2/2 | 2/2 |
| `assertProjectAgentUsage` | `projectAgentStateValidationPrimitives.ts:56-62` | 4/4 | 100% (no independent conditional in added function) |
| `executeProjectAgentTurn` usage field | new `usage: response.usage` at line `635`; V8 object carrier `projectAgentTurnExecution.ts:618-653` | 1/1 | n/a for added property |

Receipt conclusion：上述 scoped production spans 达到 statement/branch 100%；仓库级及未改动大函数没有达到 100%，保持明确未完成状态。

## Persistence/restart

`projectAgentExecutionCoordinator.test.ts` 的 `persists terminal model usage on the Host turn and restores it after reopening` 使用真实 repository lifecycle：第一次 execution 后断言 `snapshot(...).turns[0].usage`，重新打开 Host 后再次断言同一 usage；测试通过。Run-owned happy path 则断言 durable Run gate、Approval 和 budget ledger，drift path 断言 gate 仍 `waiting`、Approval 为空。

## Uncovered / owner

仍未计入 scoped receipt 的分支是未改动代码：`runOwnedGenerationGateAuthority.ts:80` 的旧 display model fallback、旧 shots/display conditionals、`productionRunService.ts` 的 legacy projection/driver/recovery/event-wait 分支，以及 Host 大文件其余 lifecycle 分支。它们没有被 exclude 或 snapshot 隐藏；owner 分别是 run-owned display coverage、productionRun projection/driver owner、projectAgentHost lifecycle owner，后续另 PR 承接。UI usage pill 则由 image2-confirmed UI PR owner 承接。
