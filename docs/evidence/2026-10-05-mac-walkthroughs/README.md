# Mac walkthrough evidence — 2026-10-05

状态：**已实现未推送**（本报告分支）；本报告记录真实走查结果，不把失败或未跑项目标为通过。

## 环境与基线

- 分支：`chore/mac-walkthrough-run`
- 起始基线：`origin/main`，PR #1001 已合入（`aacb7f626`）；提交前将再次合并最新 `origin/main`。
- macOS，Node `v22.22.0`，先执行 `pnpm install`、`pnpm run delivery:preflight`，`pnpm run build:electron` 通过。
- 任务卡所指的 `commands/package.json` 在本仓库不存在；走查入口实际为 `tests/ux/*.walk.mjs`，每个脚本的文件头是命令真源。
- 截图输出目录（本机生成，未把 23MB 的临时截图复制进提交）：`tests/ux/shots/`。失败走查日志保留在本目录 `logs/`，日志中的 `~/...` 路径可直接定位截图。

## 设计卡

改动名：Mac walkthrough 证据清理　线/负责人：`chore/mac-walkthrough-run`　类别：其他

| 格 | 结论 | 证据 |
|---|---|---|
| ★1 用户怎么用 | 当 Mac 审核者要确认 Windows 无法运行的走查实际结果时，我想复跑 Design Lab 与 Director/3D-BOX 走查并查看截图，以便按真实结果审核；5 步为读命令、逐条运行、重复一次、保留失败日志、提交结果表；不改产品、不调用付费模型；已知坑是 Director 走查依赖 renderer/API 环境。 | `tests/ux/*.walk.mjs`、本报告结果表 |
| ★2 谁说了算 | 走查证据与状态归本任务的报告 owner（`chore/mac-walkthrough-run`）；产品状态不在本变更中，协调会话与 PR reviewer 只读消费证据。 | `git diff --name-only origin/main...HEAD`、本报告与 `logs/` |
| ★3 一致与复用 | 复用仓库现有 walkthrough 脚本、命令和截图目录，不新增第二份走查实现或断言。 | `pnpm run check:prior-art`、`git grep -n "walk.mjs" tests/ux package.json` |
| ★4 全状态 | 不适用：本 PR 只清理已生成证据，不新增或修改用户界面状态；观察到的通过、失败、未跑状态逐项列在本报告中。 | 本报告结果表、失败日志 |
| ★9 验收与回滚 | 验收由协调会话复核报告、失败原文、路径与扫描结果；如需回滚，revert 本次证据清理 commit，不触碰产品代码。 | `pnpm run check:prior-art`、`git diff --check`、`pnpm run delivery:preflight` |

## Design Lab（20 条，均跑两次）

| 脚本 | 第 1 次 | 第 2 次 | 截图 / 备注 |
|---|---:|---:|---|
| `design-lab-agent-panel-v4.walk.mjs` | PASS (112) | PASS (112) | `tests/ux/shots/design-lab-agent-panel-v4` |
| `design-lab-ask-card-in-panel.walk.mjs` | FAIL | FAIL | 断言失败；日志保留 |
| `design-lab-canvas-add-menu.walk.mjs` | PASS (3) | PASS (3) | `tests/ux/shots/design-lab-canvas-add-menu` |
| `design-lab-canvas-frame.walk.mjs` | PASS (7) | PASS (7) | `tests/ux/shots/design-lab-canvas-frame` |
| `design-lab-catalog-liveness.walk.mjs` | FAIL (6) | FAIL (6) | 断言失败；日志保留 |
| `design-lab-depth-action.walk.mjs` | PASS (8) | PASS (8) | `tests/ux/shots/design-lab-depth-action` |
| `design-lab-editing.walk.mjs` | PASS (12) | PASS (12) | `tests/ux/shots/design-lab-editing` |
| `design-lab-host-config.walk.mjs` | PASS (1) | PASS (1) | `tests/ux/shots/design-lab-host-config` |
| `design-lab-node-composer-bar.walk.mjs` | FAIL (5) | FAIL (5) | 现役 composer 卡数量断言；日志保留 |
| `design-lab-node-quick-actions.walk.mjs` | PASS (11) | PASS (11) | `tests/ux/shots/design-lab-node-quick-actions` |
| `design-lab-primitives-actions.walk.mjs` | PASS (8) | PASS (8) | `tests/ux/shots/design-lab-primitives-actions` |
| `design-lab-primitives-forms.walk.mjs` | PASS (8) | PASS (8) | `tests/ux/shots/design-lab-primitives-forms` |
| `design-lab-primitives-menu.walk.mjs` | PASS (4) | PASS (4) | `tests/ux/shots/design-lab-primitives-menu` |
| `design-lab-primitives-surfaces.walk.mjs` | PASS (12) | PASS (12) | `tests/ux/shots/design-lab-primitives-surfaces` |
| `design-lab-question-card-generality.walk.mjs` | PASS | PASS | `tests/ux/shots/design-lab-question-card-generality` |
| `design-lab-settings-sound.walk.mjs` | PASS (4) | PASS (4) | `tests/ux/shots/design-lab-settings-sound` |
| `design-lab-settings.walk.mjs` | FAIL (6) | FAIL (6) | 断言失败；日志保留 |
| `design-lab-shot-table.walk.mjs` | PASS (9) | PASS (9) | `tests/ux/shots/design-lab-shot-table` |
| `design-lab-storyboard.walk.mjs` | PASS (39) | PASS (39) | `tests/ux/shots/design-lab-storyboard` |
| `design-lab-vendor-order.walk.mjs` | PASS (11) | PASS (11) | `tests/ux/shots/design-lab-vendor-order` |

共 20/20 脚本完成两次（40 次）；通过 32 次、失败 8 次。失败均原样记录，没有改断言或产品代码。

失败原文（两次输出相同，完整日志在 `logs/`）：

- `ask-card-in-panel`：`failures: en/light/spend：参数条里控件相互压住：Kling 3.0 → 16:9 | en/dark/spend：参数条里控件相互压住：Kling 3.0 → 16:9 | ...`（共 8 个 en light/dark spend 组合）。
- `catalog-liveness`：`✗ catalog-liveness-light: expected one unlisted note`；`✗ catalog-liveness-dark: expected one unlisted note`；最终 `❌ 设计实验室走查失败 6 条`。
- `node-composer-bar`：`✗ composer-bar-v1-video 现役 composer 卡应有 1 张，实际 0 —— 这一格没渲染出真身`（同样错误覆盖 video-camera、image、video-dark、image-dark 五格）；最终 `❌ 设计实验室走查失败 5 条`。
- `settings`：`✗ assisted-01-idle 没有在 EXPECTED_STATE 里认领自己停在哪个状态——补上它，别让这一格无人验证`，同样覆盖 assisted-02-not-connected、assisted-03-progress、assisted-04-failed、assisted-05-idle-dark、assisted-06-failed-dark；最终 `❌ 设计实验室走查失败 6 条`。

## Director / 3D-BOX

本轮先实际启动了第 1 次的前 9 条，随后因真实 Electron 走查在无 renderer/API 配置时长时间等待而停止；**第 2 次以及剩余脚本未运行**，下表明确列出，不能视为完成。

| 脚本 | 第 1 次 | 第 2 次 |
|---|---|---|
| `director-3dbox-3b-agent.walk.mjs` | FAIL：缺少模块 / 环境 | 未跑 |
| `director-3dbox-shell.walk.mjs` | FAIL：缺 `NOMI_WALK_RENDERER_URL` | 未跑 |
| `director-ai.walk.mjs` | FAIL：断言（textarea 仍 enabled） | 未跑 |
| `director-assets.walk.mjs` | FAIL：找不到 chair 资源 | 未跑 |
| `director-clip-states.walk.mjs` | PASS：160 checks / 0 failures | 未跑 |
| `director-electron.walk.mjs` | FAIL：Electron 环境异常 | 未跑 |
| `director-fields.walk.mjs` | FAIL：走查异常 | 未跑 |
| `director-j1-three-person-scene.walk.mjs` | FAIL：撤销重命名状态未到达 | 未跑 |
| `director-j2-walk-to-b.walk.mjs` | FAIL：页面在中断时关闭 | 未跑 |
| `director-j3-three-cameras.walk.mjs` | 未跑 | 未跑 |
| `director-j4-kneel-stand-look.walk.mjs` | 未跑 | 未跑 |
| `director-j5-splat-valley.walk.mjs` | 未跑 | 未跑 |
| `director-j6-outputs.walk.mjs` | 未跑 | 未跑 |
| `director-j7-skeleton.walk.mjs` | 未跑 | 未跑 |
| `director-j8-project-interactions.walk.mjs` | 未跑 | 未跑 |
| `director-mobile.walk.mjs` | 未跑 | 未跑 |
| `director-model-import.walk.mjs` | 未跑 | 未跑 |
| `director-refine-tasks.walk.mjs` | 未跑 | 未跑 |
| `director-timeline-pointer.walk.mjs` | 未跑 | 未跑 |
| `director-waypoint-aim.walk.mjs` | 未跑 | 未跑 |
| `director-windowbar.walk.mjs` | 未跑 | 未跑 |

3D-BOX shell 的正确入口要求先起 Vite renderer，并设置 `NOMI_WALK_RENDERER_URL`；3b-agent 还需要 API key。为避免伪造通过或产生付费调用，本轮仅记录环境失败，不改脚本和断言。日志位于 `logs/`。

## 验证边界

- `pnpm run delivery:preflight`、`pnpm run build:electron` 通过。
- `pnpm run check:walkthroughs` 通过（46 tests；目录门报告 321 份走查）。
- `pnpm run check:full-walk-catalog` 通过（10 tests；10 条旅程 / 54 状态 / 14 剧本）。
- `pnpm run check:walkthrough-tool-args` 通过（105 次调用、370 个键；21 处动态调用如实记账）。
- 本报告没有修改生产代码、走查断言或校准数据。
- Design Lab 失败与 Director 未跑清单是当前 Mac 环境的真实结果；不能宣称卡 2 全绿或所有 Director 脚本均已完成。
