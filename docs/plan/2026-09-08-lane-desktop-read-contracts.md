# Lane 桌面只读适配契约修复（2026-09-08）

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

## 先查别人

| 四问 | 真实证据与结论 |
|---|---|
| 框架已有？ | 本次仍经 `electron/agentLane/laneHost.mts:1` 的既有 pi AgentHarness 公开 API。沿用[阶段 4 母方案](./2026-09-08-agent-lane-stage4-switch.md#先查别人)已查的 [pi harness 源码](https://github.com/earendil-works/pi/tree/main/packages/agent-core/src/harness)。不新增框架层或外部格式。 |
| 仓库已有？ | `electron/shared/agentCapabilities/timelineRead.ts:350` 的 alias 解析唯一负责注入 operation；`electron/capabilityCore/canvasReadTransportAdapters.ts:190` 提前格式化与 lane 所需 canonical object 冲突。`electron/shared/agentCapabilities/canvasReadCompact.ts:80` 已有唯一紧凑格式化器，沿用它，不从文本重建领域数据。 |
| 生态已有？ | 此次不引入通用能力，未新增生态查询。`electron/capabilityCore/documentReadTransportAdapters.ts:49` 与 `electron/capabilityCore/timelineTransportAdapters.ts:48` 的既有模式是权限验证后保留 canonical result，由模型出口呈现；内部接线遵循相同契约即可。 |
| TikHub 自媒体怎么说？ | 未查、不声称查过；真实红由 `tests/ux/agent-real-user-conversation.walk.mjs:95` 的 revision 检查和真实 tool-result error 证明，社媒无法裁决内部 raw/semantic/presentation 分层。 |

## 根因与范围

真实失败：`/tmp/nomi-stage4-conversation-stop-fixed.log` 与 `.tmp/pi-agent-real-user-conversation-development-1788849189243/FAIL.png` 已读。用户请求添加字幕前无法取得时间轴 revision；此前两次队列读画布也实际失败。

这属于 recurring 的适配层形状混淆：时间轴把 semantic input 当 alias raw args 再解析；画布把已经压缩的 presentation 当 canonical result 再校验。桌面只读 family glue 只交原始 alias args，权限适配器保留 canonical object，模型出口才用既有 formatter。输入 schema、Surface authority、输出安全投影均不放宽。

同类实扫：read_timeline / inspect_timeline_range 共用桌面适配；document full/selection 走既有 scope envelope；canvas live/captured 都需保留 canonical；deferred timeline preview、asset/export 都直接传原始 call，generation/production 的既有 adapter 已拥有结果投影。无第二解析器、执行路径或 fallback。

## 验收与回滚

新增 `electron/agentLane/laneDesktopReads.test.ts` 使用实际 desktop assembly + Surface registry/executor + AgentHarness HTTP loopback：五条只读入口必须 tool-result 成功，timeline 实际目标/revision、canvas 安全紧凑输出、document scope，以及五条 Surface 置换拒绝。同步现有 live/captured/B6 契约测试，保留身份隔离和敏感字段不外流的原断言。类型检查仅 --noEmit，不改 dist；独立 runner 重建验收真实字幕审批及落盘、队列 reads 成功。回滚只涉及本次适配边界与测试，不迁移任何落盘数据。

实际 desktop Harness 红：`/tmp/nomi-stage4-desktop-reads-red.log` 为 3 failed / 7 passed（timeline、range、canvas）；同一测试在修复后 10/10 通过。七文件回归 31/31，加严格 alias operation 注入反例后 timeline adapter 4/4（合计 32 条不同测试）。L1 C1 预期改为既有空画布紧凑文本，不改变任何工具执行/顺序/最终状态断言。
