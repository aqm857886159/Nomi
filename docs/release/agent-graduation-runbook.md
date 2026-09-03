# Agent 发版前毕业检查单

以下检查需要真实宿主或真实额度，不进 CI；每项都必须保留对应 MCP trace、Run ledger 和供应商账单/响应证据。

1. **真实 Claude Code MCP 连接**
   - 成本：现有 Claude 账号/套餐与其模型额度；不使用 Nomi 的零额度 fixture。
   - 判据：签名握手、项目选择、技能三层按需读取、真人确认卡完成；断开后无孤儿 Run，重连能读回同一 project/lease/receipt。
2. **真实 Codex MCP 连接**
   - 成本：现有 Codex 账号/套餐与其模型额度；不使用 Nomi 的零额度 fixture。
   - 判据：与 Claude 相同，并额外核对 origin、client proof、project lease、receipt 全部来自同一客户端，未签名客户端不能写入或触发 effect。
3. **真实付费生成与导出**
   - 成本：所选供应商显示的实际单价 × 镜头数，以供应商最终账单/扣费记录为准；执行前人工批准预算。
   - 判据：冻结合同、预算上限、receipt、供应商 task、到账 artifact、timeline 与导出 MP4 一一对应；失败、重启、重试均不重复扣费或重复提交。

## 进入条件

- 先通过 `pnpm run dist:mac:dir` 的 packaged smoke 和 `node tests/ux/model-integration-packaged.e2e.mjs --packaged release/mac-arm64/Nomi.app`。
- `pnpm run test:mcp-l2:packaged` 须为 50/50。generation confirmation parity 的 FAIL 已于 2026-09-03 修复
  （根因见 `docs/fixes/2026-09-03-packaged-transport-callback-omitted.root-cause.json`，机器防线
  `scripts/check-transport-assembly.mjs`），并已在 main 基线 `87bc55c9` 上复核：打包态与开发态均 50/50。
  **每次发版仍要在待发的那个基线上重跑**——这一条不许引用历史结果打勾（P3：全绿 ≠ 完成）。
- 跑打包前先 `pnpm run build`：`dist:mac:dir` 目前不含前置 build，干净 worktree 上直接跑会因
  `dist-electron/main.js` 缺失而失败。
- 真实 Host 与付费检查只能在维护者明确批准账号/额度后执行；CI 保持 `agentHostEnabled=false`、零额度。
