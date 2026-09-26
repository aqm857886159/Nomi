# MCP 工具指南发布修复（2026-09-08）

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

## 先查别人

| 四问 | 现有证据与结论 |
|---|---|
| 依赖里已有？ | MCP 工具描述仍使用既有 tools/list 的 description 标准槽，协议发送在 `electron/capabilityCore/mcpProtocol.ts:358`；没有接入新框架层或增加扩展字段。标准沿用[阶段 3–5 母方案](./2026-09-07-agent-rebuild-stage3-5-deep-plan.md#先查别人)已记录的 [MCP tools 规范](https://modelcontextprotocol.io/specification/2025-06-18/server/tools)，未作新依赖选型。 |
| 仓库里已有？ | `electron/shared/agentCapabilities/modelFacingTools.ts:411` 已把共享 promptGuidelines 去重放入描述；`electron/capabilityCore/mcpCapabilityProjection.ts:339` 却重新读取短描述。抽出已有拼接给两个真实发布入口使用，不再复制字段说明。 |
| 生态里已有？ | 沿用母方案官方规范研究。本次是内部发布链的信息丢失，外部宿主原样消费 description；不新增生态查询、发布器或自定义格式。真实工具目录唯一 owner 为 `electron/capabilityCore/mcpToolCatalog.ts:369`。 |
| TikHub 自媒体里怎么说？ | 本次未查，不声称覆盖；问题可由实际 tools/list 原样返回与共享 spec 对比确定，社媒经验不能裁决 Nomi 内部字段传递。复现依据 `electron/capabilityCore/mcpTransportSchemaFromZod.test.ts:62` 和实际协议回归测试。 |

结论：复用现有共享描述派生。没有 descriptor 的显式 adapter 保留其契约描述，不虚构 spec；nomi_read 只添加其真实归并的 canvas.read 指南，并明确 target=canvas 作用域。

## 根因、范围、验收

字段说明已移到共享工具指南，但真实 resolver 未消费完整描述，属于 recurring 的跨投影信息损失。修改 shared modelFacingTools、能力 resolver、已批准的 read 聚合描述；无 schema、路由、审批、激活或预算策略改动。根因合同为 `docs/fixes/2026-09-08-mcp-guidance-publication.root-cause.json`。

实施前实际 schema/catalog 红与协议 tools/list 全表红：`/tmp/nomi-stage4-mcp-guidance-red.log`，2 failed /8 passed。验收走实际 MCP protocol，无付费调用；覆盖六个共享 profile 来源，canvas.read 在 nomi_read 中，其余原名保留；原 field label 与 Zod 同源断言不改。保留 schema 紧凑形状，不将长说明复制回字段。类型只 --noEmit，禁止改 dist；回滚本次描述派生与相应测试变更即可，不涉及持久化数据。
