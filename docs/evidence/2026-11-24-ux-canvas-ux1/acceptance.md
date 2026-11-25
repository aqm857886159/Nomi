结论：通过 · 验收线：ux1-verify · 验收 HEAD：ebaf23a5dc599c57ea5074ebe11d4b91188d438b

- 验收线：ux1-verify
- 实现线：ux-canvas-ux1
- 验收 HEAD：ebaf23a5dc599c57ea5074ebe11d4b91188d438b
- 对应设计卡：`docs/plan/2026-11-24-ux-simple-canvas-ux1.md`
- 方向复盘：`docs/plan/2026-11-24-ux-simple-canvas-ux1-direction-check.md`
- 验收结论：通过（无阻塞缺陷）

## 1. 范围、设计与隐私核查

对照 `origin/main...8f6ef24560eb75cfc4a1fdea045bb2c3187f3799` 全部改动：

- **画布首屏 100% 取景与单选平滑平移入画**：`selectionComposerViewport.ts` 与 `useSelectionComposerPan.ts` 将节点卡片、上方标签/浮条（`initialAbove` 实测/初始高度与 6px 顶边距）及下方固定屏幕像素生成框联合纳入扣除底部停靠条后的可用舞台 `FocusViewRect`；首进与派生按可用区适配缩放（`maxZoom = CANVAS_FOCUS_MAX_ZOOM`），普通单选保持缩放仅平移修正越界，拖动/多选/手势中断均不抢视口。
- **假等待文案修复**：`useNodeRelationships.ts` 复用 `generationReferenceResolver.ts` 的 `waitingForFrameSource`，按真实上游结果与历史产物判断等待态，上游已有可用媒体或超出活跃槽位时不再错误提示「等上游产出」。
- **图片浮条前置「生成视频」、首帧比例自动对齐与标题去重**：`ImageQuickActionsToolbar.tsx` / `ImageQuickActionsToolbarHost.tsx` 将「生成视频」前置为图片浮条首项并与右环共享免费派生事务（生成中/忙态禁用防误触）；`videoAspectSeed.ts` / `canvasConnectDerivations.ts` / `useNodeModelAutoSelect.ts` 在首帧连入、结果落地与换主版本时自动对齐模型可用画幅（如方图 `1:1`）且尊重用户手选标记；`CanvasListLinks.tsx` 消除列表标题重复并保留双语可编辑标题。
- **隐私与干净度核查**：`origin/main..HEAD` 全部提交信息及非 PNG 新增 diff 行扫描本机绝对路径、临时目录路径与私有工作树前缀均 **0 命中**。

## 2. 视觉证据、几何读数与性能核验

已通过 `read_file` 亲眼逐张核对 `docs/evidence/2026-11-24-ux-canvas-ux1/` 下的 6 张核心真隔离 Electron 截图与原始收据：

- `after-zh-light-1280x800.png`（94% 缩放）& `after-en-dark-1280x800.png`（94% 缩放）：顶部 `图片 / Image` 标签、上方动作胶囊、卡片本体、下方生成框与发送钮在亮/暗双轨下 100% 完整在画内，与顶栏、底栏均留有清晰呼吸空间。
- `after-zh-light-1100x690.png`（66% 缩放）：窄高视口下自动缩放完整容纳 `图片` 标签、卡片、生成框与发送钮，零顶部/底部裁切。
- `image-toolbar.png`：已出图图片节点的悬浮工具条首项为「生成视频」（带图标且排在最左），清晰可达。
- `derived-zh-light-1280x800.png`（77% 缩放）：派生视频节点与上游图片以首帧边相连，生成框内显示 `首帧` 缩略标、`参考图 1 张`、`Vidu Q3` 及自动对齐的 `1:1 · 720p · 5s`，无假「等上游产出」等待提示，标签与发送钮均 100% 在画内。
- `dock-ring.png`（68% 缩放）：右侧停靠 Nomi Agent 面板后，可用舞台内仍 100% 容纳派生视频卡片、`视频` 顶标签、`首帧` 槽位、`1:1 · 720p · 5s` 生成框与发送钮，零重叠遮挡。
- **性能收据核验（`docs/evidence/2026-11-24-ux-canvas-ux1/perf.json`）**：`"dirty": false`（`head: cb31c2eb4160741ecb5b2c4e3e0f404c58ea05ba`），`canvas-drag-20-nodes`（I150：150 节点 / 75 边 / 24 选中）5 轮帧间隔 p95 为 `[20.6, 20.2, 20.1, 21.5, 21.9]` ms，中位数 **20.6 ms**（预算 `33 ms`），5 轮长任务均为 **0**；路径 A 完整闭环回放实测点击 10 次、创作决定 5 个、零付费支出、导出 H.264 1920×1080 MP4（4499 字节）。
- **诚实未验证边界**：真实供应商画质与真实账户扣费、Windows 真机与初次盲测找路判断数沿设计卡如实记为 `unverified`。

## 3. 定向门岗与核心单测独立复跑（全部 `EXIT=0`）

严格按资源纪律在隔离验收工作树独立串行复跑定向检查（未跑全量 `gates` / `gates:contracts` / `check:design-lab`）：

- `pnpm run check:filesize`：**PASS**（0 新增红牌）；
- `pnpm run check:controls`：**PASS**（0 违规）；
- `pnpm run check:walkthroughs`：**PASS**（走查质量与锚点棘轮零回归）；
- `pnpm run check:root-cause-contracts`：**PASS**；
- `pnpm run check:board-parity`：**PASS**；
- `pnpm run check:tokens`：**PASS**；
- `pnpm run check:i18n`：**PASS**（23/23 规则单测 + 6740 键中英对齐 + 零悬空引用）；
- `NOMI_BASE_REF=origin/main node scripts/lint-changed.mjs`：**PASS**（26 个改动文件，0 错误，0 新增警告）；
- `./node_modules/.bin/tsc -p tsconfig.app.json --noEmit`：**PASS**（0 错误）；
- 6 套定向 Vitest（`VITEST_MAX_WORKERS=2`：`selectionComposerViewport.test.ts`、`useSelectionComposerPan.test.ts`、`useNodeRelationships.test.ts`、`videoAspectSeed.test.ts`、`imageVideoShortcut.test.tsx`、`storyboardShotLabel.surfaces.test.ts`）：**6/6 文件，61/61 passed**。

## 4. ★9 真实变异故障注入验证（2/2 必红 → 还原 22/22 必绿）

| 编号 | 故障注入方式 | 变异实测（必红） | 还原验证 |
|---|---|---|---|
| M1（假等待文案回归） | 在 `src/workbench/generationCanvas/hooks/useNodeRelationships.ts` 退回旧逻辑强制 `waitingForFrameSource()` 返回 `true` | `useNodeRelationships.test.ts` 退出码 `1`（**2/12 失败**：已出图上游与历史 URL 场景均命中 `expected true to be false`） | `git checkout --` 后复绿 |
| M2（顶标签留白与缩放上限失效） | 在 `src/workbench/generationCanvas/reactFlow/selectionComposerViewport.ts` 将 `initialAbove` 置零并把 `fitEditingBounds` `maxZoom` 放开到 `3` | `selectionComposerViewport.test.ts` 退出码 `1`（**4/10 失败**：顶边距跌破 26px 报 `-37.27` / `5.60` / `-20.43`，记忆视口上裁切返回 `null`） | `git checkout --` 后两套复跑 **22/22 必绿（`EXIT=0`）** |

## 5. 手动全览留白修复增量复验（`ebaf23a5dc599c57ea5074ebe11d4b91188d438b`）

- **增量审阅**：`useSelectionComposerPan.ts` 中 `useCanvasEditingFit` 仅在 `opening === true` 首进适应时预留选中编辑区，手动全览（`opening === false`）保持 `getViewportForBounds(..., 0.12)` 全画布留白，`useSelectionComposerPan.test.ts` 补齐定向单测锁定手动全览与首进适应差异，增量 diff 与提交信息 `0` 本机路径泄露。
- **独立复跑全绿（`EXIT=0`）**：
  - 3 套定向 Vitest（`useSelectionComposerPan.test.ts`、`selectionComposerViewport.test.ts`、`canvasZoomBoundary.test.ts`）：**3/3 文件，23/23 passed**；
  - `node ./scripts/check-root-cause-contracts.mjs`：**PASS**（1 个高风险生产文件均有合同和变化中的回归测试）；
  - `./node_modules/.bin/tsc -p tsconfig.app.json --noEmit`：**PASS**（0 错误）。
