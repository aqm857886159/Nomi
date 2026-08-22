# 历史入口：Nomi 统一创作运行时与 AI 剪辑工作台实施方案

这份 2026-08-21 方案已被 2026-08-22 归一版取代，保留文件名只是为了让旧链接不失效。

- 当前中文架构与阶段入口：[2026-08-22-nomi-unified-editor-runtime.md](2026-08-22-nomi-unified-editor-runtime.md)
- 当前逐文件执行计划：[2026-08-22-mcp-ai-generation-vertical-slice.md](2026-08-22-mcp-ai-generation-vertical-slice.md)
- 当前 ownership ADR：[2026-08-22-runtime-ownership-adr.md](../specs/2026-08-22-runtime-ownership-adr.md)

归一版保留原方案的用户路径、剪辑区 Agent、音频、动效、J1–J11 和六角色/对抗验收，但把完整 EditorDocument/Timeline 迁移、生成 Job、MCP 和 Renderer 从同一大批次拆开：先做通用 runtime → 动态模块 → ExecutionContract → MCP 单镜生成；P3 只生成 Artifact 与 Adopt Proposal，不自动写时间轴。
