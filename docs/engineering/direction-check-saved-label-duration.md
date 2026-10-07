# 方向复盘：已保存回执的显示时限

## 0. 一句话根因

同一份“保存完成”事实被多个显示入口各自解释时间窗口；共享回执已经有单一窗口，但窗口闸门又读取了另一份时钟，导致边界时刻没有稳定收起。

## 1. 归类表

| 入口 | 直接原因 | 类别 |
|---|---|---|
| 画布节点“已保存到项目” | `generationFeedback` 用外部时钟派生 3 秒窗口，`useGenerationFeedback` 的继续订阅判断另读 `Date.now()` | 递归类根因 |
| 任务中心同一节点回执 | 复用 `generationFeedback`，受同一时钟闸门影响 | 递归类根因 |
| 凭据网页“Saved” | 成功后 800ms 尝试关闭一次性凭据页 | 不属于画布回执类 |
| 供应商卡“已保存” | 表示凭据仍存在的持久事实，不是成功回执 | 不属于画布回执类 |

## 2. 为什么会反复出现

显示层把“事实状态”和“短暂回执”都叫作 saved，搜索时容易把不同生命周期混在一起。画布本来已经有共享的 `generationFeedback` 和单一时钟，但闸门没有复用同一快照，留下了一个隐形的第二时钟。

### 三条铁律

| 铁律 | 回答 | 证据 |
|---|---|---|
| 说的=摆的 | 画布回执明确是 3 秒，最后 300ms 只淡出；代码常量和测试一致 | `generationFeedback.ts`, `generationFeedback.test.ts` |
| 能选到 | 节点、轻量节点、任务中心都通过 `generationFeedback` 读取同一窗口 | `door-map.mjs generationFeedback,savedFeedbackWindowOpen` |
| 点了=以为的 | 完成后 0/2/5/10 秒截图验收仍需真实 Electron 走查；当前单测只覆盖数值边界 | UX 走查待补，标记 `unverified` |

## 3. 不改结构的可验证预测

| 预测 | 验证 |
|---|---|
| 若继续保留第二时钟，3 秒边界会出现提示不收起或提前收起 | 让外部 store 时钟与 `Date.now()` 偏移后跑 hook 走查 |
| 若只修一个渲染入口，任务中心仍会复现 | door map 的两个 `generationFeedback` 读取点共用同一测试 |

## 4. 方案对比与推荐

| 方案 | 代价 | 风险 | 结论 |
|---|---|---|---|
| 保留各入口自己的计时 | 低 | 再次分叉，无法证明 3 秒一致 | 拒绝 |
| 接入现有共享 `generationFeedback` + 外部 store 时钟 | 低 | 需要补时钟归属回归钉子 | **推荐** |
| 重写成全局 Toast | 中高 | 破坏节点上下文，增加新显示层 | 拒绝 |

## 5. 用户要权衡的核心

用户需要的是“保存成功后短暂确认，随后把注意力还给失败和进行中状态”；持久凭据状态必须继续存在，因为它回答的是“现在是否有 key”。

## 6. 特征测试清单

- 已有：`src/workbench/observability/generationFeedback.test.ts` 覆盖 0/2.5/3 秒窗口和淡出值。
- 新增：`src/workbench/observability/useGenerationFeedback.test.ts` 锁定闸门必须使用共享外部时钟。
- 未完成：zh/en Electron 真实宿主在 0/2/5/10 秒截图对账，交付报告标 `unverified`。

## 放行

- 2026-10-07 协调会话放行：「已保存」确认标签的显示时长统一读共享外部时钟，测试从源码字符串断言换成行为测试（假时钟 + 外部 store 快照）。改动面限于 `useGenerationFeedback.ts` 一处闸门，不改凭据持久状态。zh / en 真宿主分秒截图对账仍是 unverified，正文已标。
