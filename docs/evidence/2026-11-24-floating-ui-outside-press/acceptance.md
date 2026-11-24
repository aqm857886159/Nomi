t8-r5-verify：通过

- 验收线：t8-r5-verify
- 实现线：t8-r5-impl
- 验收 HEAD：f3399dff06c5b8ec7bd096eb323458c4bbc0b1b0
- 设计卡：`docs/plan/2026-11-24-floating-ui-outside-press.md`
- 提交栈：`f065fb62a`（特征测试前置提交）→ `0ca9e8c39`（迁移 `@floating-ui/react@0.27.20` 并同提交删除 `src/design/outsidePress.ts`）→ `ed93e5473`（无冲突并入最新 `origin/main` `6c09b7510`）→ `f3399dff0`（`vite.config.ts` 与 `src/dev/optimizeDepsEntry.ts` 补齐 `@floating-ui/react` 预构建入口，`scripts/viteOptimizeDeps.test.mjs` 2/2 通过）

## 1. 两步提交顺序、同提交删旧与量化核查

- **Commit 1（`f065fb62a`）**：仅新增 `src/design/floatingDismiss.characterization.test.tsx`（465 行），先于生产改动锁定外点捕获按下、触发钮/弹层排除、Portal 排除及关闭态零监听语义。
- **Commit 2（`0ca9e8c39`）**：
  - 精确锁定依赖 `"@floating-ui/react": "0.27.20"`（无 `^` / `~`）；
  - 在 `src/design/overlayLayers.ts` 建立唯一出口 `useFloatingOutsideDismiss`（委托 `@floating-ui/react` 的 `useFloating` + `useDismiss` + `useInteractions`，固定 `outsidePressEvent: 'pointerdown'`、`capture: { outsidePress: true }`、`escapeKey: false`），迁移全部 9 个生产消费者（`AnchoredPopover.tsx`、`ShellRail.tsx`、`NomiBrowserDialog.tsx`、`NomiBrowserAssetPopover.tsx`、`AssetLibraryPanel.tsx`、`useCanvasFrameActions.ts`、`EditingLayoutMenu.tsx`、`TimelinePreview.tsx`、`TaskCenterPanel.tsx`）；
  - **同提交删除 `src/design/outsidePress.ts`**（文件已不存在），`git grep -n 'listenOutsidePress' src/ electron/` 生产代码 0 残留（仅 1 条说明注释与结构测试断言自身）；
  - `docs/engineering/self-written.json` 删除 `"outside-press-listener"`，`to-replace` 条目 **`4 → 3`**，总条目 **`65 → 64`**；
  - `src/workbench/modalInputLayerCensus.test.ts` 删除 `'src/design/outsidePress.ts'` 登记项，`GLOBAL_LISTENERS` **`35 → 34`**；
  - `docs/engineering/concept-owners/ui.outside-press-dismiss.json` 与 `scripts/boundary-owners-ledger.json` 同步改锚至 `src/design/overlayLayers.ts::useFloatingOutsideDismiss`。
- **路径泄露检查**：`origin/feat/unified-undo-6a-timeline-layout..0ca9e8c39` 全部新增行 0 本机路径泄露。

## 2. 独立故障变异验证（必红拦截 → 还原后全绿）

- **M1（退回冒泡 `mousedown`）**：在 `src/design/overlayLayers.ts:257-258` 临时将 `outsidePressEvent: 'pointerdown'` / `capture: { outsidePress: true }` 改为 `'mousedown'` / `capture: { outsidePress: false }` → 实跑 `outsidePress.structure.test.ts` + `floatingDismiss.characterization.test.tsx` 立即触发 **`EXIT=1`（2/2 测试文件失败，5/23 用例红灯**：结构门岗 `owner 经 @floating-ui/react 的 useDismiss 在捕获阶段听 pointerdown` 红 + 4 项真浏览器外点收起用例红）。
- **还原与全量复跑**：`git checkout -- .` 还原后工作树干净，复跑 4 套核心 Vitest（`--maxWorkers=2`）全部 **4/4 文件，47/47 通过（`EXIT=0`）**：
  - `src/design/floatingDismiss.characterization.test.tsx`（6/6）
  - `src/design/outsidePress.structure.test.ts`（17/17）
  - `src/design/anchoredPopoverPlacement.test.ts`（14/14）
  - `src/workbench/modalInputLayerCensus.test.ts`（10/10）

## 3. 8 项串行静态与治理门岗实跑证据（全部 `EXIT=0`）

| 门岗命令 | 结果 | 关键摘要 |
|---|---|---|
| `./node_modules/.bin/tsc -p tsconfig.app.json --noEmit` | PASS | `0` 错误 |
| `./node_modules/.bin/tsc -p electron/tsconfig.json --noEmit` | PASS | `0` 错误 |
| `node scripts/check-test-types.mjs` | PASS | `src/` `0` 错，agent-runtime `0` 错，存量 10 棘轮未增 |
| `NOMI_BASE_REF=origin/main node scripts/check-self-written.mjs` | PASS | 177 领域目录 · 64 项登记 · 新增代码文件 3 个（0 未认领） |
| `node scripts/check-boundary-owners.mjs` | PASS | 声明 2137 条：在位 1873 / 改锚 82 / 退役 87 |
| `pnpm run check:concept-owners` | PASS | 58/58 自测通过，401 概念，第二写口 `0` 新增 |
| `pnpm run check:filesize` | PASS | `0` 红牌，33 个冻结基线棘轮未增，`overlayLayers.ts` 无黄牌 |
| `NOMI_BASE_REF=origin/main node scripts/lint-changed.mjs` | PASS | 65 个改动文件，0 错误，警告不增 |

## 4. 真隔离 Electron 双语截图目视核验

核查 `docs/evidence/2026-11-24-floating-ui-outside-press/` 下 12 张前后对照截图与 `walkthrough.md`，并逐张 `read_file` 亲眼目视确认：
- `01/02-task-center-{open,dismissed}.zh-CN.light.png`：任务中心浮卡打开后点击画布平移面干净收起，无残留 Tooltip。
- `03/04-canvas-view-options-{open,dismissed}.zh-CN.light.png`：画布左下「视图选项」`AnchoredPopover` 打开后点击画布平移面干净收起，布局零变化。
- `05/06-editing-layout-{open,dismissed}.en.light.png`：预览顶栏英文「Layout」菜单打开后点击外部空白处干净收起，英文文案与视觉排版与改前完全一致（`internal-no-visible-change`）。
