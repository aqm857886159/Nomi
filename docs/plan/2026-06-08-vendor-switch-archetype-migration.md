# 断开供应商后老节点自动迁移到已连接供应商的同款模型

> 触发 bug：用户断开 KIE、连上 apimart，运行任务报 `API key missing: kie`。
> 用户拍板（2026-06-08）：老节点**自动迁到 apimart 的同款模型**（按模型原型 archetype 映射）。

## 根因（已核实，带 file:line）

把「供应商是内置项（`enabled`）」与「供应商现在能用（有 API key）」**混为一谈**，且节点把供应商钉死、运行时从不重解析：

1. `clearModelCatalogVendorApiKey` 只 `delete apiKeysByVendor[key]`，**不动 `vendor.enabled`**（`electron/runtime.ts:1078`）。
2. 「能不能用」全系统看 `enabled` 而非「有没有 key」：
   - 下拉过滤 `getEnabledVendorKeys` 只看 `v.enabled`（`src/config/useModelOptions.ts:73`）→ 断开后 kie 模型仍在下拉。
   - 运行时 `findExecutableModel` 先过 `vendor.enabled`（通过）再查 key（没了）→ 抛 `API key missing: kie`（`electron/runtime.ts:1757`）。
3. 节点 `meta.modelVendor` 存了 `'kie'`；运行链路咽喉 `resolveExecutableNodeFromCatalog` 有 `if (vendor || !modelKey) return node`（`src/workbench/generationCanvas/runner/catalogTaskActions.ts:109`）—— 有供应商就完全信任，绝不重解析。

跨供应商「同款模型」的唯一真相源：每个 catalog 模型 seed 时写入的 `model.meta.archetypeId`（`electron/catalog/seedBuiltins.ts:129,141`）。kie 的 `seedream` 与 apimart 的 `doubao-seedream-4.5` 都是 `archetypeId === "seedream"`。**例外**：Seedance kie=`seedance-2` / apimart=`seedance-2-apimart`（id 不同、`family` 都是 `"seedance"`）。

## 方案

新增「可用供应商」概念 + 在唯一运行咽喉按 archetype 重解析 stale 供应商。分两阶段，各自可独立验证。

### Stage 1（核心，直接修掉报错的 bug）

新文件 `src/workbench/generationCanvas/runner/usableVendorModel.ts`：
- `vendorIsUsable(v)` = `enabled && (authType==='none' || hasApiKey)`
- `loadUsableVendorKeys(listVendors?)` → `Set<vendorKey>`
- `resolveUsableModelForNode({ modelKey, modelAlias, vendor, meta, kind, models, usable })` → 命中的 catalog 行或 `null`，解析顺序：
  1. **精确 modelKey**：usable 供应商里有同 modelKey → 用（保留原「空供应商按 modelKey 解析」行为 + flat 模型）
  2. **按 archetypeId**：usable 供应商里 `resolveArchetypeForModel(dto).id === sourceArchetype.id`
  3. **按 family 兜底**：同 `family`（覆盖 Seedance kie↔apimart）
- 同 archetype 跨供应商：node 的 `meta.archetype` 不变；跨 archetype（family 兜底）：把 `meta.archetype` 重映射到目标档案（按 `transportTaskKind` 匹配模式，保住 t2v/i2v 意图，落不到就用目标 `defaultModeId`）。

改 `resolveExecutableNodeFromCatalog`（`catalogTaskActions.ts`）：
- 取 `usable = loadUsableVendorKeys()`；pinned 供应商 usable → 原样返回（happy path 不变）。
- 否则用 `resolveUsableModelForNode` 重解析 → 改写 node.meta（复用现有 132-145 投影）。
- 解析不到 → 抛**清晰可行动**错误：`当前没有已连接的供应商提供「<brand>」模型。请重新连接原供应商，或在该节点上改选已连接供应商的模型。`（替掉 cryptic `API key missing: kie`）

`CatalogTaskActionOptions` 加 `listCatalogVendors?`（注入便于单测）。

### Stage 2（收尾：UI 反映现实，不再展示死供应商）

- `useModelOptions.ts getEnabledVendorKeys` → 过滤改为 `enabled && (authType==='none' || hasApiKey)`：断开的供应商从模型下拉消失。
- `NodeParameterControls.tsx` 加一个 effect：当 `selectedModelValue` 有值但 `selectedModelOption===null`（stale，因供应商已从下拉移除）→ 按 archetypeId/family 在现有 options 里找同款，自动改选并写回 node.meta（让节点标签/参数跟上迁移，复用 `handleModelChange` 的 patch 形状）。

## 不动什么

- 不碰 electron 主进程 runtime 的 `findExecutableModel` / mapping 寻址逻辑（重解析在渲染层咽喉完成，主进程仍按收到的 vendor+modelKey 执行）。
- 不改 `clearModelCatalogVendorApiKey` 去翻 `enabled`（保留「断开=拔钥匙」语义；可用性由 hasApiKey 派生）。
- 不动 archetype 定义 / seed 数据 / mapping。
- 不删 `buildFixationNode.ts` 里硬编码的 `vendor:'kie'`——运行咽喉会在 kie 不可用时自动迁移，已被覆盖；本次不扩范围。

## 回滚策略

纯增量：删 `usableVendorModel.ts`、还原 `resolveExecutableNodeFromCatalog` 的 `if (vendor || !modelKey) return node`、还原 `getEnabledVendorKeys` 过滤与新 effect 即可。无数据迁移、无 schema 变更。

## 验收门

- 单测：`usableVendorModel` 解析（精确/archetype/family/无解四路径）；`catalogTaskActions` 断开 kie→自动落 apimart 的回归用例。
- 五门：`check:filesize` → `lint:ci` → `typecheck` → `test` → `build` 全过。
- R13 真机走查：断开 kie + 连 apimart，打开示例项目老节点 →（Stage1）点生成不再报 kie key missing，请求打到 apimart；（Stage2）下拉无 kie、节点标签显示 apimart 同款。
