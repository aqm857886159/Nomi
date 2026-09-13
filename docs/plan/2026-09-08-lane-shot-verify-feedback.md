# Lane 审片偏差反馈接回（2026-09-08）

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

## 先查别人

本节补记实施前已读的内部 owner 与母方案参考，行号按当前工作树复核；不把补记时间冒充检索发生时间。本次恢复原审片偏差卡及其发送入口，没有新增通用能力、模型调用实现或另一份偏差状态。

| 四问 | 证据与适用结论 |
|---|---|
| 依赖里已有？ | pi 的 `before_tool` 和 `watch` 分别见锁定依赖 `node_modules/@earendil-works/pi-agent-core/dist/harness/agent-harness.d.ts:550`、`:674`，审批与运行状态继续沿现役 lane；本次不重造运行时。发送 ACK 的现有客户端入口是 `src/workbench/ai/v4/useAgentPanelV4Actions.ts:124`，它只证明接收成功，不代表生成成功。 |
| 仓库里已有？ | `docs/plan/2026-09-06-agent-panel-v4-wiring.md:152` 已批准 `deviation → ReconcileDeviationCard`；完整原卡在 `src/workbench/generationCanvas/components/ReconcileDeviationCard.tsx:161`。原 `shotVerifyStore` 的 `consumeRound`/`markFixing` 在 `src/workbench/generationCanvas/agent/shotVerifyStore.ts:138`、`:147`，修复消息在 `:198`；均直接复用。 |
| 生态里已有？ | 沿用[阶段 3–5 母方案“先查别人”](./2026-09-07-agent-rebuild-stage3-5-deep-plan.md#先查别人)和[阶段 4 的官方 pi 参考裁决](./2026-09-08-agent-lane-stage4-switch.md#先查别人)，官方出处为 [pi harness](https://github.com/earendil-works/pi/tree/main/packages/agent-core/src/harness)。本次未重新查询生态或选型；项目/requestId、偏差和两轮修复预算属于 Nomi 现有领域状态，不引入外部 Agent/UI 实现。 |
| TikHub 自媒体里怎么说？ | 本补线未查询，不声称覆盖。真实摩擦已由零额度 production 走查给出：判官有 `F_VERIFY_LOW` 而面板无消费者；可复核用户形态是已批准映射 `docs/plan/2026-09-06-agent-panel-v4-wiring.md:152` 与原卡，不需要社媒意见来改变它。 |

**结论：用已有。** 订阅原 store，在原面板流末尾显示原卡；修复通过现有发送入口，只有当前 admission 成功才消耗原预算。适用边界是内部 UI 消费边恢复，不作新框架或通用能力决策；生态/TikHub 未作新增查询的理由如上，不申请门岗格式豁免。

真实 production 走查的判官已返回 `F_VERIFY_LOW`，但生成面板无卡。09-06 接线方案 §2.5 已批准 `deviation → ReconcileDeviationCard`；沿用原卡，不改设计实验室基线。

原 owner：`shotVerifyStore.ts` 管项目/requestId、偏差与默认两轮预算；`ReconcileDeviationCard.tsx` 管原卡；`buildContentFixMessage` 管修复消息；lane `actions.send` 管发送与审批入口。缺失的是原 store 到面板的消费边。

新增薄反馈 hook，订阅原 store 和当前项目，只在 generation 面返回原卡。Panel 加 `flowTail` 放在现有对话流尾部，纳入原跟随滚动逻辑。修复按钮经 `actions.send`；只有 admission ACK 成功且项目/requestId/偏差仍当前才消耗轮次并暂藏卡。失败保留卡，跨项目迟到不改新状态，重复点击只发一次。费用仍过原确认闸。

同时去掉 Shell submit 的提前清草稿：输入和附件仍由 send 在 ACK 后清理。send 明确返回接受成功与否，失败和上传中返回 false。此布尔值不代表模型回合或生成成功。

验收：原卡在真实 Panel 渲染；修复拒收/异常不扣轮次不清卡；默认最多两轮；同一请求重复点击只发送一次；切项目/新审片晚回执不污染；发送失败草稿保留，成功只清本次未变的草稿。真实 Electron 像素和按钮由 runner 复跑。回滚随阶段 4 commit revert；不改任何 Host/Workspace、判官或 store，也不放宽 missing-skill 检查。
