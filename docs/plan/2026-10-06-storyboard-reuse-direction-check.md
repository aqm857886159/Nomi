# 方向检查 · 分镜镜头行与参考卡（L-sbui，2026-10-06）

> 触发：`fix-churn` 报 `anchorZone/StoryboardAnchorRow.tsx` 14 天内第 5 个 fix、`src/devlab/designLab/storyboard/` 第 3 个 fix。
> 结构性结论已经在本分支落地，并经过三轮样张拍板（设计卡 `docs/plan/2026-10-06-storyboard-reuse-canvas-composer.md`，根因合同 `docs/fixes/2026-10-06-storyboard-reuse-canvas-composer.root-cause.json`）。这一页把它按复盘模板补齐，供后续 fix 提交引用。

## 0. 一句话根因

分镜表的镜头行和参考卡，自己又写了一套参数条、参考格、菜单和文案，和画布节点那套并行。画布、文案或框架一变，就得在两三个地方各修一遍，漏一处就是一个新 bug。

## 1. 归类表

| 提交 / bug | 直接原因 | 类 |
|---|---|---|
| `911873697` fix(copy) 重新取回按钮名三处统一 | 同一句文案在镜头行、参考卡、画布各写一份 | 并行实现（文案） |
| `c4c4e0215` fix(copy) 取回失败的说法 | 同上，参考卡和镜头行的状态文案各改一遍 | 并行实现（文案） |
| `51d09c7ff` fix(storyboard) 首帧镜误判「缺参考」 | 参考列判「缺不缺」和生成时填槽用了两份判据 | 并行实现（判据） |
| `bc45ad4b3` fix(react19) JSX 类型 | 框架升级的机械改动 | 不属本类 |
| 本分支：参考卡 ⋯ 读屏名借用了「镜头操作」 | 新写参考卡菜单时照抄镜头行的触发钮 | 并行实现（抄写） |
| 用户反馈 1–4（10-05）：参数选不全、参考删不掉、不会自动引用、和画布长得不一样 | 分镜自带的参数条 / 参考区没跟画布的 owner 走 | 并行实现（交互） |

## 2. 为什么这一类会一直出现

分镜行最早是独立设计的（v5 / v6 合同），那时画布还没有可复用的参数条和素材格。后来画布的 owner（`InlineParameterBar`、`buildPlannedNodeMeta`、`AssetTile`、`WorkbenchMenu`）成熟了，分镜这边没有收过去，于是每一次画布能力变化都要在分镜这边手抄一份。手抄就会漏。

| 铁律 | 本类怎么落 | 证据 |
|---|---|---|
| ⑪ 能选到 | 分镜行的参数清单原来是手抄的，画布能选的分镜不一定能选 | 本分支改成用画布同一个构造器（`storyboardComposerMeta` → `buildPlannedNodeMeta`），`tests/experience-laws/reachabilityLedger.json` 的分镜入口改走新路径，`parameterReachability.test.mjs` 通过 |
| ⑫ 点了=以为的 | 删参考后 @ 芯片还在、⋯ 名字和它做的事对不上 | `shotReferenceSlots.test.ts`（删参考连带删 @、删 @ 连带删参考），`original-storyboard-editor.test.mjs`（⋯ 读作「参考卡操作」，点开有「删除参考卡」） |
| ⑩ 说的=摆的 | 不直接适用（这里不涉及意图抽取） | — |

## 3. 不改结构的话，接下来会冒出什么

| 预测 | 怎么验证 |
|---|---|
| 画布参数条加一个控件或改一个档案，分镜行要么缺这个控件，要么摆法不同 | 本分支后：`storyboardComposerModel.test.ts` 用画布同一个构造器断言；变异 M6（绕过构造器直接用行参数）变红 |
| 再改一句状态文案，又要同时改镜头行、参考卡、画布三处 | 30 天后跑 `node scripts/fix-churn.mjs src/workbench/creation/storyboard/anchorZone/StoryboardAnchorRow.tsx`，fix 数应不再因文案增长 |
| 参考和 @ 两边各删各的，留下孤儿芯片 | 变异 M3、M4（删参考不删 @ / 删 @ 不删参考）都变红 |

## 4. 靶子独立性

- 新的单测和变异是实现线自己写的。为此做了 10 个变异（M1–M10，全部变红、单文件备份还原字节一致），并把合并前的独立验收交给另一条线（设计卡「独立验收」一节）。
- `original-storyboard-editor.test.mjs` 是别的线早先写的可达性测试。本分支只改了它找控件的方式（模型按钮、参数汇总按钮、⋯ 菜单里的删除），保留了原来的判据：840px 宽下每个底栏控件点得到、「生成」点得到、不横向滚动、提示词宽度大于 120。

## 5. P0：哪些是我们独有的

- 参数条、素材格、菜单、浮层都是现成的 owner，本分支直接复用，没有新写通用组件。
- 自写的只有领域部分：自动引用的规则（名字之后插 @、删掉的不补回、同名只补一次）、参考与 @ 的双向同步、按整片画幅定的预览框几何。这三项已登记进 `docs/engineering/concept-owners.json`。

## 6. 接入 / 补 / 重写 / 删

| 选项 | 做什么 | 代价 | 风险 | 推荐 |
|---|---|---|---|---|
| 接入现成方案 | 镜头行和参考卡改用画布的 `InlineParameterBar`、`buildPlannedNodeMeta`、`AssetTile`、`WorkbenchMenu`、`AnchoredPopover` | 版面要重排，用户要重新看样张（已看三轮并拍板） | 画布 owner 改动会同时影响分镜，需要两边的测试一起跑 | **是（本分支）** |
| 补 | 保留分镜自己的底栏和参考区，逐个补文案和判据 | 每次画布变化都要再补 | 继续漏，就是过去 14 天的样子 | 否 |
| 重写（限一个模块） | 只在分镜里另写一套新的 | 比接入更贵，还是两套 | 同「补」 | 否 |
| 删 | 去掉分镜行上的参数和参考，只在画布改 | 分镜失去逐镜调整的能力 | 违背用户「分镜里就能改」的诉求 | 否 |

## 7. 用户要权衡的核心

分镜行和画布用同一套交互，少学一套、少修一套；代价是分镜行原来专属的摆法（模式、时长胶囊平铺在行上）没有了，改成画布那样的一颗汇总按钮。用户在 10-05 和 10-06 的三轮样张里已经接受这个代价。

## 特征测试清单

- `src/workbench/assets/promptAutoMention.test.ts`、`exec/storyboardAutoReference.test.ts`：自动引用
- `shotRow/shotReferenceSlots.test.ts`：参考与 @ 双向同步
- `shotRow/storyboardComposerModel.test.ts`：参数走画布构造器
- `shotRow/shotFrameGeometry.test.ts`：预览框几何
- `exec/storyboardBatchLanding.test.ts`：参考卡写回同步模型和参数
- `src/workbench/generationCanvas/canvasAutoReference.test.ts`：画布侧自动引用
- `tests/ux/original-storyboard-editor.test.mjs`：840px 宽下的可达性
