# Resident Composer durable document proposal receipt

日期：2026-09-04
基线：`origin/main=f439f5147704c1c214a7ff08b87b714a23f287a6`
分支：`codex/resident-composer-receipt-fix-20260904`
发现来源：[#466](https://github.com/aqm857886159/Nomi/pull/466) 的真实 Resident Composer 失败证据；本修复不修改 #466 分支。

## 交付边界

本 PR 只收口 document proposal receipt slice：main/Host 持有 durable receipt，MCP loopback/stdio 和 Agent Host approval 都经过同一 prepare → real write → commit/undone revision CAS。没有修改 CSS、视觉方向或 #462 storyboard canonical 文件；没有把 canvas receipt 扩进本次分母。

Receipt ownership 不在 harness：Electron journey 只从可见 Resident Composer 输入意图，等待真实 Agent proposal/approval，调用真实 MCP stdio production write，随后从项目磁盘读取 document 和 `.nomi/project-agent-proposal-receipt.json`。测试不会直接注入 Host item、reducer state 或最终 receipt。

## Root cause / contract

原缺口是 Host approval 和 MCP stdio 各有写入入口，却没有共同的 main-owned durable proposal receipt boundary。写入 adapter 可以产生 applied result，而 receipt writer 在部分调用点是 optional；这使 approve、deny、stale revision、duplicate/no-op、timeout 和 network failure 无法由同一 revision/journal 区分。

修复后的 contract 是：

- approve 后先 prepare 当前 proposal/action hash，再 dispatch 真实 document adapter；只有 `applied=true` 才 commit 同一 receipt。
- deny、missing confirmation、stale target、timeout、network/provider failure 和 commit CAS failure 均 fail-closed；已 prepare 的 receipt 变为 `undone`，无法安全 CAS 时保留 `preparing` 证据，不声称成功。
- MCP stdio 启动时从真实 project root/identity 解析默认 receipt service；loopback、RPC 和 Host resolver 都只转发 main-owned writer。
- receipt binding、revision、operation journal 和 document effect 在 cold restart 后可读回；同一 writer 对 approve/MCP write 使用不同 operationId 但保持 durable revision 单调递增。

## Red → green

同一测试断言先用于证明缺口，再保留为回归测试；临时 red 改动未进入提交。初始缺失 receipt/forwarding 时，Host/MCP write 只能得到 document result 而没有 durable receipt；补齐 main Host/approval boundary 后，以下命令绿：

```sh
pnpm exec vitest run \
  electron/capabilityCore/mcpEditingSurface.test.ts \
  electron/capabilityCore/mcpLoopbackRpcRequest.test.ts \
  electron/capabilityCore/mcpDocumentWriteReceipt.test.ts \
  electron/capabilityCore/mcpStdioDocumentReceipt.test.ts \
  electron/capabilityCore/rpcServer.test.ts \
  electron/projectAgentHost/projectAgentAdapterResolvers.test.ts \
  electron/projectAgentHost/projectAgentExecutionCoordinator.test.ts \
  electron/projectAgentHost/projectAgentIpc.test.ts \
  src/workbench/capability/capabilityApplyHandler.documentWrite.test.ts \
  --reporter=verbose
```

结果：`9 files passed, 130 tests passed`。MCP contract matrix 另跑：`electron/capabilityCore/mcpRealUserJourneys.test.ts`，`1 file passed, 8 tests passed`，覆盖空/超长/Unicode、非法请求、stale revision、timeout、network failure 和 provider failure。

## Changed-scope raw V8 receipt

当前源码 raw V8 artifact：
`/tmp/nomi-resident-final.zYYmhq/coverage-final.json`

生成命令使用安全临时目录，并运行当前 focused `12 files / 150 tests`：

```sh
coverage_dir=$(mktemp -d /tmp/nomi-resident-final.XXXXXX)
pnpm exec vitest run \
  electron/capabilityCore/mcpEditingSurface.test.ts \
  electron/capabilityCore/mcpLoopbackRpcRequest.test.ts \
  electron/capabilityCore/mcpDocumentWriteReceipt.test.ts \
  electron/capabilityCore/mcpStdioDocumentReceipt.test.ts \
  electron/capabilityCore/rpcServer.test.ts \
  electron/projectAgentHost/projectAgentAdapterResolvers.test.ts \
  electron/projectAgentHost/projectAgentExecutionCoordinator.test.ts \
  electron/projectAgentHost/projectAgentIpc.test.ts \
  src/workbench/capability/capabilityApplyHandler.documentWrite.test.ts \
  electron/capabilityCore/mcpDocumentConfirmation.test.ts \
  electron/projectAgentHost/projectAgentDocumentReceipt.test.ts \
  electron/projectAgentHost/projectAgentReceiptResolver.test.ts \
  --coverage --coverage.provider=v8 \
  --coverage.include=electron/capabilityCore/mcpDocumentConfirmation.ts \
  --coverage.include=electron/projectAgentHost/projectAgentDocumentReceipt.ts \
  --coverage.include=electron/projectAgentHost/projectAgentReceiptResolver.ts \
  --coverage.include=electron/capabilityCore/mcpProtocol.ts \
  --coverage.include=electron/projectAgentHost/projectAgentTurnExecution.ts \
  --coverage.reporter=text --coverage.reporter=json --coverage.reporter=json-summary \
  --coverage.reportsDirectory="$coverage_dir"
```

Raw result：`12 files passed, 150 tests passed`。Exact `statementMap` / `branchMap` / `fnMap` extraction from the same raw map is 100% for every requested dimension；unique statement lines are the exact statementMap line carriers in each span：

| production file | exact span | statements | branch arms | functions | unique statement lines |
| --- | --- | ---: | ---: | ---: | ---: |
| `mcpDocumentConfirmation.ts` | `17-48` | 6/6 | 8/8 | 1/1 | 6/6 |
| `projectAgentDocumentReceipt.ts` | `14-81` | 7/7 | 10/10 | 4/4 | 7/7 |
| `projectAgentReceiptResolver.ts` | `30-44` | 8/8 | 5/5 | 2/2 | 6/6 |
| `mcpProtocol.ts` | `528-533` | 2/2 | 2/2 | 0/0 | 2/2 |
| `projectAgentTurnExecution.ts` | `568-602` | 18/18 | 20/20 | 0/0 | 18/18 |
| **aggregate** | **exact requested spans** | **41/41** | **45/45** | **7/7** | **39/39** |

`projectAgentTurnExecution.ts` 的旧 line 603 catch 属于 unchanged legacy fallback，已排除，不进入本次 exact span 分母。`main.ts` 的 `proposalReceiptFor` 只是 thin wiring；它由真实 Electron journey 证明，不错误计入 raw unit aggregate。

## Real Electron evidence

Command：

```sh
node tests/ux/resident-composer-receipt-fix.e2e.mjs
```

Result：exit `0`；真实 journey matrix `H/B/E/T/N = 5/5`。

- 双进程真实 GUI：首次 Electron PID `206`，冷启动第二个 Electron PID `1381`；Electron `43.4.1`，Node `24.18.1`。
- 独立真实 MCP stdio PID `859`。
- Host receipt：revision `2`，lifecycle `committed`。
- MCP receipt：revision `4`，lifecycle `committed`。
- cold restart 读回两条：`ResidentHostApproved她按下录制键，开始拍摄。`；`McpStdioProductionWrite这次写入必须经过同一确认回执。`。
- `paidCalls=0`，`blockers=[]`，`unexpected=[]`，journey `result=passed`。
- Artifact：`.tmp/pi-resident-composer-receipt-fix-development-1788523378863`。

这是 development-only 的双进程真实 Electron evidence；journey script 没有 packaged 参数，因此不声称 packaged parity。截图数组为空；没有用截图或模拟结果替代真实 GUI/MCP 流程。Full-repository 100% coverage 也不在本次声明范围内。

临时 raw V8、Electron project root 和 `.tmp/pi-*` report 均为本地证据，不进入 PR。

## Remaining gaps

Canvas proposal receipts, live external provider certification, and packaged Electron parity remain separate work. They are intentionally outside this minimal document receipt slice and its coverage denominator.
