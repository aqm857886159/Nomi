# M5 打包真机毕业清单

日期：2026-09-03  ·  构建：`release/mac-arm64/Nomi.app`  ·  `agentHostEnabled=false`

| M0-M4 承诺 | 打包态验证方式 | 结果 |
|---|---|---|
| M0：MCP 外部连接、签名客户端身份、工具面和未知调用拒绝 | `node tests/ux/packaged-mcp-smoke.e2e.mjs release/mac-arm64/Nomi.app`；工具名从 `dist-electron` 声明派生 | PASS：23 tools；claude/codex/cursor signed；generic unsigned 写入拒绝 |
| M1：集成草稿持久化、重启后读取、凭据不落盘 | `node tests/ux/model-integration-packaged.e2e.mjs --packaged release/mac-arm64/Nomi.app` | PASS：restart readback；`createRequests=0`；`credentialBytes=0` |
| M1：Host 账本全量持久化/恢复 | 同上仅覆盖 integration draft，不启用 Agent Host | 未覆盖：`agentHostEnabled=false` |
| M2：项目→节点→生成计划→供应商假调用→产物→时间轴→导出 | 开发态与打包态运行同一 `mcp-l2-journeys.e2e.mjs`、同一 fake APIMart loopback | **PASS**：开发态 50/50；打包态 50/50（修复前 15/50，见下） |
| M3：七层上下文在真实 Host 运行 | 需要真实 Agent Host/外部 AI session 的上下文 receipt | 未覆盖：本分支保持 Host 关闭 |
| M3：技能 F-A5 三层载入：目录元数据→正文→证据 | packaged smoke 的 `resources/list` / content-addressed `resources/read`，核对 `director.cinematography` 正文 | PASS：34 resources；director body 7885 chars；unsigned 不泄露内部技能 |
| M4：签名/未签名客户端边界 | packaged smoke 同时跑 3 signed client + generic unsigned，后者调用写工具 | PASS：unsigned generic writes rejected |
| M4：污染标记驱动 spend 的危险动作拦截 | `electron/harness/context/promptPipe.test.ts` + `provenanceActionGuard.test.ts` 验证实现；打包态需 Agent Host 真旅程 | 未覆盖：最新 main 已有 structured provenance/action guard 且单测通过，但 `agentHostEnabled=false`，本次真实打包 MCP 不能到达该 Host 边界；不能把 unsigned write rejection 当成 taint spend 证据 |

## 曾经的毕业阻断项：打包态确认门（已修复）

**症状**：同一 commit，开发态 50/50 全绿，打包 app 只过 15/50，停在 `nomi_operation_gate` 返回
`human_approval_required`——外部 AI 被告知「需要人工批准」，但**没有任何确认卡弹出来**，未进入
provider、timeline 或 MP4 export。用户视角：正式安装版里这条路 100% 不通。

**根因**：`McpTransport` 把能力做成**可选成员**，而它有两个生产装配点各自手写对象字面量——
`mcpStdioServer.ts`（开发态）传了 `confirmGenerationInNomi`，`mcpNodeLauncher.ts`（打包态，
`ELECTRON_RUN_AS_NODE=1` 裸 Node）没传。漏传是**类型合法**的，tsc 与 lint 都不会响，只有打包态
自己拥有的那条运行时路径静默降级。这不是笔误而是接口形状决定的一族：同一个 launcher 的
打包/开发路径分叉在 2026-08-18 已经炸过一次（electron 值导入进裸 Node 闭包 → MODULE_NOT_FOUND），
当时立的门岗只管 import 闭包这一半。

**修复**：`mcpNodeLauncher` 经 loopback RPC 把挑战令牌转交 GUI 进程的 `nomi_confirm_generation_gate`，
由 GUI 弹真人确认卡并铸收据，与 stdio 侧同语义。同族第二处 `productionRunE2eFixture.ts`
（`isPackaged` 无条件拒绝夹具）改为三旗闸，默认对真实用户仍关闭。

**机器防线**：`scripts/check-transport-assembly.mjs`（已入 `gates:contracts`）对着接口枚举可选成员，
逐个核对每个生产装配点是否传入；新增可选成员自动纳入覆盖。变异测试双向验证：删掉回调 → 报红并
点名文件；伪造一条已接上的豁免登记 → 也报红（欠账名单不会腐烂成永久豁免）。

合同：`docs/fixes/2026-09-03-packaged-transport-callback-omitted.root-cause.json`。

**main 基线复核（已补）**：合入后在 `87bc55c9`（含 #420 的 merge commit）上重打包重跑，
打包态 **50/50**、开发态 **50/50**，parity 成立。另两条打包验证同轮通过：`packaged-mcp-smoke`
24 tools / 34 resources / unsigned generic writes rejected；`model-integration`
`createRequests=0`、`credentialBytes=0`。

复核中发现一处独立问题（不影响上述结论）：`dist:mac:dir` 缺前置 build，在干净 worktree 上直接跑
会因 `dist-electron/main.js` 不存在而失败（`app-builder-lib` 报 "was not found in this archive"），
需先 `pnpm run build`。已单列跟进。

## 执行与 CI 边界

- 开发态：`node tests/ux/mcp-l2-journeys.e2e.mjs` → `MCP-L2 PASS: 50 assertions`。
- 打包态：`pnpm run test:mcp-l2:packaged` → 修复分支上 50/50；main 基线待重跑复核。
- Mac Package CI 已保留真实通过的 packaged smoke；完整 L2 暂不接成阻断 CI，避免把真实 FAIL 伪装成绿灯。
