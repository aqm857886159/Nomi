# M5 打包真机毕业清单

日期：2026-09-03  ·  构建：`release/mac-arm64/Nomi.app`  ·  `agentHostEnabled=false`

| M0-M4 承诺 | 打包态验证方式 | 结果 |
|---|---|---|
| M0：MCP 外部连接、签名客户端身份、工具面和未知调用拒绝 | `node tests/ux/packaged-mcp-smoke.e2e.mjs release/mac-arm64/Nomi.app`；工具名从 `dist-electron` 声明派生 | PASS：23 tools；claude/codex/cursor signed；generic unsigned 写入拒绝 |
| M1：集成草稿持久化、重启后读取、凭据不落盘 | `node tests/ux/model-integration-packaged.e2e.mjs --packaged release/mac-arm64/Nomi.app` | PASS：restart readback；`createRequests=0`；`credentialBytes=0` |
| M1：Host 账本全量持久化/恢复 | 同上仅覆盖 integration draft，不启用 Agent Host | 未覆盖：`agentHostEnabled=false` |
| M2：项目→节点→生成计划→供应商假调用→产物→时间轴→导出 | 开发态与打包态运行同一 `mcp-l2-journeys.e2e.mjs`、同一 fake APIMart loopback | **当前 main 未复核**（详见下节）：曾在 `87bc55c9` 上测得开发态与打包态各 50/50，但那是 #429/#436 之前的基线 |
| M3：七层上下文在真实 Host 运行 | 需要真实 Agent Host/外部 AI session 的上下文 receipt | 未覆盖：本分支保持 Host 关闭 |
| M3：技能 F-A5 三层载入：目录元数据→正文→证据 | packaged smoke 的 `resources/list` / content-addressed `resources/read`，核对 `director.cinematography` 正文 | PASS：34 resources；director body 7885 chars；unsigned 不泄露内部技能 |
| M4：签名/未签名客户端边界 | packaged smoke 同时跑 3 signed client + generic unsigned，后者调用写工具 | PASS：unsigned generic writes rejected |
| M4：污染标记驱动 spend 的危险动作拦截 | `electron/harness/context/promptPipe.test.ts` + `provenanceActionGuard.test.ts` 验证实现；打包态需 Agent Host 真旅程 | 未覆盖：最新 main 已有 structured provenance/action guard 且单测通过，但 `agentHostEnabled=false`，本次真实打包 MCP 不能到达该 Host 边界；不能把 unsigned write rejection 当成 taint spend 证据 |

## 开发态与打包态差异

### 曾经的阻断项：打包态确认门（已修）

打包 app 在前 15 条通过后返回 `human_approval_required`，没有确认卡弹出，未进入 provider、timeline 或 export。根因：`McpTransport` 把能力做成**可选成员**，两个生产装配点各自手写对象字面量，打包态那个漏传 `confirmGenerationInNomi`——漏传是合法 TypeScript，编译期无信号。已修（PR #420），机器防线 `scripts/check-transport-assembly.mjs`，合同
`docs/fixes/2026-09-03-packaged-transport-callback-omitted.root-cause.json`。

### ⚠️ 当前 main 的毕业状态：**未复核，不得宣称已毕业**

修复后曾在基线 `87bc55c9` 上重打包重跑，测得打包态与开发态各 50/50、parity 成立。**但那个数字对当前 main 已不作数**：其后 main 又合入了 #429（一次误判：删掉签发点的 `clientAttestation` 旗，使客户端裸同意可达，净效果是用户点完同意后生成直接报 `human_approval_required`，比不改更糟）与 #436（回滚），以及数十个其它 commit。

2026-09-03 外部评审（Codex，见 `docs/audit/2026-09-03-codex-agent-host-review.md`）据此判定：接受「87bc 上曾有 50/50 复核」，**不接受「当前 main 已有可复核的毕业证据」**。本文件据此更正——此前分支 `m5/packaged-graduation-c-20260903` 上那版把结论写成「已复核 50/50」，同样过期。

**发版前必须在待发基线上重跑**，不许引用本节任何历史数字打勾（P3：全绿 ≠ 完成）。

### 另一项未解决的阻断项：客户端确认链

设计是三层（客户端能问→弹在调用方；问不了+应用开着→应用内兜底卡；都不行→如实拒绝）。第一层在生产**整条不可达**：两个签发点要求一种没有任何实现能提供的凭证，同时验证该凭证的 `verifyClientGenerationConfirmation` 在两个生产装配点都没接。净效果：每次花钱确认都被赶回应用，应用没开就直接拒绝——哪怕用户已在客户端点过同意。

外部评审判为 **P0，未解决前不能发布**。正在补铸收据那一环（见
`docs/fixes/2026-09-03-client-confirm-needs-a-real-receipt.root-cause.json`）。

## 执行与 CI 边界

- 开发态：`node tests/ux/mcp-l2-journeys.e2e.mjs` → `MCP-L2 PASS: 50 assertions`。
- 打包态：`pnpm run test:mcp-l2:packaged` → 待在发版基线上重跑；历史数字见上节，不作为毕业依据。
- Mac Package CI 已保留真实通过的 packaged smoke；完整 L2 暂不接成阻断 CI，避免把真实 FAIL 伪装成绿灯。
