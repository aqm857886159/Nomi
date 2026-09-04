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

Raw artifact：
`outputs/qa/2026-09-04/resident-composer-receipt-fix/f439f514/raw-v8-final/coverage-final.json`

原始 map 生成命令只 include 本次五个 production carrier 文件；整文件 summary 仅用于生成 raw map，不能当 changed-scope target：

```sh
coverage_out='outputs/qa/2026-09-04/resident-composer-receipt-fix/f439f514/raw-v8-final'
pnpm exec vitest run \
  electron/capabilityCore/mcpDocumentWriteReceipt.test.ts \
  electron/capabilityCore/mcpStdioDocumentReceipt.test.ts \
  electron/capabilityCore/rpcServer.test.ts \
  electron/projectAgentHost/projectAgentAdapterResolvers.test.ts \
  electron/projectAgentHost/projectAgentExecutionCoordinator.test.ts \
  --coverage --coverage.provider=v8 \
  --coverage.include=electron/capabilityCore/mcpDocumentWriteReceipt.ts \
  --coverage.include=electron/capabilityCore/mcpStdioServer.ts \
  --coverage.include=electron/capabilityCore/rpcServer.ts \
  --coverage.include=electron/projectAgentHost/projectAgentAdapterResolvers.ts \
  --coverage.include=electron/projectAgentHost/projectAgentTurnExecution.ts \
  --coverage.reporter=text --coverage.reporter=json --coverage.reporter=json-summary \
  --coverage.reportsDirectory="$coverage_out"
```

新 helper 使用同一 command 加四项 thresholds，结果为：

```text
Statements: 100% (14/14)
Branches:   100% (7/7)
Functions:  100% (2/2)
Lines:      100% (14/14)
```

精确 map receipt 按已合入的 [`storyboard-agent-canonical-followup.md`](./2026-09-04-storyboard-agent-canonical-followup.md) 第 66-129 段算法，在本地临时 Node 校验器中从上述 `coverage-final.json` 复核，结果为 `PASS`。该一次性校验器和所有 `outputs/qa` coverage JSON 均为临时产物，刻意不进入 PR；PR 保留 exact span、branch id 和可审计命令，避免带入大体量报告或新的 QA tooling。`coverage-final.json` 的 V8 v4.1 原始结构提供 `s/f/b`，没有独立 `l` counter；line 数由 exact statementMap line carriers 计算，新 helper 的独立 Vitest threshold 同时验证了 lines 100%。

| production file | exact changed spans | statements | branch arms | functions | line carriers |
| --- | --- | ---: | ---: | ---: | ---: |
| `mcpDocumentWriteReceipt.ts` | `10-68` | 14/14 | 7/7 | 2/2 | 46/46 |
| `mcpStdioServer.ts` | `98-110;222-230` | 14/14 | 12/12 | 5/5 | 21/21 |
| `rpcServer.ts` | `263-268;280-281;304-324` | 10/10 | 15/15 | 3/3 | 29/29 |
| `projectAgentAdapterResolvers.ts` | `113-130` | 13/13 | 9/9 | 2/2 | 30/30 |
| `projectAgentTurnExecution.ts` | `74-143;643-672` | 24/24 | 28/28 | 5/5 | 75/75 |
| **total** | **exact scope only** | **75/75** | **71/71** | **17/17** | **201/201** |

The requested renderer fallback is current V8 branch `76` at source line `279`, both arms `[3,1]`. The requested receipt-writer failure fallback is current V8 branch `122` at source line `653`, both arms `[2,1]`. The startup fallback was extracted into a helper during the minimal fix: the current source carrier is `mcpStdioServer.ts:98-110`, V8 branch `1` at line `100`, both arms `[1,1]`; its direct invoker spans `222-230`, branches `15-19`, all arms non-zero. The old `233-237` / `25-26` coordinates were stale after that helper extraction and are not silently used as current IDs.

## Real Electron evidence

Command:

```sh
pnpm run typecheck
pnpm run build
node tests/ux/resident-composer-receipt-fix.e2e.mjs
```

Results:

- typecheck passed: app, Electron, and PI configs.
- build passed: Electron install identity, renderer production build, and Electron build.
- Electron report: `.tmp/pi-resident-composer-receipt-fix-development-1788517485296/report.json`.
- two GUI launches used the same isolated project: first PID `70433`, cold-restart PID `70971`; Electron `43.4.1`, Node `24.18.1`; independent MCP stdio PID `70873`.
- H passed: visible intent → real Agent planning request → pending approval.
- B passed: empty Composer remains disabled; Unicode content survives the real journey.
- E passed: visible approval card refusal causes no project mutation.
- T passed by `mcpRealUserJourneys.test.ts`: malformed/illegal operation, stale revision, timeout, network failure, provider failure, and duplicate/no-op contracts.
- N passed: real stdio process → MCP elicitation → GUI RPC → document write; Host receipt revision `2`, MCP receipt revision `4`, lifecycle `committed`, then cold restart readback returned `ResidentHostApproved她按下录制键，开始拍摄。` and `McpStdioProductionWrite这次写入必须经过同一确认回执。`.
- `paidCalls=0`, `blockers=[]`, `result=passed`.

This was development-mode two-process evidence. The journey script has no packaged argument, so no packaged parity result is claimed. Full-repository 100% coverage is also not claimed.

The temporary report directory under `outputs/qa/` and the temporary Electron `.tmp/pi-*` report are local evidence only; neither is a tracked deliverable.

## Remaining gaps

Canvas proposal receipts, live external provider certification, and packaged Electron parity remain separate work. They are intentionally outside this minimal document receipt slice and its coverage denominator.
