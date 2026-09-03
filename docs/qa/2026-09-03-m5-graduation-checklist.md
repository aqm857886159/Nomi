# M5 打包真机毕业清单

日期：2026-09-03  ·  构建：`release/mac-arm64/Nomi.app`  ·  `agentHostEnabled=false`

| M0-M4 承诺 | 打包态验证方式 | 结果 |
|---|---|---|
| M0：MCP 外部连接、签名客户端身份、工具面和未知调用拒绝 | `node tests/ux/packaged-mcp-smoke.e2e.mjs release/mac-arm64/Nomi.app`；工具名从 `dist-electron` 声明派生 | PASS：23 tools；claude/codex/cursor signed；generic unsigned 写入拒绝 |
| M1：集成草稿持久化、重启后读取、凭据不落盘 | `node tests/ux/model-integration-packaged.e2e.mjs --packaged release/mac-arm64/Nomi.app` | PASS：restart readback；`createRequests=0`；`credentialBytes=0` |
| M1：Host 账本全量持久化/恢复 | 同上仅覆盖 integration draft，不启用 Agent Host | 未覆盖：`agentHostEnabled=false` |
| M2：项目→节点→生成计划→供应商假调用→产物→时间轴→导出 | 开发态与打包态运行同一 `mcp-l2-journeys.e2e.mjs`、同一 fake APIMart loopback | 开发态 PASS 43/43；打包态 FAIL 15/43，停在 generation confirmation |
| M3：七层上下文在真实 Host 运行 | 需要真实 Agent Host/外部 AI session 的上下文 receipt | 未覆盖：本分支保持 Host 关闭 |
| M3：技能 F-A5 三层载入：目录元数据→正文→证据 | packaged smoke 的 `resources/list` / content-addressed `resources/read`，核对 `director.cinematography` 正文 | PASS：34 resources；director body 7885 chars；unsigned 不泄露内部技能 |
| M4：签名/未签名客户端边界 | packaged smoke 同时跑 3 signed client + generic unsigned，后者调用写工具 | PASS：unsigned generic writes rejected |
| M4：污染标记驱动 spend 的危险动作拦截 | `electron/harness/context/promptPipe.test.ts` + `provenanceActionGuard.test.ts` 验证实现；打包态需 Agent Host 真旅程 | 未覆盖：最新 main 已有 structured provenance/action guard 且单测通过，但 `agentHostEnabled=false`，本次真实打包 MCP 不能到达该 Host 边界；不能把 unsigned write rejection 当成 taint spend 证据 |

## 开发态与打包态差异

开发态在 `nomi_operation_gate` 请求后弹出 Nomi 确认卡并完成 43/43；同一 commit 生成的打包 app 在前 15 条通过后返回 `human_approval_required`，没有完成确认卡，未进入 provider、timeline 或 MP4 export。这是打包毕业阻断项，不能通过放宽断言或 `continue-on-error` 处理。

## 执行与 CI 边界

- 开发态：`node tests/ux/mcp-l2-journeys.e2e.mjs` → `MCP-L2 PASS: 43 assertions`。
- 打包态：`pnpm run test:mcp-l2:packaged` → 当前保持红，直到确认桥 parity 修复并重新验证。
- Mac Package CI 已保留真实通过的 packaged smoke；完整 L2 暂不接成阻断 CI，避免把真实 FAIL 伪装成绿灯。
