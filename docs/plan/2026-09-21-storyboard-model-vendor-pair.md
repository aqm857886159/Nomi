# 分镜模型身份成对写读（2026-09-21）

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

> 状态：已实施（分支 `fix/storyboard-model-vendor-20260921`）。根因合同：`docs/fixes/2026-09-21-storyboard-model-vendor.root-cause.json`；结构评审：`docs/audit/2026-09-21-model-identity-pair-structure.md`。

## 要解决的摩擦

用户自定义了一个与 APIMart 同名的模型（gpt-image-2）。之后在分镜里选 APIMart 那条，界面上要么选不中，要么显示 APIMart，但扣费和请求都走了自定义那家。

## 范围

- 写：镜头卡底栏、批量条、锚行、新增/插入镜头、切镜头类型、Agent 改镜，全部改为 `(modelKey, modelVendor)` 成对写（`planModelSelection` + `PlanShotPatch`/`PlanAnchorPatch` 类型 + `updateShotAt`/`updateAnchor` 运行时兜底）。
- 读：没记供应商的旧数据只走 `pickImplicitVendorMatch` 这一个判定口，回显和执行共用。
- 持久化：锚 schema 补上模型字段，加逐键编译期守卫。
- 删：零调用方的 `resolveGenerationModelSelection` / `useGenerationModelSelection` / `updateNodeModelMeta` / `getModelOptionRequestAlias`。

**不动**：持久化格式（仍是两个兄弟字段；改成单值 `model: { key, vendor }` 是结构评审 §4 的提议，要先过 R5⑤/R4）；画布节点在供应商失联时的既有自愈回显。

**回滚**：revert 本分支的提交即可。没有数据迁移，旧方案原样可读。

**验收门**：`storyboardModelVendorIdentity.test.ts`（三个入口的复现，修前红）、`storyboardModelIdentity.class.test.ts`（类级测试，修前在 86647f41 上红 17 条）、真机走查 `tests/ux/storyboard-model-same-name.walk.mjs`（zh/en 双语，断言出站请求来自哪家，带阳性对照）、`pnpm run gates`。

## 先查别人

- **依赖（zod 3.25.76）**：`z.object` 默认的未知键策略是 `"strip"`（`node_modules/zod/v3/types.d.ts:497`、`:587`）。schema 里没声明的键会在解析时被静默丢掉，这正是锚的模型身份在 `projectNormalize` 重开项目时消失的机制。解法是补齐字段，并加一条「类型的键必须全在 schema 里」的编译期守卫；不改用 `.passthrough()`，因为那会把任意未知键也放进持久化里。
- **仓库已有（选模型不选家时的默认规则）**：`src/config/modelIdentity.ts:202` 的 `sortModelProviders`（用户顺序 > `vendorTier` 分级 `:114` > 名字 > 目录序）是模型框「自动选最优」的那把尺。旧数据的隐式解析复用它的前两级，但去掉「显示名」那一级，因为执行侧的清单（`AgentModelEntry`）没有显示名，两边必须逐字同一把尺。
- **仓库已有（画布节点已修好的选择 owner）**：`src/workbench/common/useDedupedModelSelect.ts:328` 的 `resolveProviderSelectValue` 和 `:287` 的 `pickHealthiestProvider` 已经按 `(value, vendor)` 双键工作。分镜的镜头卡和锚行直接复用这个 hook，不再各写一套选择逻辑（P1）。
- **仓库已有（用户供应商顺序）**：`electron/shared/contracts/vendorPreference.ts:24` 的 `orderByVendorPreference` 与渲染层缓存 `src/workbench/common/useVendorPreference.ts` 是同一份设置。执行侧的调用点改为显式把这份顺序传进 `buildModelEntryIndex`，原来它恒为空数组。
- **生态**：这个问题是本仓自己的身份契约（中转站可以提供同名 modelKey），没有第三方库或规范定义「同名多家落哪家」。所以规则写在合同里，并在模型框回显，不去猜。本次没用 TikHub，因为这不是产品或设计调研题。
