# 卡 8：Mac Design Lab 四条失败归因

## 范围与输入

- 诊断分支：`research/card8-mac-lab-failures`，基线 `origin/main`=`dfaefd6303df79bbec13a875feb972921b2b0f05`。
- Mac 走查输入：PR #1009 的 `chore/mac-walkthrough-run`，头提交 `279a82758b9b73c15cb2b51c20dcc685045d7745`。
- Mac 环境记录：macOS，Node `v22.22.0`；`pnpm install`、`pnpm run delivery:preflight`、`pnpm run build:electron` 通过。四条目标脚本各跑两次，原始日志见 [`logs/`](./logs/)；输入说明见 [`input-mac-walkthroughs.README.md`](./input-mac-walkthroughs.README.md)。
- 本环境是 Linux，没有 Mac runner；没有把 Linux 结果冒充 Mac 复跑，也没有执行 Mac bisect。提交定位使用只读 `git log -S`/`git show`，结果记录在 [`commands-and-results.txt`](./commands-and-results.txt)。
- #1009 说明截图在 Mac 本机 `tests/ux/shots/`，约 23 MB，未进入提交；本交付因此保留可审计的原始日志和源码/提交证据，没有伪造截图。

## Linux CI 对应 job

PR #1009 的 Quality Gate 总体为 success，但对应的 **E2E Walkthroughs (Linux) job 是 skipped**，不是红也不是绿：[job 页面](https://github.com/aqm857886159/Nomi/actions/runs/37306291963/job/111751764732)显示 `This job was skipped`。

证据链：`.github/workflows/quality-gate.yml:182-189` 只有 `desktop`、`journeys` 或 `canvas == critical` 时才运行该 job；`scripts/validation-policy.mjs:59-67` 将 `docs/` 归为 `docs_only`。#1009 的变更是 `docs/evidence/...`，所以这轮没有 Linux Design Lab 对照结果。这里的“由 docs-only 导致未选中”是根据工作流条件和路径分类作出的推断；job 页面本身只确认 skipped。

## 四条事实与归类

| 走查 | Mac 两次原文结果 | 归类 | 证据与定位 | 修法建议（本卡不实施） |
|---|---|---|---|---|
| `design-lab-ask-card-in-panel` | EN light/dark 的 `spend`、`spend-batch`、`spend-unknown`、`spend-confirmed` 共 8 个组合均报 `Kling 3.0 → 16:9` 重叠；两次日志相同。 | **真实产品问题** | 断言在 `tests/ux/design-lab-ask-card-in-panel.walk.mjs:168-187` 量真实矩形。共享生产组件 `src/workbench/generationCanvas/nodes/InlineParameterBar.tsx:491-520` 当前只给内层 model/variant chip shrink 规则，`identityRow` 外层仍可缩。提交 `70ebda21e` 曾把同一层加上 `identityChipClass`（提交说明写明该 EN 重叠根因）；`d12adcce1` 又删除该类并保留重叠断言，当前行为与 Mac 证据一致。 | 恢复 `identityRow` 外层的 `identityChipClass`（或等价 `shrink-0`），保留现有矩形重叠断言。涉及 `src/workbench/generationCanvas/nodes/InlineParameterBar.tsx`；共享组件会影响画布/付费卡布局，需按现有 chips 规则回归。 |
| `design-lab-catalog-liveness` | 明暗各报 `expected one unlisted note`、`unlisted model was enabled`、`manual enable failed`，每次共 6 条；行本身均渲染到 `960×720`。 | **脚本过期** | 脚本 `tests/ux/design-lab-catalog-liveness.walk.mjs:7-15` 仍查旧文案，并假定 unlisted 初始 disabled。现行文案是 `供应商清单里暂时没有它`（zh）/`Not in the provider's list right now`（en），由 `037187744` 改名；`electron/catalog/modelListReconcile.ts:20-36` 由 `11e0ec754` 明确只写 `unlisted`、不改用户 `enabled`。夹具 `src/devlab/designLab/catalogLiveness/states/01-listing.tsx:18-22` 明确把各行初始化为 `enabled: true`。 | 只更新 `tests/ux/design-lab-catalog-liveness.walk.mjs`：用当前本地化/稳定标记定位旁注；先断言 DeepSeek 保持用户已有 enabled，再测试显式切换和删除。不要回滚 `037187744` 或 `11e0ec754` 的产品合同。 |
| `design-lab-node-composer-bar` | 前五格均报 `现役 composer 卡应有 1 张，实际 0`；chips 与两格 panel 通过；两次日志相同。 | **脚本/实验室就绪时序过期（Mac 调度暴露）** | 失败断言在 `tests/ux/design-lab-node-composer-bar.walk.mjs:79-84`。夹具已预热 lazy chunk（`src/devlab/designLab/nodeComposerBar/nodeComposerBarLabKit.tsx:96-106,158-180`），但生产 `BaseGenerationNode.tsx:221-223,509-510` 自 `6a38dedcbb` 起用 `React.useDeferredValue` 延后挂 composer；共用走查只在 `tests/ux/design-lab/walkScreen.mjs:37-39` 等 `__designLabReady` 的两帧 rAF，没有等待 deferred composer。Mac 运行时断言先于卡挂载，不能据此证明生产组件最终不渲染。 | 在 Design Lab 夹具登记 ready hold，或在该屏截图/断言前等待 composer locator；不要通过改生产 deferred 策略来“修”证据时序。涉及 `src/devlab/designLab/nodeComposerBar/nodeComposerBarLabKit.tsx`、`tests/ux/design-lab-node-composer-bar.walk.mjs`/共用 ready 流程。 |
| `design-lab-settings` | 隐私四格通过；新增的 `assisted-01-idle` 至 `assisted-06-failed-dark` 每格都报“不在 EXPECTED_STATE 里认领”，各跑两次共 6 条；六格舞台均正常出图。 | **脚本过期** | `tests/ux/design-lab-settings.walk.mjs:18-23,34-39` 的 `EXPECTED_STATE` 只有四个 privacy id。`src/devlab/designLab/settings/settingsStates.tsx:9-11` 已拼入 `ASSISTED_ONBOARDING_STATES`；六格由 `755cfe68d` 新增，id 在 `src/devlab/designLab/settings/states/02-assisted-onboarding.tsx:60-170`。日志显示每格有非空尺寸，失败只发生在 map 缺项。 | 在 `tests/ux/design-lab-settings.walk.mjs` 补六个 assisted id 的期望状态，或让期望值与状态元数据共用单一注册源；不改 `AiAssistedOnboardingCard` 产品组件。 |

## 禁区影响

本交付只新增 `docs/evidence/2026-10-05-mac-lab-failures/` 证据文件；没有改基线、产品代码、走查断言或校准数据。后续修复建议也不触碰任务板列出的禁区：`electron/capabilityCore/mcp*`、`electron/productionRun/`、`src/workbench/generationCanvas/runner/`、`src/workbench/generationCanvas/spend/`、`electron/capabilityCore/appIntegration*`、`src/workbench/generationCanvas/nodes/director/`、`scripts/fix-churn.mjs`、`scripts/self-written*`、`scripts/check-direction-trailer.mjs`、`docs/engineering/rules.json`、`self-written.json`、`concept-owners.json`。

未观察到需要单独归为“Mac 操作系统产品问题”的证据：Mac 是失败观察环境；第一条由共享生产布局和可复现提交回退解释，后三条由走查脚本/就绪契约与现行源码不一致解释。Linux job skipped，不能从本轮 CI 推导跨平台绿/红。
