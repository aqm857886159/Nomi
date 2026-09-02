# MCP 测试网第 2 片：C7-C12

## 目标

在真实 Electron MCP stdio、真实 catalog/runtime、真实项目落盘和真实 GUI 确认边界上跑 C7-C12。测试供应商只替换 APIMart HTTP origin 为 loopback fixture；catalog 模型、mapping、加密凭据、provider、job、materializer、Run ledger 仍走生产实现。

## 范围

- 新增隔离的 APIMart HTTP fixture，覆盖 image/video create/query/result，并生成可解码 PNG、MP4、poster。
- 新增 C7-C12 journey、逐帧 JSON-RPC trace、阶段截图和 artifact index；截图只验存在与非零尺寸。
- 修复四个已知红锚：拒绝原因、gate reference projection、video artifact poster、export buildSha。
- 删除 J-MCP1 本体与其 `test:mcp` 入口；保留 `_mcpJourney.mjs` 及 production/draft consumers。

## 不动项与验收

- 不碰真实付费 seam，不打真实供应商、不把 fixture 带入 packaged/production build。
- `tools/list` 是 journey 工具目录真源；C7-C12 只调用新收敛名称。
- C1-C6、contracts、`pnpm run gates`、`pnpm run test:mcp-journey` 全绿；PR body 记录当前 main 红证、修复后绿证、trace/screenshot 路径和退役对账。

## 回滚

按 commit 逐个回滚：fixture/journey、四个根因修复、旧网退役；不改远端 main，不合并 PR。
