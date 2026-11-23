t8-r1-verify：通过

## 验收元信息

- 任务：T-8-R1（3 处手写右键菜单迁入 `WorkbenchMenu` 并同步收紧结构棘轮）
- 验收线：t8-r1-verify
- 实现线：l-paid-quota-unverified
- 验收 HEAD：53750a05b1a87a70632e8c4af1a1e2c5aa197485
- 实现分支：`refactor/context-menus-workbench-menu`
- 验收分支：`accept/t8-r1-context-menus`（仅追加本验收报告文件，未修改任何实现或测试代码）

## 1. 硬边界、零冲突与删旧核查

- **改动范围（共 11 个文件，相对 `origin/main`）**：
  - `src/design/menu.tsx`、`src/design/AnchoredPopover.tsx`
  - `src/workbench/creation/DocumentListSidebar.tsx`、`src/workbench/sidebar/CategoryTree.tsx`、`src/workbench/generationCanvas/nodes/director/timeline/TimelineContextMenu.tsx`、`src/workbench/generationCanvas/nodes/director/timeline/CLAUDE.md`
  - `src/design/contextMenusMigration.characterization.test.tsx`、`src/design/outsidePress.structure.test.ts`、`src/workbench/modalInputLayerCensus.test.ts`、`src/workbench/pageLayerCensus.test.ts`
  - `docs/evidence/2026-11-23-t8-r1-context-menus/perf-canvas-create-node-burst.json`
- **禁碰文件检查**：`package.json`、`pnpm-lock.yaml`、`docs/engineering/self-written.json`、`CLAUDE.md`、`AGENTS.md`、`docs/engineering/rules.json` 均 **0 命中**。
- **在途 PR 重叠检查**：扫描当前全部 22 个 open PR（`gh pr list --state open --limit 50`），与上述 11 个文件 **0 重叠**。
- **旧手写实现彻底删除**：对三处迁入文件执行 `git grep` 检索 `createPortal|BodyPortal|addEventListener|canvasWindowInput`，结果均为 **0 残留**；无并行版与 fallback。

## 2. 四处结构棘轮 / 台账收紧核对

逐项核对 `git diff`：

1. `src/design/outsidePress.structure.test.ts`：`BUBBLE_PRESS_BASELINE` 从 **4 → 2**（移除 `src/workbench/creation/DocumentListSidebar.tsx`、`src/workbench/sidebar/CategoryTree.tsx`）。
2. `src/workbench/modalInputLayerCensus.test.ts`：`GLOBAL_LISTENERS` 移除 `src/workbench/creation/DocumentListSidebar.tsx`、`src/workbench/sidebar/CategoryTree.tsx`（**−2**）。
3. `src/workbench/pageLayerCensus.test.ts`：`BODY_PORTALS` 移除 `src/workbench/creation/DocumentListSidebar.tsx`、`src/workbench/generationCanvas/nodes/director/timeline/TimelineContextMenu.tsx`（**−2**）。
4. `src/design/AnchoredPopover.tsx`：菜单定位清单从 **8 → 7**，三处全部归入 ② `menu.tsx`。

## 3. 独立重跑测试与全套门岗

- **5 份 Vitest 实跑（5 passed / 42 passed，0 failed）**：
  - `src/design/contextMenusMigration.characterization.test.tsx`：10 passed（覆盖三处右键菜单、`v0.24.1` 老项目升级、方向键跳禁用项、仅外部 `pointerdown` 关闭、`Escape` 阻断冒泡、未禁用危险项 `data-danger` 高权重红色与禁用态灰字）
  - `src/design/menu.structure.test.ts`：2 passed
  - `src/design/outsidePress.structure.test.ts`：7 passed
  - `src/workbench/modalInputLayerCensus.test.ts`：10 passed
  - `src/workbench/pageLayerCensus.test.ts`：13 passed
- **6 项仓库门岗独立复跑全绿**：
  - `node scripts/lint-changed.mjs`：通过（9 个改动文件，0 errors，warnings 不高于 `origin/main`）
  - `pnpm run check:filesize`：通过
  - `pnpm run check:tokens`：通过
  - `pnpm run check:dangling-tailwind`：通过（0 悬空债，9/9 单测通过）
  - `pnpm run check:i18n`：通过（22/22 单测通过，6622 键对齐与引用无漏）
  - `node scripts/typecheck.mjs --incremental`：通过（5/5：`tsc app`、`tsc electron`、`tsc electron-pi`、`tsc fixtures`、`check:test-types`）
- **性能证据复核**：`docs/evidence/2026-11-23-t8-r1-context-menus/perf-canvas-create-node-burst.json` 中位数 `63.8ms` / p95 `64.2ms` ≤ 预算 `100ms`，长任务 `0`。

## 4. 破坏性变异实证（M1–M3：必红 → 恢复全绿）

1. **M1（移除 `src/design/menu.tsx` 中 `onEscapeKeyDown` 的 `event.stopPropagation()`）**：
   - 结果：**实跑爆红**（`1 failed | 9 passed`）
   - 失败断言：`src/design/contextMenusMigration.characterization.test.tsx:974` — `按 Esc 关闭菜单时阻断事件继续冒到 window，不连带关掉外层抽屉（如 ShellRail）`（`expected "vi.fn()" to not be called at all, but actually been called 1 times`）。
2. **M2（移除 `src/design/menu.tsx` 中 `data-danger` 属性）**：
   - 结果：**实跑爆红**（`1 failed | 9 passed`）
   - 失败断言：`src/design/contextMenusMigration.characterization.test.tsx:994` — `危险项（未禁用）挂 data-danger 与高权重红色类，禁用态不挂 data-danger（不被 itemClassName 文字色覆盖）`（`expect(enabledDelete.hasAttribute('data-danger')).toBe(true)` 返回 `false`）。
3. **M3（在 `src/workbench/sidebar/CategoryTree.tsx` 回注 `window.addEventListener('click', ...)`）**：
   - 结果：**双门岗同时爆红**（`2 failed | 15 passed`）
   - 失败断言 ①：`src/design/outsidePress.structure.test.ts:113` — `冒泡阶段的 pointerdown / click 只许减不许增`（`src/workbench/sidebar/CategoryTree.tsx` 计数期望 `0` 实得 `1`）。
   - 失败断言 ②：`src/workbench/modalInputLayerCensus.test.ts:272` — `每个全局输入监听都已分类；表里没有过期的`（多出未登记项 `"src/workbench/sidebar/CategoryTree.tsx"`，`37 !== 36`）。
4. **恢复生产代码后复跑**：`git checkout -- src/design/menu.tsx src/workbench/sidebar/CategoryTree.tsx` 后重跑上述 3 份测试文件，**3 passed / 27 passed**，工作区干净。

## 5. 老用户升级验证（`v0.24.1`）

- 复核并实跑 `src/design/contextMenusMigration.characterization.test.tsx` 中 `老用户升级（★1c）` 用例：真实加载 `tests/fixtures/old-user-data/projects/v0.24.1-storyboard/project/.nomi/project.json` 与 `tests/fixtures/old-user-data/projects/v0.24.1-pending-asset/project/.nomi/project.json`，验证老项目文稿、分镜方案、分类与节点右键菜单均可正常打开并执行动作（含复制方案），且 store 零瞬态菜单字段落盘污染。

## 6. 真机中英文 8 张截图逐张人工审图

已逐张读取并核验全部 8 张真机 Electron 截图（`zh-CN` / `en` 两轨）：

- `01-doc-list-menu.zh-CN.png` / `01-doc-list-menu.en.png`：单文稿右键菜单「重命名 / Rename」呈正常深色文字，「删除原稿 / Delete draft」处于禁用灰字态，无错位或乱码。
- `01b-storyboard-menu.zh-CN.png` / `01b-storyboard-menu.en.png`：分镜方案右键菜单「重命名 / Rename」「复制方案 / Duplicate plan」呈正常文字，未禁用的「删除方案 / Delete plan」明确呈危险红色，未受 `itemClassName` 文字色覆盖。
- `02-category-tree-menu.zh-CN.png` / `02-category-tree-menu.en.png`：节点行右键菜单「复制 / Duplicate」「重命名 / Rename」「重新生成衍生 / Regenerate derivative」呈正常深色文字，未禁用的「删除 / Delete」明确呈危险红色。
- `03-director-timeline-menu.zh-CN.png` / `03-director-timeline-menu.en.png`：3D 导演台深色主题下，底缘触发时间轴轨道菜单时自动向上碰撞翻转，完整无裁切；英文轨全部文案为英文、零中文泄漏。

## 结论

所有硬边界、结构棘轮、破坏性变异反例、老用户升级兼容、单测/门岗与真机双语视觉核验均满足要求，无阻塞缺陷，签发 **通过**。
