// MCP stdio 传输写给**宿主**的诊断事件名。两条启动路共用一份：Electron 内的 stdio server
// （走 logging/logger）与打包态的裸 Node launcher（够不着 logger，因为它要 electron 的
// app.getPath，所以直写 stderr）。
//
// 为什么要有这个文件：这些行不是「开发时的终端输出」，而是**宿主协议面**的一部分——
// stdout 整条让给了 JSON-RPC，宿主（Claude Code / Codex）唯一能看见我们诊断的地方就是 stderr，
// 它按行读、写进自己的 MCP 日志。既然是协议面，同一件事就只能有一个名字：两边各写一句散文的
// 结局是改了一边、另一边静默漂移，而回归测试手抄的又是第三份（2026-09-06 日志收口那次，
// 两条 E2E 断言同时假红/假绿，根因就是这三份名字各走各的）。
//
// 这里刻意只放**名字**，不放格式化：两条路的行首前缀本就不同（logger 是 `[nomi:mcp]`，
// 裸 Node 是 `[nomi-mcp]`），强行统一前缀等于让 logger 为一个调用点破例。
export const MCP_OVERSIZED_LINE_EVENT = 'dropped-oversized-stdin-line'
export const MCP_CANCELLED_IN_FLIGHT_EVENT = 'cancelled-in-flight-on-disconnect'
