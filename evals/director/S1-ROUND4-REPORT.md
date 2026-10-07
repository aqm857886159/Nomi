# S1 第四轮收货报告：回归与 Phase 3 前置

分支：`feat/director-3dbox-s1r3`。PR：[#979](https://github.com/aqm857886159/Nomi/pull/979)。最终推送 SHA 见交付收据；PR #974 已合入且远端 base 分支已删除，#979 当前 base 为 `main`，这是 GitHub 可用的实际 base。

留出纪律保持不变：调参期间没有读 T3（`t3-storm`、`t3-cafe`、`t3-space`、`t3-market`）或 T2（`t2-gallery`、`t2-rooftop`）的分数、reasons、rawPlan；三轮最终收据生成后才一次性读取。开发集为其余 22 张。

## 回归根因与修复

- **courtyard-standoff 三轮归零**：编译器把 `sidestep` 的终点取成目标人物位置，守卫在切点从院门跳到女子位置，测量报 `侍卫 jumps 7.76m across cut`，同时相机轴侧发生翻转。修复在 blocking 轨迹边界：sidestep 从演员自身位置横移；相邻轨迹路标写入 `clipId`，播放沿用统一 `evaluateEntityTransform`；相机对所有可见角色和场景实体做半空间/包围盒避让。
- **perfume-orbit 一轮归零**：`on` 关系随后被统一 `p.y=0` 覆盖，瓶盖与瓶身重叠，特写相机进入瓶盖。修复保留堆叠高度、按对象边界抬高 push-in 收尾，并让产品/场景模板在出片中可见。
- **t=0 T-pose**：每个角色现在有从 0 秒开始的 action clip；动作间空隙由 `standing_idle` 补齐。未修改 T-pose 判据。
- **产品地面**：`s1-product-ground` 继续由模板物化，且 `isAuxiliary=false`，不再在出片路径被隐藏。

R3 三轮失败计划已固化为编译器回归夹具，覆盖庭院/香水每轮 rawPlan；编译器测试还验证相邻片段连续性、所有角色 t=0 覆盖、产品地面可出片。

## 稳定 ID 与模型面投影

实体 ID 已去掉计划哈希：`actor:<plan actor id>`、`shot:<plan shot id>/camera`、`setPiece:<plan piece id>`；dressing 使用确定性的 `dressing:<group>:<element>`。同一计划重复编译的对象、相机、轨道 ID 完全一致；只改一个 shot 名称时只改变对应 camera ID，actor/setPiece ID 集合不变。对应测试在 `directorPlanCompiler.test.ts`。

`directorPlanModelSchema` 从执行 schema 的形状投影而来：严格 object、字段均有 describe、版本用 `min(2).max(2)` 避免根级 `const`，camera kind 使用单一 enum，根无 union。测试用与门岗相同的 `toPublishedJsonSchema`、`collectStructuralFailures`、`collectVendorCompatibilityFailures` 验证；通过 `pnpm run check:model-schema` 规则的本地同套判据测试。

## 最终三轮数字

代码最终三轮：

- `evals/runs/director-20261004064657-s1`
- `evals/runs/director-20261004065443-s1`
- `evals/runs/director-20261004070234-s1`

| 栏 | 三轮均值 ± 方差 | 对应率 | 每轮 total |
|---|---:|---:|---|
| 全题库 28 张 | **0.6022 ± 0.000103** | **68.45%** | 0.5880 / 0.6074 / 0.6112 |
| 开发集 22 张 | **0.5661 ± 0.000053** | **65.91%** | 0.5760 / 0.5587 / 0.5636 |
| 留出集 6 张 | **0.7345 ± 0.005260** | **77.78%** | 0.6320 / 0.7858 / 0.7858 |

分层均值 ± 方差：benchmark `0.5804 ± 0.000932`；T1 `0.5818 ± 0.000913`；T2 `0.5162 ± 0.004218`；T3 `0.8077 ± 0.011834`。L0 全库三轮均值 `0.9643`，L1 `0.9190`，L2 `0.5697`，L3 `0.0411`，L4 `0.4881`。

三道标尺题（每轮均 L0=1、对应率=1）：

| 卡 | 第 1 轮 | 第 2 轮 | 第 3 轮 | 主要剩余原因 |
|---|---:|---:|---:|---|
| courtyard-standoff | 0.4593 | 0.4388 | 0.4109 | planner 运镜/景别与题面不稳；动作 `hide_object_behind_back` 是题卡能力缺口 |
| perfume-orbit | 0.4582 | 0.6156 | 0.7110 | 环绕幅度常为约 90°而非 360°，后段主体出画 |
| police-chase | 0.6979 | 0.7235 | 0.7087 | 跟拍/横摇/推进自然语言映射与景别覆盖仍波动 |

三道标尺题三轮都大于 0，且没有复现 R3 的 L0 归零；但 courtyard 仍低于第二轮收据水平，目标 `s1 ≥ 0.70`、对应率 `≥ 0.85`、T2 `≥ 0.50` 中仅留出集/T2 均值达到，整体目标未达，诚实保留。

原始 schema 合格率和归一后合格率：每轮 `84/84 = 100%`（28 卡 × 3 轮），合计 `252/252`；rawPlan 与 normalize 后均通过。token：`176,120 + 174,851 + 175,433 = 526,404`；规划尝试 `30 + 29 + 29 = 88`。

`s1-oracle-plan` 最终收据：`evals/runs/director-20261004062010-s1-oracle-plan`，修复前 oracle `0.895`；最新场景出片/连续性修复后的复核为 `evals/runs/director-20261004063536-s1-oracle-plan`，`0.8961`，高于 0.88。

## 转交尺子

- `t1-07-truck` 用户原话是“雕像”，而题卡 actor category 标成 `person`；这是题卡实体类别冲突。本轮没有修改 cards、binding、scorer、oracle、measurement、judge。
- 本轮已修的是编译器侧产品地面与角色动作片段；T-pose 判据保持原样。

## 验证与门岗

通过：

- `pnpm exec vitest run ...directorPlanCompiler.test.ts ...directorPlanSchema.test.ts`：24/24。
- `pnpm run typecheck`：app/electron/electron-pi/test-types 全通过。
- `node scripts/check-root-cause-contracts.mjs`：通过。
- 模型投影测试与共享 structural/vendor 判据通过。

最终 `pnpm run gates` 已执行完整链：`check:fresh-base` 通过（先合入 `origin/main` `fd076b01e3dd`），`gates:contracts` 为 96 项中 94 通过、1 个既有 design-lab 阻断、1 个 concept-owners advisory；其余 build/typecheck/lint 链继续完成。design-lab 的 32 张差异均来自未改动的既有视觉基线，符合本轮约定的“同刻干净 main”例外；本分支没有修改 `tests/ux/design-lab` 或其基线。`check:concept-owners` 的 advisory 指向尺子专班与历史概念登记，已列入转交，不改变本轮代码结论。Windows packaged runtime、L5 视觉评审和真实媒体仍未验证。
