# 生成积分估算与实际计费记录设计

日期：2026-08-25

## 背景

生成器已经有模型目录里的可选 pricing 字段和生产合同的费用边界，但普通画布生成入口没有把它带到用户按下生成的那一刻；任务完成后的供应商实际扣费也没有进入统一的生成记录。结果是用户只能凭经验猜“这一张大概花多少积分”，而且 APIMart 与 KIE 的计费字段无法被后续复盘利用。

这次交付只解决一个用户动作：在生成按钮附近给出可信的积分估算；若当前模型/参数没有可计算的定价，则保持原按钮，不显示“未知费用”或空白费用块。生成完成后，把供应商返回的实际积分写入已有 provenance 与 vendor call event，供复盘和后续校准使用。

## 设计结论

### 1. 通用成本契约

成本不按供应商写 UI 分支，而是拆成两类 provider-neutral 证据：

- `CostEstimate`：生成前由目录 pricing + 当前参数推导，单位为 `credits`，来源标记为 `catalog`。
- `CostActual`：生成后由供应商响应适配器提取，单位为 `credits`，来源标记为 `provider`。

适配器只负责“从响应取哪一个字段”：

| 供应商 | 实际字段 | 证据 | 无字段时 |
| --- | --- | --- | --- |
| APIMart | `data.credits_cost` | 已有 APIMart 任务样本，包含 0.06、7.1、8.52、9.94 等值 | 不写 actual |
| KIE | `data.creditsConsumed` | 已抓取 KIE `recordInfo` 官方响应，字段描述为实际扣除积分 | 不写 actual |
| 其他供应商 | 未声明 | 没有可靠字段就不猜 | 不写 actual |

`cost`（金额）与 `credits`（积分）严格分开；不把 APIMart 原始 `cost` 小数金额误当成积分。金额计费未来可以注册新的单位适配器，但本次不为它增加 UI。

### 2. 估算规则

目录 pricing 是估算真源，沿用现有 spec key 语义：

```text
估算 = pricing.cost
     + 所有 enabled 且匹配当前参数值的 specCosts.cost
```

匹配同时支持 `720p` 和 `resolution:720p` 两种 key。金额必须是有限非负数；pricing 缺失、关闭、非数字均返回 `null`，绝不把未知变成 0。

单节点再乘以当前一次生成的变体数 `N`。批量估算逐节点求和；只要有一个节点不可算，批量总额就返回 `null`。

### 3. 交互

#### 单节点

- 有估算：把原来的圆形上箭头替换为同一行动位上的 token-only 深色胶囊按钮，文案为 `约 8.52 积分 ↑`（数值按当前模型/参数/N 实时更新）。按钮仍调用原有 `handleGenerate` 和 spend confirmation，不增加第二条提交路径。
- 无估算：按钮恢复原来的圆形 `↑`，不显示“费用未知”、不显示占位 skeleton、不改变按钮宽度。
- 估算只在定价完整时出现；请求失败、模型切换或目录尚未给出 pricing 时自动退回原按钮。

#### 批量

- `CanvasBatchGenerateDock`、框选 `CanvasSelectionToolbar`、依赖计划 `BatchPlanOverlay` 共用同一个批量汇总值。
- 全部待生成节点都能估算时，在原生成主按钮旁显示 `约 24.60 积分`；批量按钮保留原动作和确认流程。
- 任一节点没有可计算积分时，完全不显示该汇总文本，主按钮继续使用原来的“生成全部 N 个/生成选中 N 个/按计划生成”。
- 不把“可能不同供应商”的节点强行换算成钱；积分单位相同才相加。

#### 实际结果

- 成功、失败、异步轮询终态都通过同一 `vendor.call.completed` 写入 actual（若供应商响应包含可靠字段）。
- provenance 只在有 actual 时带 `cost`；旧项目和没有字段的响应保持兼容。
- 缓存命中不伪造 actual，也不产生供应商调用事件。

### 4. 设计系统约束

- 只用 `nomi` token：`bg-nomi-ink`、`text-nomi-paper`、`rounded-full`、`text-caption` 等现有 token/class；不新增 hex、任意字号或全局 CSS。
- 成本信息属于生成主行动的上下文，不新增常驻工具栏或独立面板，符合控件层级 L1。
- 成本缺失时无额外 UI，保证“无计算就没有这个了”的明确边界。
- 所有新增可见文案加入 `zh-CN` 与 `en` i18n。

## 代码边界

### 主进程

- `electron/vendor/cost.ts`：provider-neutral 成本类型、APIMart/KIE 适配器、响应安全取值。
- `electron/vendor/provenance.ts`、`electron/runtime.ts`、`electron/tasks/taskResultQuery.ts`：把 actual 传入 provenance 和 completed event；不改变提交/轮询语义。
- `electron/events/vendorCallTrace.ts`：completed payload 可选携带 actual cost，仍维持只记 requested/completed 终态的节奏。

### 渲染层

- `src/workbench/generationCanvas/spend/generationCost.ts`：纯函数估算（ModelOption + node meta + 变体数 + 批量全知规则）。
- `src/config/modelOptionMappers.ts`：保留 pricing 小数，避免 8.52 被 floor 成 8。
- `NodeGenerationComposer.tsx`：同一按钮位条件渲染估算文案。
- `useCanvasProductionActions.ts`、`CanvasBatchGenerateDock.tsx`、`CanvasSelectionToolbar.tsx`、`BatchPlanOverlay.tsx`：共享批量估算，不改运行器。
- `src/workbench/api/taskApi.ts`、`generationCanvasTypes.ts`、`generationCanvasSchema.ts`、`catalogTaskResultParse.ts`：向后兼容地传递 actual cost。
- `src/i18n/locales/generationCommon.ts`：中英文文案。

## 不在本次范围

- 不抓取供应商实时价格、不在生成前发网络探测请求。
- 不建立第二套 spend confirmation；仍使用现有 `useSpendConfirmStore`/`confirmAndMintGrant`。
- 不把金额换算成积分，也不为没有证据的供应商猜价格。
- 不新增设置页、成本报表页或全局预算仪表盘；实际事件先进入已有项目事件流和生成 provenance，后续可在同一契约上做报表。

## 验收不变量

1. APIMart `data.credits_cost` 和 KIE `data.creditsConsumed` 解析为 `CostActual`，非法/缺失值为 `undefined`。
2. 目录 pricing 为 8.52 时 UI 保留 8.52，不被取整。
3. 单节点有估算显示胶囊；无估算保持圆形箭头。
4. 批量只在所有节点可估算时显示汇总，否则没有任何成本组件。
5. 成本 UI 点击仍进入原生成确认和执行链，确认前不发请求。
6. 旧 provenance/event/缓存数据仍可正常读取。
