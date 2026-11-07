# 模型清单按原始可用性转述

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

类别：其他，外部 AI 结果文字修复；标准设计卡，不走短档。面板拆分暂缓，规范对照保留在 `docs/engineering/direction-checks/2026-11-05-mcp-run-read.md`。

## ★1 用户怎么用

当外部 AI 为创作者选择生成模型时，连接 → 读取模型清单 → 检查可用分组与原因 → 查询一个模型的详情 → 选择确实可用的模型。真实任务：有凭据但执行器不可用时不推荐该模型；混合清单只推荐可用行；没有可用模型时区分检查接入与配置凭据。真实外部 AI 未验证，不触碰真实资料或付费。

指标与量具：`electron/capabilityCore/mcpToolResults.test.ts` 的中英矩阵要求计数、分组、逐行标记和下一步与 `usable === true` 一致率 100%，反例是凭据正常却 `usable:false` 或缺失。原行为把 3 行计为可用，正确值为 1。空清单、缺凭据与已有参考能力说明沿用同组回归。真实模型选型数字缺量具，协调可在发版前用真实外部 AI 调一次模型清单核对。

★1b：只改 MCP 清单的中英文转述、计数与下一步；面板、通知、任务列表不涉及。★1c：不改持久化数据、模型设置、工具名称或参数；现有宿主下一次读取就收到准确结果，无权限迁移。

## ★2 谁说了算

`electron/capabilityCore/modelSpecRead.ts:24` 的 `listModelSpecRows` 从目录取得可用性；`electron/shared/agentCapabilities/modelSpecProjection.ts:25` 定义 `usable` 与原因。`mcpToolResults.ts` 只消费这份事实，不从 keyStatus 重算。`door-map buildToolOutcome` 找到唯一直接调用者 `mcpResultPayload.ts`，再上一跳是所有传输共用的 `mcpProtocol.ts`。

## ★3 一致与复用

依据 #1388 的可用性思路修复，感谢贡献者；不引入它的其它改动。沿原方向补更多凭据状态仍会重复可用性算法；选择删除 keyStatus 推断，直接用已存在的 usable。keyStatus 仅用于解释缺凭据和下一步，不再决定能否被推荐。实现时发现原结果文件格式化代码 1084 行超过冻结上限 1074；采用原任务允许的独立 `mcpToolResultsModelList.ts`，整体移动已有模型清单投影及其专用标签辅助逻辑，同提交删旧，不改门岗上限或压行。已有调用与测试继续经 buildToolOutcome 到同一个投影。依赖和工具面不变。

## ★4 全状态

空清单保持原提示；有可用模型只推荐 usable=true 行；凭据正常但不可用显示不可用并保留原因，提示查询模型详情；缺凭据或无法解锁时保持对应原因与配置提示；缺 usable 保守归为不可用。加载、取消中、过期、写失败不属于同步只读结果投影，无新增状态或执行行为。双语保持同一逻辑。

## ★9 验收与回滚

保留先红后绿输出；同一矩阵检查 false、缺失、true、全不可用与缺凭据，中英分别执行，并检查原始行透传。跑 capabilityCore 目录定向 vitest、工具面/引用/payload/冻结检查、根因合同及概念登记、build 和推送快检；不跑全量 gates。真实外部 AI 流程未验证必须明示，不以 fixture 证明真实选型成功。回滚模型投影修复提交即可；不需存量迁移。四类独立验收不适用（不新增界面、花钱或长跑能力）。
