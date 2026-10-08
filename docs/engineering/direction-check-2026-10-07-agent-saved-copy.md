# 方向检查：重复状态与 transport 文案

## 0. 一句话根因

同一事实没有按“持久状态负责终态、共享投影负责进行中”的边界分层，导致每次修复都在展示层补一个例外。

## 1. 归类表

| bug | 直接原因 | 类根因 |
|---|---|---|
| 完成节点重复显示“已保存到项目” | generationFeedback 从 completedAt 合成成功回执 | 终态与进行态没有单一展示契约 |
| Agent 显示“运行命令” | bash 工具名直接映射到用户文案 | transport 名称未在共享投影边界隔离 |

## 2. 为什么反复出现

画布、时间线、任务中心和 Agent 面板各有消费者；缺少共享边界时，修复会在一个消费者上累积。此次把规则收回 generationFeedback 与 readableToolName 两个共享投影，后续入口不能自行生成这两类文案。

## 3. 不改结构会再出现什么

| 预测 | 验证 |
|---|---|
| 新节点变体会再次挂成功回执 | generationFeedback class test + Node/Lightweight tests |
| 新 transport alias 会露出实现名 | residentToolDisplay registry/name test |

## 4. 独立性

特征测试由实现线维护；本次未声称独立验收完成，PR 正文标为待安排。

## 5. P0

这是产品领域独有的创作状态叙事；没有第三方库可替代该语义边界。

## 6. 选项

| 选项 | 代价 | 推荐 |
|---|---|---|
| 在每个消费者补条件 | 继续产生漂移 | 否 |
| 在共享投影删除终态回执并隔离 transport | 一次性改动共享边界 | 是 |

## 7. 用户权衡

创作者需要知道“现在是否还能继续操作”，而不是重复确认已经完成或看到 Agent 的内部执行方式；保留任务历史完成行，删除画布上的重复回执。

## 特征测试清单

- generationFeedback completed node returns null
- NodeGenerationStatus and LightweightGenerationNode do not render saved receipt
- bash resolves to toolGeneric
- pageProbe no longer tracks saved receipt ledger
