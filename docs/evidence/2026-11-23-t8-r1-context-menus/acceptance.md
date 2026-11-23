v-1609-accept：通过

## 验收元信息

- 任务：PR #1628（T-8-R1 路线 A：`WorkbenchMenu` / `WorkbenchContextMenu` 单内核双入口 + 3 处右键行与导演台「+」真触发器迁移 + `GenerationPageLayer` 捕获穿透修复 + `@radix-ui/react-context-menu` Vite 预打包登记）
- 验收线：v-1609-accept
- 实现线：opus-1628-menu
- 验收 HEAD：e98cb581df5d59b4b4a1f421cd565afc297d9906
- 实现分支：`refactor/context-menus-workbench-menu`
- 验收分支：`verify/pr-1628-final`（仅追加本验收报告更新，未修改任何实现或测试代码）

## 0. `e98cb581df5d` 增量补丁独立复验（`v-1609-accept`）

- **增量 diff 逐行核查（`e98cb581df5d59b4b4a1f421cd565afc297d9906`）**：仅新增 2 行（`src/dev/optimizeDepsEntry.ts` 增加 `import '@radix-ui/react-context-menu';`，`vite.config.ts` 的 `optimizeDeps.include` 增加 `'@radix-ui/react-context-menu'`），确保 `noDiscovery` 开发服务预打包完整；全 diff `origin/main...HEAD` 本机路径与工作树前缀扫描 **0 泄露**。
- **独立复跑 3 套目标 Vitest（3 passed / 16 passed，0 failed）**：
  - `scripts/viteOptimizeDeps.test.mjs`：**2 passed**（验证渲染进程直接依赖均已预打包进 `optimizeDeps.include` 或位于冻结清单，不再漏掉 `@radix-ui/react-context-menu`）
  - `src/design/menu.structure.test.ts`：**4 passed**（单内核结构门岗、`PERMANENT_POINT_CALLERS`、`LEGACY_FROZEN_POINT_CALLERS` 与跨文件 `onClick` 转传禁令全绿）
  - `src/design/contextMenusMigration.characterization.test.tsx`：**10 passed**（含 `v0.24.1` 老项目升级、`Escape` 阻断冒泡、`data-danger` 权重回归）

## 1. 基线实现（`0c927831ae3d`，先由独立线 `v-1612-accept` 全量核验）摘要

> `0c927831ae3dee9016f086b4fe151eeb92298ffc` 是 `e98cb581df5d59b4b4a1f421cd565afc297d9906` 的直接祖先，期间仅追加上述 2 行 Vite 预打包登记。

- **单内核依赖与零冲突核验**：`pnpm why @radix-ui/react-menu` 全仓唯一 `@radix-ui/react-menu@2.1.24`（`@radix-ui/react-context-menu@2.3.7` 与 `@radix-ui/react-dropdown-menu@2.1.24` 共用，无多版本分裂）；旧壳 `src/workbench/generationCanvas/nodes/director/timeline/TimelineContextMenu.tsx` 已删除；未修改 `GenerationCanvasReactFlow.tsx`。
- **结构与台账核验**：`docs/engineering/direction-checks/2026-11-23-workbench-menu-trigger-contract.md`、`docs/engineering/concept-owners/ui.anchored-popup-placement.json`、`src/design/AnchoredPopover.tsx` 与 `src/design/menu.structure.test.ts` 全部在位。
- **8 套单测 / 真 Chromium 浏览器测试（8 passed / 101 passed，0 failed）**：
  - `src/design/menu.structure.test.ts`（4）、`src/design/menuTriggerAndCascade.browser.test.ts`（14，真 Chromium + 编译后 `public/tailwind.generated.css`，含第 14 条 `GenerationPageLayer` Portal 捕获期隔离）、`src/design/menuFocusReturn.browser.test.ts`（17）、`src/design/contextMenusMigration.characterization.test.tsx`（10）、`src/design/outsidePress.structure.test.ts`（7）、`src/workbench/modalInputLayerCensus.test.ts`（10）、`src/workbench/pageLayerCensus.test.ts`（13）、`src/workbench/generationCanvas/nodes/director/directorFunctionCensus.test.ts`（26）。
- **5 项仓库门岗全绿（0 错）**：`check:tokens`（`0/0/0/0`）、`check:dangling-tailwind`（0）、`check:i18n`（OK）、`check:filesize`（通过）、`fix-churn --range origin/main..HEAD`（通过）。
- **性能与真机 8 图核验**：
  - `docs/evidence/2026-11-23-t8-r1-context-menus/perf-category-tree-200.json`（200 行 `CategoryTree`，挂载中位 `13.0ms` / p95 `15.3ms`，右键弹菜单中位 `26.8ms` / p95 `28.8ms`，`canvas-select-composer-empty-200` 中位 `53.5ms` / p95 `64.0ms` ≤ 预算 `100ms`，长任务 `0`）；
  - `docs/evidence/2026-11-23-t8-r1-context-menus/perf-canvas-create-node-burst.json`（中位 `63.8ms` / p95 `64.2ms` ≤ 预算 `100ms`，长任务 `0`）；
  - 全部 8 张 `compare-01..04.{zh-CN,en}.jpg` 与 `style-diff.json`（10 组对照）已逐张核验通过。

## 结论

`e98cb581df5d59b4b4a1f421cd565afc297d9906` 独立复验（`viteOptimizeDeps.test.mjs` + `menu.structure.test.ts` + `contextMenusMigration.characterization.test.tsx` 共 3/3 套 16/16 用例全绿，零路径泄露）与基线全量证据闭环一致，无阻塞缺陷，签发 **通过**。
