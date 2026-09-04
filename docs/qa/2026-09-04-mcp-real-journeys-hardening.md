# MCP 真实用户旅程测试加固证据

日期：2026-09-04
基线：`origin/main` `53e3ab7c2f38561760a6b7262c76c098929a7c34`（包含 PR #455/#457 合并链）

## 范围

新增测试从 `createMcpProtocol.handleIncoming` 进入生产 MCP `tools/call` 入口，使用真实 `MCP_TOOL_RESOLVER`、JSON Schema 校验、工具路由、`build` 和错误结果投影。唯一 mock 是 transport 的 `invoke` 边界；没有 live/paid credential、真实供应商或外部网络请求。

覆盖：

- Happy path：`nomi_project_create` → `nomi_read(target=projects)` → `nomi_operation_plan` → `nomi_operation_preview`，并验证重复输入的独立调用。
- Boundary：空字符串、长字符串、Unicode（含 emoji）、4000 码点上限和 4001 码点超限。
- Error：缺必填参数、未知字段、未知 operation、`null` 参数、stale revision。
- Failure：确定性 `capability_timeout`、network failure 和 provider failure；验证 `isError`、诊断码及 edge secret/URL 不泄漏。

## Red → Green

### Red

命令：

```text
pnpm exec vitest run electron/capabilityCore/mcpRealUserJourneys.test.ts
```

结果：1 test failed。`accepts a max-length Unicode instruction through tools/call` 收到 `result.isError === true`，失败位置是新增测试的入口响应断言；原因是生产校验器用 UTF-16 `value.length` 计算 JSON Schema 字符长度，4000 个 emoji 被误算成 8000 个字符。

### Green

修复：`electron/capabilityCore/mcpArgValidation.ts` 在共享字符串边界改用 `Array.from(value).length`，并用同一计数值生成错误文案；没有改变其它 schema 或 dispatch 行为。

同一命令修复后：1 test passed。扩展矩阵后同一命令：8 tests passed。

## 验证命令与结果

| 命令 | 结果 |
|---|---|
| `pnpm exec vitest run electron/capabilityCore/mcpRealUserJourneys.test.ts` | 8/8 passed |
| `pnpm exec vitest run electron/capabilityCore/mcpArgValidation.test.ts electron/capabilityCore/mcpProtocol.test.ts electron/capabilityCore/mcpRequestLifecycle.test.ts electron/capabilityCore/nomiMcpProductionRevision.test.ts electron/capabilityCore/mcpRealUserJourneys.test.ts` | 5 files, 21/21 passed |
| `pnpm run check:test-waits` | 0 私有墙钟等待；3 个既有预算断言 |
| `pnpm exec eslint electron/capabilityCore/mcpArgValidation.ts electron/capabilityCore/mcpRealUserJourneys.test.ts` | exit 0 |
| `pnpm run typecheck` | exit 0 |
| `pnpm run check:mcp-payload` | 18416 bytes ≤ 20016 ratchet |
| `pnpm run check:mcp-tool-refs` | 9/9 引用命中目录工具 |
| `pnpm run check:boundaries` | 80 处既有基线，无新增越界 |
| `pnpm run test:system:unit` | Vitest 1144 files passed / 1 skipped，10638 tests passed / 2 skipped；agent-worktree-janitor 13/13；agent-runtime 151/151 |

## 未覆盖与证据边界

本轮没有声称 100% 覆盖，也没有运行 coverage 百分比。新增 suite 未覆盖：

- Electron `startMcpStdioServer` 进程装配、stdio framing、GUI-open loopback `callViaRpc` 和打包 app。
- elicitation/create 的 accept/decline/timeout 交互、取消通知和进度通知。
- 成功的付费确认、真实 provider HTTP 请求、真实供应商凭证和 live 网络；failure cases 仅证明入口错误投影，不能替代 live certification。
- resources/prompts/artifact URI、画布写入、持久化重启恢复等其它 MCP surface。

这些路径由既有 `tests/ux/mcp-l1-handshake.e2e.mjs`、`tests/ux/mcp-l2-journeys.e2e.mjs` 及相邻 MCP 测试分别承担；本 QA 记录只报告本次 bounded diff 的实测结果。
