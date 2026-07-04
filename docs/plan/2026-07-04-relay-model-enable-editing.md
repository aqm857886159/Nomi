# 中转站拉取模型的「勾选启用/停用」就地编辑

日期：2026-07-04 ｜ 样张已拍板（用户选「就地内嵌」）｜ 调查见本轮 Explore 报告

## 背后逻辑（D1 用户摩擦）

中转站（new-api）一接就拉几十上百个模型，全堆成 chip 墙（`ModelChipGroups`）。用户想「这堆里只留能用的几个」，现在唯一手段是逐个点 × **删除**——不可逆，删了想恢复得重拉整批。缺一个「勾选启用哪些」的可逆编辑。

## 关键发现：开关已经现成，几乎不用改数据

- `Model.enabled`（`electron/catalog/types.ts`）**已存在**，渲染 DTO `ModelCatalogModelDto.enabled` 也有。
- 生成侧**本来就只认 `enabled:true`**：`selectExecutableModel`（types.ts）、`catalogStore.enabledModels`、`modelCatalogCache` 过滤——把某模型 `enabled=false`，它立刻从生成下拉/runtime 消失。**这正是「不启用」的语义。**
- 写库 setter 现成：`bridge.modelCatalog.upsertModel({vendorKey, modelKey, enabled})`——`applyModelUpsert` 保留其余字段（labelZh/kind/meta…），只翻 enabled。删除现成：`deleteModel`。`refresh()` 已广播 `nomi-model-catalog-changed`。

**结论：不加任何数据字段、不碰 IPC/preload/bridge。** 只差 UI + 把 enabled 显示出来。

## 取舍（D6，已在样张对比）

- **勾选框 = 启用/停用（可逆）**：主操作，随时可再开，清单一直在 → `upsertModel(enabled)`。
- **垃圾桶 = 彻底移除（不可逆，要重拉）**：保留现有 `deleteModel`，给「永远不想要」的。

## 范围（就地内嵌，仅中转站/自定义卡）

### M1 接线
- `ChipModel`（`ModelChipGroups.tsx`）加 `enabled: boolean`。
- `OnboardingDrawer`：① map model 时带 `enabled`（现在丢了）；② 加 `handleToggle(model)` → `upsertModel({vendorKey, modelKey, enabled: !model.enabled})` → `refresh()`；③ relay 卡（`otherVendorGroups`）副标题由「N 个模型」改「X/N 已启用」。

### M2 编辑组件
- 新 `ModelEnableEditor.tsx`（就地内嵌于中转站/自定义 `FoldableModelCard` 展开体，替换那处的 `ModelChipGroups`）：搜索框 + 全选/全不选 + 按 kind 分组 + 逐模型行（勾选框启停 + 名 + 垃圾桶删除）+ 实时「已启用 X/N」。复用 `groupModelsByKind` + 纯逻辑可单测。
- **不动**已知 vendor 卡（apimart/kie，预置模型只读 chip，`VendorOnboardCard` 仍用 `ModelChipGroups`）——那不是「拉一堆」的场景，本次不扩。

### M3 收口
- 纯逻辑单测（搜索过滤/计数/bulk 全选本组）；五门；R13 真机走查（接一个中转 → 展开卡 → 搜索 + 勾掉几个 → 确认生成模型下拉里被停用的消失）；CHANGELOG；push。

## 不动项
- 数据结构（enabled 已有）、IPC/bridge/preload、已知 vendor 卡、拉取时的 `ModelPickerScreen`（那是接入阶段的 opt-in，本次是接入后的存量编辑，不重叠）。

## 验收门
五门全过 + 编辑组件纯逻辑单测 + R13 截图：停用某模型后它从生成模型下拉消失、再启用又回来（可逆），删除后需重拉。
