# 方向检查：模型清单的「三态」缺一层（RW）· 2026-10-11

触发：`scripts/fix-churn.mjs` 命中——`src/config/`（`modelCatalogCache.ts`、`useModelOptions.ts`）近 14 天第 5 个 fix、`InlineParameterBar.tsx` 第 6 个 fix（走查 §4「点节点先闪没有模型」）。

## 0. 一句话根因

清单的**「有 / 正在加载 / 真没有」三种状态没有唯一表示**：缓存住 `modelCatalogCache`（模块级 Map）、`loading` 住在每个 hook 实例里、而 UI 把「空」一律画成「没有」——缺的是「清单状态」这一层概念（唯一 owner + 三态）。

## 1. 归类表：bug → 直接原因 → 类

| 提交 / bug | 直接原因 | 类 |
|---|---|---|
| 2026-09-25 `model-catalog-sync-read-per-mount`（`docs/fixes/2026-09-25-…root-cause.json`） | 每个挂载点各自同步读目录 → 打开就卡 | 清单读取没有唯一口 |
| 2026-10-08 / 10-10 `src/config/` 4 个 fix（缓存键、隐藏过滤、默认模式…） | 每次补在调用点或缓存层 | 同上 |
| 本次（走查 §4） | 选中时 composer 重挂 → 第一帧 `options` 为空 → 画「无模型·配置模型」 | 「加载中」被当成「没有」 |

## 2. 为什么这一类会一直出现

追到三层：

1. **表示层**：只有 `ModelOption[]` 一个值 + 各调用点自己的 `boolean loading`，没有「三态」这一个可传递的概念；
2. **所有权层**：缓存归 `modelCatalogCache`，`loading` 归每个 `useModelOptionsState` 实例，UI 拿到的又只剩 `{ message }` —— 同一个事实存了三份；
3. **方向层**：每次修都发生在「调用点」或「缓存层」的边角（清不清空、翻不翻 loading），没人回答「清单到界面之前那一帧谁负责」。

**体验铁律对应**：⑪「能选到」——档案清单必须覆盖每个入口；本条正是「清单在到达界面的那一帧没有 owner」。⑩⑫ 不适用（不涉及意图抽取与可点目标普查）。

## 3. 不改结构的话，接下来会冒出什么（可验证预测）

| 预测 | 怎么验证 |
|---|---|
| P1 新入口（分镜批量 / 列表批量）还会自己实现一遍「loading → 空态」 | `grep -rn "modelOptions.length === 0" src/` 的调用点数会不会继续涨 |
| P2 冷启动（缓存未命中）仍会闪一次：本次 peek 只解决「命中缓存」那一半 | 清缓存→打开模型目录→立刻点一个节点，连续截图看首帧 |
| P3 `MODEL_REFRESH_EVENT` 刷新时会再出现一次空帧 | 触发展开事件后连拍截图 |

## 4. 靶子独立性检查

- 尺子由实现线自己写：`InlineParameterBar.test.ts`(22) / `useModelOptions.archetype.test.ts`(3) / `modelCatalogStatus.test.ts`(2)——**都只测「值」，没有「帧级不闪」的观测点**，所以这类闪烁一直没人拦。本次补一个特征钉子：加载态渲染骨架 (`data-model-chip-loading`)。
- 无「修对了反而掉分」先例。

## 5. P0：这是我们独有的吗？现成方案

不是独有。「异步数据的同步首值 + 三态」是通用做法，生态里已有成熟语义：TanStack Query 的 `initialData` + `isPending`、SWR 的 `fallbackData`、Apollo 的 `fetchPolicy: cache-first`。我们的 `modelCatalogCache` 已经是一个模块级缓存，缺的只是**把它包成带三态的读取口**——不引入新依赖、不新增常驻规则。

## 6. 结构性结论（交用户拍板）

把「清单状态」提升为一个概念：`modelCatalogCache` 提供**唯一读口** `readModelCatalog(kind, mode) → { options, phase: 'ready' | 'loading' | 'missing' }`；`useModelOptionsState` 与所有入口都只消费它；`InlineParameterBar` 只按 `phase` 渲染（ready→芯片、loading→骨架、missing→配置入口）。这样 P1/P2/P3 一起消失。

本次先落「最小可判」的一刀（同步首值 + 加载态骨架），**结构性改造待拍板**；三条预测先记进逃逸账本候选。

## 7. 本次动作

- `modelCatalogCache` 新增同步 peek；`useModelOptionsState` 用 peek 做初始 state、有缓存不归零；`InlineParameterBar` 按 status 区分「加载中」与「没有」。
- 特征钉子：加载态渲染 `data-model-chip-loading` 骨架。
- 未做（待拍板）：上面 §6 的唯一读口改造。
