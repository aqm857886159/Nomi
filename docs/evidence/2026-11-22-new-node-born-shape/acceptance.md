hborn-verify：通过

- 验收线：hborn-verify（独立于实现线 `hborn-impl`）
- 验收 HEAD：`cb7688e004f609b663c8466a57544e25f07a7c5b`（分支 `fix/new-node-composer-in-view-2`）
- 验收日期：2026-11-23

## 1. 独立单测与门岗复跑（全部 0 报错通过）

- **核心 7 套 Vitest 单测（7 passed / 47 passed）**：
  - `src/workbench/generationCanvas/store/newNodeBornShape.test.ts`（6/6）
  - `src/workbench/generationCanvas/store/canvasVisibleArea.test.ts`（14/14）
  - `src/workbench/generationCanvas/store/canvasVisibleArea.structure.test.ts`（2/2）
  - `electron/capabilityCore/nodeKindDomain.equivalence.test.ts`（6/6）
  - `src/workbench/generationCanvas/nodes/composerCanvasPlacement.test.ts`（9/9）
  - `src/workbench/generationCanvas/store/canvasDerivedPlacement.visibleArea.test.ts`（3/3）
  - `src/workbench/generationCanvas/store/canvasInsertionOverlap.test.ts`（7/7）
- **合同门岗全绿**：
  - `node scripts/lint-changed.mjs`：17 个改动文件，错误 0
  - `pnpm run check:filesize`：通过
  - `pnpm run check:boundaries`：通过
  - `pnpm run check:self-written`：通过
  - `pnpm run check:perf-scenarios`：91 个场景，通过
  - `pnpm run check:walkthroughs`：108/108 通过

## 2. 独立对抗变异实证（4 项均亲自注入并确认必红，已完整恢复）

| 编号 | 注入变异 | 目标测试 | 结果 |
|---|---|---|---|
| M1 | 将 `src/workbench/generationCanvas/nodes/registry.ts` 与 `electron/capabilityCore/nodeKindDomain.ts` 中 `video` 默认高从 `236` 改回 `340` | `newNodeBornShape.test.ts` | **FAIL**（3 failed / 6：`expected { width: 420, height: 340 } to deeply equal { width: 420, height: 236 }` 及 `1440×960` 上移偏差） |
| M2 | 仅改 `electron/capabilityCore/nodeKindDomain.ts` 中 `video.height` 为 `340`（双表漂移） | `nodeKindDomain.equivalence.test.ts` | **FAIL**（2 failed / 6：默认尺寸与足迹逐 kind 一致断言全红） |
| M3 | 在 `src/workbench/generationCanvas/store/canvasVisibleArea.ts` 的 `visibleInsertionPoint` 将节点高改回 `+ 64`（借用避让足迹） | `newNodeBornShape.test.ts` | **FAIL**（4 failed / 6：`1280×800` 视频 `expected 110 to be 174`、图片 `expected 16 to be 70`） |
| M4 | 在 `src/workbench/generationCanvas/store/canvasVisibleArea.ts` 新增 `node?.kind === "video"` 分支 | `canvasVisibleArea.structure.test.ts` | **FAIL**（1 failed / 2：结构测试命中 `kind ===` 禁用模式） |

恢复后 `git status` 干净，上述测试全部恢复全绿。

## 3. 代码、性能收据与真窗口截图逐项核验

- **代码审阅**：`registry.ts` 与 `nodeKindDomain.ts` 同步更新 `image: 340×340`、`video: 420×236`；`canvasNodeActions.ts` 先 `buildCanvasNode` 再调 `visibleInsertionPoint(categoryId, nextNode)`；`canvasVisibleArea.ts` 统一读 `resolveNodeVisualSize(node).height`，无硬编码尺寸或按 `kind` 分支；`NODE_RENDER_SAFETY = 64` 仅保留在碰撞避让与批量布局。
- **性能原始收据**：`docs/evidence/2026-11-22-new-node-born-shape/perf-canvas-create-node-burst.json`：`runs: 5`，响应中位数 **`63.8ms`** / p95 **`69.5ms`**（预算 `100ms`），长任务 `0`，`dirty: false`，`verdict: ok`。
- **真窗口截图亲眼核对**（`docs/evidence/2026-11-22-new-node-born-shape/`）：
  - `1280×800`（zh 浅色 & en 暗色，视频 + 图片）：改前图片底栏被底部裁断并盖住加节点条、视频底栏压入停靠条；改后四件（标题标签、节点卡、`1:1`/`16:9` 形状、底栏最下行与加节点条）全露且留白清晰，英文暗色零中文串味；
  - `1440×960`（zh 浅色，视频 + 图片）：构图居中自然，无异常上移；
  - `today-old-project.png` vs `after-old-project.png`（25 节点旧项目）：外观逐卡一致，零错位变形；
  - `after-agent-video-16x9.png` / `after-agent-video-9x16.png` / `after-agent-single-video.png` / `after-unselected-empty-video.png`：Agent 6×16:9 与 6×9:16 排卡整洁零重叠，单卡与未选中空视频卡均为自然 16:9 比例。

## 4. 结论

**通过**（零阻断）。
