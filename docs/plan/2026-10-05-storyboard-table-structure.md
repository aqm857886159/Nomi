# 分镜表结构：浮条看得到、菜单不被裁、窄窗按钮点得到（设计卡）

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

> 依据：`docs/research/2026-10-05-storyboard-plan-user-audit.md` 第 3 节 B5a + B8 的可达性部分（审计 A1、A13；账本 AUD-20261005-12 / -16）。
> 纯结构修复，不改视觉设计、不加控件，所以不出样张（纯 bug 修复不问）。线：L-sbtable。

```
改动名：分镜表结构（B5a + B8 可达性）     线/负责人：L-sbtable     类别：[新界面（`src/design/AnchoredPopover.tsx` 被 merge-preflight 判成「新界面」，按扫描器类别填全 9 格）]
```

| 格 | 结论 | 证据 |
|---|---|---|
| ★1 用户怎么用 | 当我在分镜表里选中一行（或多行）、打开某一行的菜单、或把窗口缩到最小时，我想**直接看到并点到**多选浮条、行菜单、「用作…」菜单、每行的「生成」和「⋯」。步骤：① 打开分镜页，不滚动，点一行的画面格角落选中它 → 浮条在视野里；② 滚到最后一行，点行首「⋯」、点结果下的「用作…」、点提示词里的预设片段 → 菜单整块露出，点别处关上；③ 窗口 1100×690、Agent 面板展开、中英两种语言 → 每行「生成」「⋯」点得到。不做什么：不改勾选框「跳过 / 选中」语义、不动参考卡底栏（等样张）、不改底栏的让位政策（模型 ≥ 8 字符、模式 / 时长不缩不降）。已知坑：Playwright 的 click 会自己滚动容器、`getBoundingClientRect` 不反映裁切，所以判据只用 elementFromPoint。真实任务：2 条——「选 1 镜看浮条再批量统一模型」「最后一镜出图后点用作…→存为参考」，都在零额度夹具上走（`tests/ux/storyboard-table-structure.walk.mjs`）。指标：不可达控件数 = 0（基线：zh 12 + en 12 个底栏控件点不到，另有浮条、行菜单被裁、点别处菜单不关） | 走查脚本与 `before/` `after*/` 截图 |
| ★2 谁说了算 | 浮条的位置归 `StoryboardShotTable`（它挂在行区外、坐在分镜页的滚动区里）；表内所有弹出层的定位归 `src/design/AnchoredPopover.tsx`（Portal 到 body）；行的密度档归 `shotRow/storyboardRowDensity.ts`，它问底栏要的「下限宽」归 `shotRow/composerBarGeometry.ts`。碰 0 个领域概念（纯 UI 布局，不在 `concept-owners`） | `node scripts/door-map.mjs AnchoredPopover`：12 扇读门（原 8）；`storyboardRowIsNarrow` 1 扇写门 |
| ★3 一致与复用 | 弹出层复用现成 `AnchoredPopover`（`ShotComposerBar` 的「⋯」、素材选择器早就用它），**不自己写定位**；仅给它加一个向后兼容的 `passThrough`（悬停预览是纯展示，指针要穿过去）。窄窗让位沿用 `composerBarGeometry` 与行密度档两层现有机制，不新加一套：补的是两层之间漏掉的那一截（行那一档只问「提示词列比参考列窄吗」，不问「装得下底栏吗」），新增一个由底栏让位几何算出的下限常数。无第二份定义；无新通用能力，`check:self-written` 无新增 | `git grep "absolute.*z-(20\|30)"` 在 storyboard 目录为 0（结构测试盯着） |
| ★4 全状态 | 无新状态、无新文案。可达性相关的各态：未选中（无浮条）/ 选中 1 或多行（浮条 sticky 跟屏，滚动中仍在）/ 菜单开（Esc、点别处关）/ 最后一行菜单（贴边自动翻到上方）/ 宽档与窄档（窄档参考列收成一格 + 「+N」，列距 12→6、左右内边距收 2 / 4px）。中英两轨各一份真截图（见 PR 正文） | `tests/ux/shots/storyboard-table-structure/{before,after}/` |
| 5 中途表 | 弹层是瞬时 UI，不持久、不花钱、无长跑。状态 × 打断：打开中 × 关窗 / 重启 / 断网 = 随页面消失，无回执；打开中 × 连点触发钮 = 再点收起（不叠开）；打开中 × 点别处 / Esc = 关闭并把焦点还给打开前的元素；打开中 × Tab = 在浮层内循环；打开中 × 窗口缩放 / 滚动 = 浮层跟着锚点重算位置，贴边自动翻边；打开中 × 行被删 / 重排 = 浮层随锚点卸载（焦点回 body 时不抢别处焦点）。花费：全程不扣 | 键盘清单测试 + 走查 |
| 6 外部数据与失败 | 不适用：无外部数据来源（纯本地 UI 布局与焦点）；失败态只有「锚点已卸载」，`AnchoredPopover` 对断开的锚点不重算位置 | — |
| 7 性能预算 | 不适用（只记录）：同时只开一个浮层，每个浮层一个 ResizeObserver 加 resize/scroll 监听，卸载即清；走查夹具 5 镜无可感知卡顿；未做 1000 镜规模测量（`unverified`） | 人工 |
| 8 真实条件 | Windows ✓、中英文 ✓、最小窗口 1100×690 ✓（走查）、键盘全程 ✓（`tests/ux/storyboard-popover-keyboard.test.mjs`，四个弹层）；真规模（大表）`unverified`；干净安装 `unverified`；真付费不适用（零额度，没点生成） | 截图 `tests/ux/shots/storyboard-table-structure/after/`；走查与键盘测试 |
| ★9 验收与回滚 | 方向检查：`docs/plan/2026-10-06-anchored-popover-focus-direction-check.md`（AnchoredPopover 14 天内第 3 个 fix）。验收：另一条线跑 `pnpm run build && node tests/ux/storyboard-table-structure.walk.mjs`（改回旧实现必红：基线 32 条红（zh 17 / en 15），见 `before/`）+ `pnpm exec vitest run src/workbench/creation/storyboard`。硬门 ⑫（点了 = 以为的）：逃逸账本 AUD-20261005-12、-16、PLAN-S2-06、LAW12-sb-row-more 转 fixed 并带修复 SHA。回滚：revert 本分支的修复提交（无存储迁移、无开关）。残留：英文行宽 735–834px 仍被剪（中文底栏下限刻意取小以保 807px 的批准样张）；最小窗口英文底栏余量约 2px；任意长标签的绝对保证需要底栏内部加最后一档让位（`ShotComposerBar.tsx`，另一条线在改，这里不碰）。独立验收报告：待验收线 | 本文件 + 根因合同 `docs/fixes/2026-10-05-storyboard-table-structure.root-cause.json` |
