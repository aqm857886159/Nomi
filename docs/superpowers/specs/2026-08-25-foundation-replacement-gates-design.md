# 基础设施替换闸门设计

日期：2026-08-25
状态：待评审设计；本文件不代表已经替换生产实现。

## 目标

让 Nomi 可以逐步替换通用基础设施，同时保证 Nomi 自己的节点语义、媒体模型、Agent 控制、额度确认、ProductionRun、快照和导出合同不被第三方框架接管。

核心原则是：**第三方库负责通用机械动作，Nomi adapter 负责语义转换；所有切换先经过等价性闸门，再允许进入主线。**

## 不变的核心合同

以下合同属于 Nomi 产品，不允许因为替换基础设施而改形：

- `GenerationCanvasNode`、edge、group、derived relation、generation state。
- 画布项目快照、撤销/恢复和 Agent 写入。
- Timeline clip、text clip、playhead、fps、撤销/恢复和 export planner 输入。
- MCP 的工具结果、elicitation、spend confirmation、widget/resource 映射和 headless 策略。
- ProductionRun revision、outbox、幂等、预算 ledger、artifact 和事件 replay。
- ffmpeg export manifest、取消、进度、原子输出和本地媒体 URL。

## 目标分层

```text
Nomi domain contracts
  ├─ canvas semantic adapter ── viewport / gesture / scene runtime
  ├─ timeline semantic adapter ── playback clock / timeline editor
  ├─ MCP capability adapter ── official protocol transport
  ├─ IPC contract adapter ── Electron invoke/send
  └─ media/3D adapters ── existing renderer and local protocol
```

第三方依赖只能进入最右侧的基础层或 adapter。业务 store、Agent、ProductionRun 和持久化代码不得直接 import 第三方 runtime 类型。

## 替换策略

### A. 适配器优先

先定义与库无关的输入输出：pointer intent、viewport transform、timeline edit command、MCP request/response、IPC request/result。旧实现先实现 adapter，新实现再实现同一 adapter。这样可以比较行为，而不是比较两个互相不同的 API。

### B. 双跑只用于验证，不长期并行

在纯函数、协议帧和只读渲染计算上可以 shadow run：旧实现产生用户可见结果，新实现只记录差异。涉及写入、额度、文件、网络、Agent 操作时禁止双写；改用 fixture replay 或 recorded input。

### C. 切换开关必须是开发/测试开关

每个 spike 允许有明确的环境变量或测试注入点，但不能把永久 fallback 留在生产路径。通过闸门后同一提交删除旧分支或收敛为 adapter，遵守 P1。

## 每个模块的验收闸门

| 闸门 | 必须证明的事情 | 失败处理 |
|---|---|---|
| Contract | 新旧输入输出、ID、错误和取消语义一致 | 不进入下一阶段 |
| Snapshot | 旧快照读取、编辑、保存、再读取一致 | 保留旧实现，修 adapter |
| Interaction | 真实 pointer/keyboard/blur/cancel 序列一致 | 只修边界，不扩大迁移 |
| Performance | 帧间隔、长任务、内存/GPU、渲染次数达到目标 | 回到状态隔离或缓存优化 |
| Recovery | 中断、重连、重复提交、context loss、半写入可恢复 | 禁止上线 |
| Product journey | 真实任务从入口到结果闭环 | 以用户任务失败点为准修复 |
| Rollback | 不转换数据即可退回旧 adapter | 不允许切换 |

## 关键决策

本设计不预设“必须采用哪个成熟框架”。真正要决定的是：

> 新框架是否能在不改变 Nomi 语义和快照的情况下，减少高频交互内核的自研面积，并且在异常输入和真实用户任务上更稳。

如果答案只是 demo 更顺滑，或者需要把 Nomi 业务模型改成框架模型，则不替换。

## 评审问题

在开始写生产迁移代码前，必须回答：

1. 画布和时间轴的“瞬时状态”和“持久化状态”是否已经分开？
2. 第三方依赖是否只出现在 adapter 层？
3. 旧快照、Agent 写入、撤销/恢复和导出是否能通过同一组 fixture 重放？
4. 每个替换候选是否有正常、边界、失败、恢复四类测试？
5. 每个真实任务是否有可观察的成功条件，而不是只判断页面存在？
6. 回滚是否不需要数据迁移？
