# Project Agent Host 升级说明

新版 Project Agent 使用新的常驻 Host 状态，不会把旧 Agent 会话或模型上下文恢复成可继续执行的会话。

升级时，Nomi 会先把旧聊天、旧 Agent context 和旧提案 receipt 按原始字节归档到：

```text
<项目>/.nomi/project-agent-legacy-archive-v1/
```

归档只用于只读核对或手动导出。旧的待批准操作、执行状态不明的操作和未完成 Agent turn 不会自动恢复、批准、重放或重试；需要继续的工作请在新版中重新提交。

以下作品数据不会由这次切换迁移或删除：

- 项目文档与画布状态
- 素材和已经生成的结果
- 导出文件
- ProductionRun 与付费任务记录

首次切换成功后，只有新 Host 可以写 Agent 状态。旧会话文件会在归档校验通过后从活跃位置移除，避免新旧系统双写或旧任务误恢复。

新 Host 产生数据后，不保证直接降级到旧版本仍能继续 Agent 会话。需要回到旧版本前，请先备份项目并导出需要保留的 Agent 记录；作品数据和付费任务仍应以项目存储与 ProductionRun 记录为准。
