# External Agent Runtime MCP Control Plane（历史草案，已归一）

> 状态：`superseded`。本文件不再是执行计划，也不定义独立的
> `ExternalAgentSession`、`NomiOperation`、`NomiEvent` 持久化 owner。

Codex/Pi 的源码研究和可吸收边界见：

- `docs/audit/2026-08-22-agent-runtime-source-review.md`
- `docs/superpowers/plans/2026-08-22-nomi-unified-editor-runtime.md` 的 External E0/E1
- `docs/superpowers/plans/2026-08-22-mcp-ai-generation-vertical-slice.md` 的 External E0/E1

唯一执行真相仍是 `ProductionRun`、Run intent/WAL、`RuntimeEnvelope`、
`submissionOutbox`、Artifact/materialization receipt 和 per-run lock/CAS。
E0 只提供零额度的 session/context/draft/preview/read/events 投影；E1 必须在
P3 checkpoint 通过后，且只能 alias 到已有 typed Nomi tools。任何旧版
`operation/start`、多 Run operation、独立 EventStore、Timeline Apply 或直接
provider 调用均不在当前范围内。

如需恢复旧草案中的任意能力，必须先更新 canonical ADR、补六角色/对抗证据，
再另开有明确 owner、schema、迁移和回滚的计划。
