# M2 slice-3：画布与文档语义工具纵切

> 状态：🚧 进行中

## 范围

- 将画布 MCP/model surface 收敛到 `canvas_read`、`canvas_plan`、`canvas_edit`、`canvas_maintenance`；将文档接入 `document_read`、`document_edit`。
- 旧画布 5 个直投 MCP 工具（read/add/connect/set-prompt/delete）同片删除；Pi 旧 alias 只在 canonical/Host 内保留到迁移完成，不产生第二个 model projection。
- 写/删统一验证 connection-bound project lease 与 `canvas:write`/`document:write` scope；session bootstrap 公开相应非付费 scope。
- kind/edge mode/参考可达性在落盘前 fail closed；写结果统一 canonical text + structuredContent；读结果 bounded、带 truncation 信号。
- 删除走 confirmation/destructive hint，回执带恢复/undo 语义；未知节点、输入校验、项目/租约失败带 errorCode 与 recoveryActions。
- 恢复 ProductionRun legacy-playbook writer retirement 的 M2 断言；`agentHostEnabled` 保持 false。

## 不动项

- 不改默认分支、agent Host 开关、测试预算与既有审计断言的强度。
- 不引入第二画布 renderer、第二文档 store、任意脚本或新的 provider/runtime。
- 不合并 PR；只推送 `m2/*` 任务分支。

## 回滚

按 commit 粒度回滚本 slice 的语义 surface、授权边界、图校验与 ProductionRun 退役实现；不回滚基线已有 slice-1/2。

## 验收门

R1–R8 红证与绿证；C-01/02/03 共享边界证据；`check:root-cause-contracts`、`check:secrets`、受影响 focused/full gates 退出码 0；`origin/main..HEAD` delta 仅含本 slice；PR 创建但不合并。
