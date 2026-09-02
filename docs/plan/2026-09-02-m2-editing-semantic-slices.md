# M2 slice-2：剪辑语义纵切

状态：🚧 进行中

## 目标

把已有 timeline/asset/export capability 的分散 Pi 别名收口到四个语义意图：
`timeline_read`、`timeline_edit`（preview/apply/undo）、`export_job`、`media_query`。
只读查询从同一份 capability contract 投影到 MCP；编辑在 MCP 侧只进入 Host 审批/回执边界；导出启动和取消继续 host-only，MCP 只读状态/验证。

## 切片与验收

* A：manifest + `nomi_timeline_read` MCP tools/list 与 lease/renderer 路由；先以 E-01/R1 红灯证明缺失，再绿。
* B：`nomi_timeline_edit` preview/apply/undo；apply/undo 需要 Host 审批，使用既有 timeline undo 账本和 revision CAS。
* C：`nomi_export_job`（status/verify）+ `nomi_media_query`，删除 E-16 死 UI/幽灵 node-test，J-MCP1 的 f/g/h 改用当前 semantic generation 面。

## 不动项

`agentHostEnabled` 保持 false；不改预算、既有断言门、provider adapter；旧 Pi 别名只保留在内部兼容适配器，不能继续出现在 model surface；不合并 PR。

## 回滚

按切片回退对应 commit；共享 contract/adapter 与旧入口同 commit 保留可审阅的内部映射，不做运行时双实现。

## 验收门

红灯测试 → focused unit/contracts → `check:root-cause-contracts`、`check:secrets`、typecheck/build 及受影响 system gate；MCP `tools/list` 必须列出四个语义工具，导出工具的付费转移不得出现在模型可执行写操作中。
