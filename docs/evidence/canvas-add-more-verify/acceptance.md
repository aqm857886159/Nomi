验收结论：通过
验收 SHA：8e73fd2f899cda33705b30d880e40c3c715e68b8
验收线：canvas-add-more-verify
实现线：codex-astra-1685
verified_sha: 8e73fd2f899cda33705b30d880e40c3c715e68b8

## 1. 验收概览与范围核查

- 待验分支：`fix/canvas-toolbar-more-menu-occlusion`（增量重签 HEAD `8e73fd2f899cda33705b30d880e40c3c715e68b8`，前序完整验收基线 `3bcc351f730688df011c28ab44be7aa754d78cb8`，分支基线 `8ac07cffb`）
- 改动摘要（14 个文件，`370 insertions(+), 134 deletions(-)`）：
  - 生产代码：`src/workbench/generationCanvas/components/CanvasToolbar.tsx` 与 `src/workbench/generationCanvas/components/CanvasEmptyState.tsx` 统一由 `CanvasMoreAddMenu` 经设计系统 `AnchoredPopover`（`align="end" side="top" gap={12}`）挂载 Portal，删除原内联定位与手动文档监听，并补齐 `if (!canvasActive) return null` 与非激活态收起联动。
  - 回归测试与走查：`src/workbench/generationCanvas/components/CanvasToolbar.moreMenu.test.tsx`、`tests/ux/runninghub-onboarding.walk.mjs`。
  - 工程治理：`docs/engineering/concept-owners/canvas.add-more-menu.json`、`docs/fixes/2026-11-25-canvas-toolbar-more-menu-occlusion.root-cause.json`、`docs/plan/2026-11-25-canvas-toolbar-more-menu-occlusion.md` 及 7 张对比证据图。
- 隐私与路径泄露核查：对 `origin/main...3bcc351f730688df011c28ab44be7aa754d78cb8` 文本 diff 及本报告做路径模式扫描，**0 命中**（不含本机主目录、临时目录或工作树路径）；真实付费模型调用 **0 次**。

## 2. 定向测试、静态门岗与真窗口走查结果（全部通过）

| 项 | 命令 | 结果 |
| --- | --- | --- |
| 定向单测与 Playwright 浏览器回归 | `VITEST_MAX_WORKERS=1 npx vitest run src/workbench/generationCanvas/components/CanvasToolbar.moreMenu.test.tsx src/design/outsidePress.structure.test.ts src/workbench/generationCanvas/components/canvasToolbarModel.test.ts` | `EXIT=0`（3 文件，27/27 PASS：`outsidePress.structure.test.ts` 17/17、`canvasToolbarModel.test.ts` 9/9、`CanvasToolbar.moreMenu.test.tsx` 1/1） |
| 改动文件增量 Lint | `NOMI_BASE_REF=origin/main node ./scripts/lint-changed.mjs` | `EXIT=0`（4 个改动文件，0 errors） |
| 概念 Owner 写口门岗 | `node ./scripts/check-concept-owners.mjs` | `EXIT=0`（409 个概念，0 新增第二写口，`canvas.add-more-menu` 已登记收敛） |
| 根因合同门岗 | `node ./scripts/check-root-cause-contracts.mjs` | `EXIT=0`（PASS） |
| 临时目录静态检查 | `pnpm run check:test-temp-static` | `EXIT=0`（27/27 PASS） |
| 测试等待门岗 | `pnpm run check:test-waits` | `EXIT=0`（14/14 PASS，`Station wait baseline: 584; new/stale: 0`） |
| 生产构建（对齐真窗口产物） | `pnpm run build` | `EXIT=0`（renderer + electron 构建完成） |
| 真 Electron 窗口走查 | `node tests/ux/runninghub-onboarding.walk.mjs` | `EXIT=0`（`video`: 5 项、`model3d`: `['混元3D v3.1', 'Meshy 6']`、`DONE`，静默守护确认 `没抢前台`，工作树干净） |

## 3. 设计卡 ★9 逐条核对表

| ★9 验收项 | 验证方式与证据 | 结论 |
| --- | --- | --- |
| 生成框与底栏 dock 重叠时 `+` 按钮仍可点，展开菜单不被 `clip-path` 裁切 | `CanvasToolbar.moreMenu.test.tsx` 实测 `getComputedStyle(dock).clipPath` 匹配 `^path\(` 且 `dock.locator('[role="menu"]').count() === 0`；真窗截图 `after-zh-light.png`、`after-en-dark.png`、`after-zh-narrow-1100x690.png` 均完整悬浮在生成框之上 | 通过 |
| 中亮、英暗及 `1100×690` 中文窄窗四项菜单无截断、无溢出 | 已亲眼逐张 Read 7 张仓库截图（见第 5 节），四项（导演台 / 3D 模型 / 全景图 / 画板 及英文对应项）完整清晰落窗内 | 通过 |
| 点击 3D 模型仅新增 1 个节点并自动收起菜单 | `CanvasToolbar.moreMenu.test.tsx` 实测点击 `[data-node-kind="model3d"]` 后输出 `video,model3d:0` 且菜单数归 0；`after-zh-light-clicked.png` 实见新增单个 3D 模型节点且菜单已收起 | 通过 |
| 再次点 `+`、外点、Escape 及切离画布均可关闭且不吞键盘事件 | `CanvasToolbar.moreMenu.test.tsx` 实测再次点 `+` 分离卸载、画布隐藏后菜单卸载且后续 `Escape` 正常透传（`video,model3d:1`）；`outsidePress.structure.test.ts` 17/17 验证 `AnchoredPopover` 共享外点/Escape 边界 | 通过 |
| 空态「更多」复用 `CanvasMoreAddMenu` + `AnchoredPopover` | 代码核对 `CanvasEmptyState.tsx` 已删除内联绝对定位包裹层，统一传 `anchorRef={moreAnchorRef}` 至 `CanvasMoreAddMenu`，点击项仍走 `addIntent.run(intent)` | 通过 |
| 隔离资料真窗口完成视频与 3D 模型选择器走查 | 在 `3bcc351f7` 构建产物上实跑 `node tests/ux/runninghub-onboarding.walk.mjs` 通过（`EXIT=0`，`DONE`，`没抢前台`） | 通过 |
| 双变异反例自证（内联退回 / 吞掉 `onPick` 均必红） | 见第 4 节，变异 A 与变异 B 均在 `CanvasToolbar.moreMenu.test.tsx` 精准报红，还原后全绿且工作树零残留 | 通过 |

## 4. 双变异反例自证（FAIL → PASS）

### 变异 A：退回内联渲染（去除 `AnchoredPopover` Portal）

- **变异操作**：在 `src/workbench/generationCanvas/components/CanvasToolbar.tsx` 中临时将 `CanvasMoreAddMenu` 的 `<AnchoredPopover ...>` / `</AnchoredPopover>` 替换为普通 `<div>` / `</div>`。
- **必红结果（FAIL）**：`MUTATION_A_RED_EXIT=1`
  - 精准命中 `CanvasToolbar.moreMenu.test.tsx:61:57`：`AssertionError: expected 1 to be +0`（`dock.locator('[role="menu"]').count()` 实得 `1`，捕获菜单退回受裁切 dock 子树）。
- **还原复跑（PASS）**：`git checkout -- src/workbench/generationCanvas/components/CanvasToolbar.tsx` 后重跑 `CanvasToolbar.moreMenu.test.tsx`，`MUTATION_A_GREEN_EXIT=0`（1/1 PASS）。

### 变异 B：破坏 `onPick` 选择回调（吞掉 `onPick(intent)`）

- **变异操作**：在 `src/workbench/generationCanvas/components/CanvasToolbar.tsx` 中临时将 `<CanvasAddSectionList sections={canvasMoreAddSections(preference)} onPick={onPick} />` 改为 `onPick={() => {}}`。
- **必红结果（FAIL）**：`MUTATION_B_RED_EXIT=1`
  - 精准命中 `CanvasToolbar.moreMenu.test.tsx:66:56`：`AssertionError: expected 'video:0' to be 'video,model3d:0'`（捕获点击 3D 模型未落地创建节点）。
- **还原复跑（PASS）**：`git checkout -- src/workbench/generationCanvas/components/CanvasToolbar.tsx` 后重跑 `CanvasToolbar.moreMenu.test.tsx`，`MUTATION_B_GREEN_EXIT=0`（1/1 PASS），`git status -s` 为空（零残留）。

## 5. 亲眼看图逐张核验结论（7/7）

全部 7 张仓库截图均已直接 Read 核验，无任何本地路径泄露：

1. `docs/evidence/canvas-add-more-verify/before-zh-light.png`（复现基线）：选中视频节点后生成框覆盖底栏左侧，`+` 可见；展开的旧内联菜单被底栏 `clip-path` 截断，仅在 `+` 上方露出一道极窄白边，4 个空间项全部不可见。
2. `docs/evidence/canvas-add-more-verify/after-zh-light.png`（中文亮色修复后）：「空间」菜单完整悬浮于生成框之上，右缘对齐 `+` 按钮，「导演台 / 3D 模型 / 全景图 / 画板」四项文字、图标与边框阴影清晰完整，无截断、无溢出。
3. `docs/evidence/canvas-add-more-verify/after-zh-light-clicked.png`（中文亮色点击 3D 后）：画布上成功落盘单个「3D 模型节点」，弹出菜单已收起，底栏交互状态与悬停提示「更多」恢复正常。
4. `docs/evidence/canvas-add-more-verify/before-en-dark.png`（英文暗色基线）：同款截断缺陷在暗色主题下稳定复现，仅余底栏 `+` 上方极窄一条边。
5. `docs/evidence/canvas-add-more-verify/after-en-dark.png`（英文暗色修复后）：「Space」菜单（「Director / 3D model / Panorama / Whiteboard」）完整悬浮在暗色生成框之上，暗色 token 对比度、边距与阴影正常，无截断、无溢出。
6. `docs/evidence/canvas-add-more-verify/before-zh-narrow-1100x690.png`（`1100×690` 中文窄窗基线）：窄窗下同款截断复现，菜单被完全裁掉。
7. `docs/evidence/canvas-add-more-verify/after-zh-narrow-1100x690.png`（`1100×690` 中文窄窗修复后）：窄窗下「空间」菜单四项仍完整落在可视窗口与生成框上方，无顶边/右边溢出或文字截断。

## 6. 增量修补重签核验（`930bc55b5..8e73fd2f899cda33705b30d880e40c3c715e68b8`）

- 增量范围确认（仅 2 个文件，`32 insertions(+), 7 deletions(-)`，0 路径泄露）：
  - `src/workbench/generationCanvas/components/CanvasToolbar.tsx`：底栏调用 `CanvasMoreAddMenu` 传入 `anchorRect`（`r.width + 4`）还原底栏右缘对齐；`CanvasMoreAddMenu` 增加 `menuRef` + `tabIndex={-1}` + `useLayoutEffect` 在激活态把初始焦点落到 `role="menu"` 容器，消除首项「导演台」伪 `:focus-visible` 焦点框。
  - `src/workbench/generationCanvas/components/CanvasToolbar.moreMenu.test.tsx`：改为经 `window.__hideCanvas` 切换画布激活态并用 `expect.poll` 等待输出与 `aria-expanded="false"` 提交，消除 Linux CI 异步状态提交竞态。
- 增量复跑门岗（4/4 通过，均于 `8e73fd2f899cda33705b30d880e40c3c715e68b8` 实跑）：
  - `VITEST_MAX_WORKERS=1 npx vitest run src/workbench/generationCanvas/components/CanvasToolbar.moreMenu.test.tsx src/design/outsidePress.structure.test.ts`：`EXIT=0`（2 文件，18/18 PASS）
  - `NOMI_BASE_REF=origin/main node ./scripts/lint-changed.mjs`：`EXIT=0`（4 个改动文件，0 errors）
  - `node ./scripts/check-concept-owners.mjs`：`EXIT=0`（409 个概念，0 新增第二写口）
  - `node ./scripts/check-root-cause-contracts.mjs`：`EXIT=0`（PASS）

## 7. 未验证边界（如实标注）

- 空态起步行（`CanvasEmptyState`）点击「更多」创建白板且不与下方拖入提示相交的实窗交互本次未单独再起一轮真 Electron 截图，依托 `CanvasEmptyState.tsx` 代码复核（与底栏共用同一 `CanvasMoreAddMenu` + `AnchoredPopover` 向上展开组件）及实现线记录，标为 `unverified（独立线真窗仅复跑 runninghub-onboarding.walk.mjs）`。
- Linux / Windows 桌面端真窗渲染未在本次 macOS 本机环境覆盖，标为 `unverified`。
