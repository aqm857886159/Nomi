# B6 MCP 协议真机证据

`before.png` 与 `after.png` 是同一 macOS Terminal 窗口显示真实、隔离 Electron MCP stdio 响应的截图。不是 Claude Code / WorkBuddy 客户端 UI 截图，也不是模拟页面。

复跑：完成 `pnpm run build` 后，`node docs/evidence/b6-mcp-parity/inspect.mjs AFTER`。脚本只创建临时资料库，使用测试身份；不读真实项目，不输出凭据。改前基线为本任务最初的 dist-electron 构建。

重点：工具人类标题、完整 timeline operation 字段、技能 prompt 标准 arguments / _meta 字段。Claude / WorkBuddy 的两种身份由真实 stdio L1 / skills integration 和 packaged MCP smoke 分别覆盖。
