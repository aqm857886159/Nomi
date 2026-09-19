# B6 generation draft schema parity addendum

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

状态：已实现，构建 / MCP schema / 打包验证已通过，gates 执行中 · 2026-09-10

## 先查别人
- `electron/shared/agentCapabilities/generationPlanSchemas.ts:58` owns prompt-only shot fields and typed candidate/references/patch. Both profiles must publish them.
- `electron/shared/agentCapabilities/extendedModelTools.ts:54` projects this owner into laneToolCatalog; its operation envelope differs from the external create/patch routing, but the semantic fields do not.
- `electron/capabilityCore/mcpTransportSchemaFromZod.ts:181` already derives transport schemas; reuse its standard subset projection, delete the manual field table.
- https://modelcontextprotocol.io/specification/2025-11-25/server/tools : object JSON Schema is the tool wire contract. Recursive JSON parameters retain their published local references; the final envelope is assembled in Zod before a single toPublishedJsonSchema conversion, and Ajv executes that same schema.

## Scope and verification
Generation projection and its parity tests share the parent B6 JSON Schema execution boundary migration. Preserve external lease/operation addressing, vendor/modelKey aliases and all paid execution handlers. Validate prompt-only shots, typed candidate/reference/patch rejection and arbitrary nested JSON preservation. Red run: 3 failed in /tmp/b6-generation-red.log before production edits. Parent B6 root-cause contract covers this same projection failure class; final gates/build remain parent-owned.

## Review
CTO: same schema owner, no new validator. Backend: no paid gate changes. PM: valid lane draft becomes expressible externally. Frontend/design: no new UI. User: construct complete candidate or simple prompt shots from published fields. Rollback: revert scoped commit; no persisted data changes.

## 运行边界与收据
`generationTransportAdapters.ts` 将 lane create 转到同一 `nomi_operation_create` owner；`mcpGenerationMultiShot.ts:draftShotFromPlan` 当前对无 candidate 的 shot 在两边同样拒绝。本次修复 schema 可见性/类型/拒绝对等，不宣称 prompt-only shots 已真实生成成功，不改共享候选默认值或任何 provider/gate handler。新增测试跑真实 lane adapter 和外部 build 到该 owner，证明相同拒绝。局部先红3条，后绿日志 `/tmp/b6-generation-green.log`。
