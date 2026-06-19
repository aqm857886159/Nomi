# 分镜方案露出模型参数（#1）

> 2026-06-19 · 状态：设计已拍板（含可体验样张），进入实现
> 用户拍板：渐进展开方向 OK；① 常用参数(视频比例/清晰度)**直接露在卡上**，其余收抽屉；② 每镜参数+套用全部够用；③ 抽屉里**要放模式切换**。

## 1. 现状（R6 摸底）

- 分镜镜卡 [StoryboardShotCard.tsx](src/workbench/creation/storyboard/StoryboardShotCard.tsx)：已有 镜N / 时长 / **模型**(仅选 modelKey) / 参考 / prompt。**缺模型的其他参数**。
- `PlanShot`（[storyboardPlan.ts:38](src/workbench/generationCanvas/agent/storyboardPlan.ts)）：有 `modelKey`/`modeId`，**无 `params`**。
- 参数真相源 = 模型档案 `archetype.modes[].params`（[modelArchetypes](src/config/modelArchetypes)）；每个 `ModelParameterControl` = key/label/type/options/default。
- 已有可复用控件派生器 [parameterControlModel.ts](src/workbench/generationCanvas/nodes/controls/parameterControlModel.ts)（`controlInitialValue`/`parseControlInput` 等）——**复用，不另写**（P1）。

## 2. 设计（通用，不为每个模型写一套 P4）

参数来源 = `resolveArchetypeForModel(modelKey)` → 当前 mode 的 `params`。**分两档显示**：

| 档 | 放哪 | 放什么 | 判定规则（derive，不 hardcode）|
|---|---|---|---|
| 常用 | 卡片头部**直接露**（紧挨模型）| 比例 / 清晰度 / 尺寸 | `type==='select'` 且 key≠duration 的前 2 个 → 视频自然露「比例+清晰度」、图片露「尺寸」|
| 进阶 | 「参数」抽屉（点开）| 模式切换 + 其余参数（负向提示/生成音频…）| 其余全部 + 多 mode 时的 mode 选择器 |

- `duration` 不进卡参数（卡已有独立「时长」选择器，避免双份真相源）。
- 留空 = 用模型默认（不写死）。
- 抽屉底「**套用到全部镜头**」：把这镜 params+modeId 推给所有镜。
- 「默认模型」无 archetype → 无参数，抽屉提示「落画布用默认」。

## 3. 落地

- **类型**：`PlanShot` 加 `params?: Record<string, unknown>`（zod schema 同步）。
- **`ModelParameterControl`** 加可选 `primary?: boolean`（默认不用；预留显式覆盖，先走 derive 规则）。
- **新子组件** `ShotParamControls.tsx`（卡内，渲染常用 inline + 抽屉）——避免把 ShotCard 喂大（R9，单文件≤800）。复用 parameterControlModel 派生 + NomiSelect/控件。
- **`buildPlannedNodeMeta`**：把 `shot.params` 铺进节点 meta（和画布节点 meta 同口径，落画布即生效）。
- **编辑器** [StoryboardPlanEditor.tsx](src/workbench/creation/storyboard/StoryboardPlanEditor.tsx)：已传 modelOptions；加「套用到全部」回调。

## 4. 不动什么
- 不碰画布节点参数系统（复用其 archetype + 控件派生）。
- 不动 duration 选择器（已存在）。
- 不为某模型写专属参数 UI（全 derive 自 archetype）。

## 5. 回滚
纯增量：`params` 字段可选（旧方案无此字段照跑）；撤掉 ShotParamControls + ShotCard 的接入点即回到现状。

## 6. 验收门
1. 五门全过。
2. 单测：`buildPlannedNodeMeta` 把 shot.params 正确铺进 meta；inline/drawer 参数划分纯函数测试。
3. 与获批样张逐项对账（R8）：默认收起只露模型+比例+清晰度；点参数展开见模式+进阶；换模型参数自动变。
4. R13 真机走查：创作区拆镜头 → 镜卡选模型 → 露出比例/清晰度 → 展开参数调 → 落画布参数生效。
