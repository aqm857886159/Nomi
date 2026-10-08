# 方向检查：花钱走查的像素尺寸参数可见性

## 0. 一句话根因

付费卡把“清晰度 / 输出尺寸”是否属于逐项可见的主参数交给 `parameterControlRole`，但 10 月 5 日的比例别名修复把非比例 `size` 直接变成 `null`；因此真正影响报价的像素尺寸被 `InlineParameterBar` 收进齿轮菜单，花钱前无法逐项核对。

## 1. 归类表：bug → 直接原因 → 类别

| 提交 / bug | 直接原因 | 类别 |
|---|---|---|
| `agent-spend-card.walk.mjs`：找不到“尺寸” chip | `a16564746` 为修复 Agnes 的比例去重，让非比例 `size` 的 `parameterControlRole` 返回 `null`；`splitPrimaryParameterControls` 只露出有角色的控件 | 同一参数语义在去重和付费卡可见性之间分裂 |
| `agent-spend-confirm-executes.walk.mjs` | 当前 main 在 GPT Image 2 的 `aspect_ratio` / `resolution` 档案上通过，不能把它当作本次同一症状 | 不受影响 |
| `agent-spend-stop-midway.walk.mjs` | 当前 main 已通过停止闭环；没有新的生产症状 | 不受影响 |

## 2. 为什么这类问题会反复出现

`size` 是供应商适配层的多义键：有的档案用它表达比例，有的用它表达 1K/2K，有的用它表达像素尺寸。去重边界已经按选项判断“是不是比例”，但主参数 chip 的角色边界仍只覆盖比例、时长、清晰度的显式别名，导致同一个档案参数在“能否去重”和“花钱前能否看见”两条规则中得到不同答案。

### 三条体验铁律

| 铁律 | 类根因要回答的问题 | 最小证据 |
|---|---|---|
| 说的 = 摆的 | 卡上说要生成的尺寸是否和卡上可以直接改的尺寸一致？ | 走查截图 + `primaryParameterChips.test.ts` |
| 能选到 | 模型档案声明的像素尺寸是否在 Agent 付费卡、画布节点和共享面板都能找到？ | `parameterControlModel.test.ts`、`primaryParameterChips.test.ts` |
| 点了 = 以为的 | 点尺寸 chip 后是否只修改卡面草稿，报价和提交仍走既有 owner？ | `agent-spend-card.walk.mjs` 的卡面编辑与无请求断言 |

## 3. 不改结构会出现什么

| 预测 | 验证 |
|---|---|
| 任何使用像素 `size` 的新供应商都会把影响价格的尺寸藏在齿轮里 | 用真实模型档案夹具跑 `splitPrimaryParameterControls`，并执行 `agent-spend-card.walk.mjs` |
| 只有比例键的修复会继续造成“去重正确、可见性错误”的两套语义 | 对照 `parameterEquivalentKeys` 与 `parameterControlRole` 的类级测试 |

## 4. 闸子独立性

当前没有第二条验收线；走查由本实现线运行，只能作为原始复现证据，不能在合并前充当独立验收收据。

## 5. P0：是否是我们独有的

是。供应商参数键到 Nomi 用户语义角色的映射属于 Nomi 的模型档案领域；`optionsAreAspectRatios` 仍复用现有共享判据，不引入通用库。

## 6. 选项对比与推荐

| 选项 | 做什么 | 代价 | 风险 | 建议 |
|---|---|---|---|---|
| 接入现成方案 | 不适用：没有通用库知道 Nomi 的供应商参数语义 | — | 仍会漏掉像素尺寸 | 不推荐 |
| 补 | 在 `parameterControlRole` 这个唯一角色边界中，把“非比例的尺寸别名”归为 `resolution`；去重继续只按选项判断比例 | 一个共享判据 + 类级测试 | 需要覆盖尺寸档、像素串、比例串 | **推荐，待拍板** |
| 重写 | 给每个 `ModelParameterControl` 增加显式 `role` 并迁移全部档案 | 迁移所有档案，范围大 | 交付面扩大，易引入旧数据兼容问题 | 不推荐 |
| 删 | 删除主参数 chip，让所有参数进齿轮 | 改动小 | 直接违反花钱前逐项核对 | 禁止 |

## 7. 用户要权衡的核心

在保持 10 月 5 日“按选项判断比例”的修复前提下，把非比例尺寸归入“清晰度”角色，能让用户在花钱前直接核对尺寸；代价是这条角色边界要承担所有尺寸别名，而不是继续把 `size` 当成“未知参数”。

## 特征测试清单（已先钉住）

- `src/workbench/generationCanvas/nodes/primaryParameterChips.test.ts`：像素 `size` 必须进入主参数列表；当前在未改生产代码时为红，作为待拍板的现状钉子。
- 原始复现：`node tests/ux/agent-spend-card.walk.mjs`；失败于“付款卡真实尺寸参数”不可见，截图为 `.tmp/pi-spend-card-development-1791430821657/FAIL.png`。
- 对照绿证：`node tests/ux/agent-spend-confirm-executes.walk.mjs`、`node tests/ux/agent-spend-stop-midway.walk.mjs` 均通过。


## 协调会话批准（2026-10-08）

选「补」：在 `parameterControlRole` 这一个角色边界里把非比例的尺寸别名归为 `resolution`，去重仍只按选项判断比例。理由：付费卡逐项核对是花钱前唯一的确认点，像素尺寸直接影响报价，必须是主参数；角色判据只有一处，不给每个档案加字段（重写范围大且有旧数据兼容风险）。这是第 4 次碰 `parameterControlModel.ts`，所以要求同时补「每个模型档案里每个影响报价的参数都在主参数里」的类级测试（遍历真实档案登记），而不是只钉像素 size 一种形状。
