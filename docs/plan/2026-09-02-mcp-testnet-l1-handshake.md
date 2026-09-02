# MCP 测试网第 1 片：L1 协议握手层

日期：2026-09-02 · 分支：`mcp-testnet/l1-handshake-20260902`
状态：🚧 进行中

## 范围

- 复用 `tests/ux/_mcpJourney.mjs` 的真实 Electron + `NOMI_MCP_STDIO=1` 启动和 newline JSON-RPC framing。
- 新增零额度 L1 journey：C1 版本协商、C2 42 工具目录和 payload 棘轮、C3 协议/工具错误边界、C4 取消绑定、C5 framing 超长行/解析错误、C6 tools/list_changed。
- A1 在 MCP initialize 声明 `tools.listChanged`，并将 playbook / MCP capability adapter 注册变更接入通知总线。
- 新增 `check:mcp-payload` 并接入 contracts/gates；按现有 quality-gate 分类器把 MCP 源码和 L1 测试归入 journeys 风险面。

## 不动项

- 当前 42 工具目录不收敛、不重命名、不做第二套工具面。
- 不引入 MCP SDK，不做窗口布局断言，不调用真实供应商或额度。
- 不合并 PR、不触碰 `main` 或其它分支。

## 验收与回滚

- 每条 C 先用底座 `349529e6` 留红/绿证，再在同一真实 stdio 入口回归；C6 记录 A1 前空 capabilities/无发射点的红证和 A1 后通知绿证。
- `check:mcp-payload` 基线为 22,941 bytes，只允许下降；先用临时放大 payload 验证门岗红，再恢复。
- 最终 `pnpm run gates` 真退出码为 0，Vitest 失败集合相对 `origin/main` 不增加；回滚本片 commits 即移除 L1 lane、棘轮与 A1 通知。
