结论：通过 · 验收线：ux-storyboard-verify · 验收 HEAD：b274878cd882312f60a42025fa452fe3c1ef41a2

- 验收线：ux-storyboard-verify
- 实现线：ux-storyboard-impl
- 验收 HEAD：b274878cd882312f60a42025fa452fe3c1ef41a2
- 对应设计卡：`docs/plan/2026-11-24-ux-simple-storyboard-actions.md`
- 验收结论：通过（无阻塞缺陷；干净树性能基线已刷新为 `"dirty": false`）

## 1. 范围、结构与隐私核查

对照 `origin/main...25629d8a969b0f261928aad4f55ec9b59eb2c678` 全部改动（含首轮 `662b42e2d`、`69b065202`、`80e6fc2f1` 以及增量加固 `22cc8a2b8`、`25629d8a9`）：

- `src/workbench/creation/storyboard/anchorZone/StoryboardAnchorZone.tsx`：
  - 新增 `hasCards = cards.length > 0`，零卡态彻底隐藏无意义的 `[data-storyboard-anchors-toggle]`（`全部展开 / Expand all`）并将 `data-storyboard-anchors-expanded` 正确报为 `"false"`，在空态提示 `t('storyboardEditor.noAnchors')` 同行直接渲染复用自 `WorkbenchButton`（`size="sm"`，`data-storyboard-add-anchor="true"`）的 `+ 添加参考 / + Add Reference`；
  - 增卡后同步展开并把焦点落到新建卡名称输入框；删除最后一张参考卡后恢复零卡未展开态并将焦点归位至 `+ 添加参考 / + Add Reference`；有卡态继续保留展开/收起开关及展开后的单一 `addButton`（按 P1 同提交删去旧手写虚线按钮）。
- `src/workbench/creation/storyboard/StoryboardPlanEditor.tsx` & `StoryboardShotTable.tsx`：
  - 按 P1 同提交删除分镜滚区末尾原有虚线 `+ 添加镜头` 按钮，改为在固定页脚 `StoryboardPlanEditorFooter` 右侧操作组常驻唯一 `<WorkbenchButton size="sm" onClick={onAddShot} data-storyboard-add-shot="true">`；
  - 新增 `appendRevealRef` 统一挂载行与虚拟化行的场景展开、滚动入框与焦点定位，同时不冲掉既有镜头多选态。
- `src/workbench/generationCanvas/agent/storyboardPlanEdits.ts` & `electron/shared/storyboard/storyboardSubjectIdentity.ts`：
  - `addShot` 改为通过 `nextStoryboardSubjectIds(plan, [{ role: 'shot', shotId: ... }])` 分配全局唯一 `shotId`，避免删镜或拖拽重排后新镜与存活镜头/历史来源冲突；
  - `removeAnchor` 保留镜头已有参考素材的同时清理已删除参考卡的悬空 `anchorId` 来源绑定，`takenIds` 一并记录历史 provenance ID 防止复用碰撞。
- `tests/ux/project-save-draft-contract.walk.mjs`：兼容零卡态隐藏 `[data-storyboard-anchors-toggle]` 的新契约，仅在 `count() > 0` 时展开。
- **隐私与干净度核查**：`origin/main..HEAD` 全部提交信息及非 PNG 新增 diff 行扫描本机绝对路径、临时目录路径与私有工作树前缀均 **0 命中**。

## 2. 视觉证据与桌面读回逐项核验

已通过 `read_file` 亲眼核对 `docs/evidence/2026-11-24-ux-storyboard-actions/` 下的文本证据与真隔离 Electron 窗口改前/改后截图：

- **真窗截图矩阵目视通过（覆盖 `zh-CN` / `en` × `light` / `dark` × `1440×900` / `1280×800` / `1100×690`）**：
  - `before-phase1-1440x900.zh-CN.light.png` / `before-phase1-1100x690.zh-CN.light.png` / `before-phase1-1100x690.en.dark.png`：清晰复现 Phase 1 原问题——零卡参考区挂着空的 `全部展开 / Expand all`、空提示旁无添加按钮、且 `1100×690` 窄高视口下 `+ 添加镜头 / + Add shot` 藏在折叠线以下；
  - `after-empty-1440x900.{zh-CN.light,zh-CN.dark,en.light}.png`、`after-empty-1280x800.zh-CN.light.png`、`after-empty-1100x690.{zh-CN.light,en.dark}.png`：零卡态不再出现展开开关，空提示同行直出 `+ 添加参考 / + Add Reference`，表尾虚线旧按钮已删，固定页脚完整呈现 `返回原稿 / To Draft`、进度与 `+ 添加镜头 / + Add shot` + `生成剩余 / Generate Remaining`，亮暗双色对比清晰、无裁切溢出；
  - `after-reference-1440x900.zh-CN.light.png` / `after-reference-1100x690.en.dark.png`：一键新增首张可编辑参考卡 `Mara` 并恢复 `1 张待生成 / 1 pending` + `全部收起 / Collapse all` 开关；
  - `after-shot-added-1440x900.zh-CN.light.png` / `after-shot-added-1100x690.{zh-CN.light,en.dark}.png`：点击固定页脚加镜后新增第 3 镜并自动滚入视口，提示词 `Mara opens the studio door.` 完整可读，即使页脚出现 `2 处待处理 / 2 issues` 提示在 `1100×690` 下仍单行排布无遮挡。
- **命令日志与读回核验**：
  - `commands.jsonl`（140 条 `verify-nomi` 标准驱动指令，7 条轨道每条 20 步全部 `ok: true`）；
  - `readback.json`（7/7 轨道首屏 `scrollTop: 0`、`toggle: false`、`anchorHit: true`、`shotHit: true`、`backHit: true`、`generateHit: true`、`newShotFullyVisibleAfterClick: true`，返回项目库重开后均读回 `shots: 3`、`name: "Mara"`、`prompt: "Mara opens the studio door."`，`foregroundGrabs: 0`、`externalRequests: 0`）。

## 3. ★9 真实「什么都不做 / 全部拦下 / 退回旧 ID」变异测试（4/4 必红 → 还原全绿）

在隔离验收工作树中独立注入 4 项反向变异，运行对应 Vitest 套件：

| 编号 | 故障注入方式 | 变异结果（必红） | 还原验证 |
|---|---|---|---|
| M1（退回零卡旧逻辑） | `StoryboardAnchorZone.tsx` 将展开开关门控 `{hasCards ? (` 改为 `{true ? (` 并删去零卡同行 `{addButton}` | `EXIT=1`：`StoryboardPlanEditor.actions.test.ts` **2/3 失败**（`[data-storyboard-anchors-toggle]` 期望 0 实得 1；`Add Reference` 点击 2000ms 超时） | `git checkout --` 后复绿 |
| M2（参考卡点击空操作 / 全部拦下） | `StoryboardAnchorZone.tsx` 将 `props.onAddAnchor?.()` 置空为无操作注释 | `EXIT=1`：`StoryboardPlanEditor.actions.test.ts` **1/3 失败**（点击后 `[data-storyboard-anchor-row]` 计数停在 0） | `git checkout --` 后复绿 |
| M3（页脚加镜空操作 / 写入被阻断） | `StoryboardPlanEditor.tsx` 将页脚 `onAddShot={onAddShot}` 改为 `onAddShot={() => {}}` | `EXIT=1`：`StoryboardPlanEditor.actions.test.ts` **1/3 失败**（`[data-storyboard-rows]` `data-storyboard-row-count` 期望 `"4"` 实得 `"3"`） | `git checkout --` 后复绿 |
| M4（退回 `addShot` 旧位置 ID 逻辑） | `storyboardPlanEdits.ts` 移除 `nextStoryboardSubjectIds` 唯一 `shotId` 分配，退回按 `index` 推导 | `EXIT=1`：`storyboardPlanEdits.test.ts` **2/37 失败**（删镜后新镜与存活 `shot-51` 冲突；重排/删后再加与旧 `shot-3` 碰撞） | `git checkout --` 后复跑 **37/37 复绿** |

## 4. 独立复跑单测、门岗与干净树性能核验

### 首轮门岗复跑（`80e6fc2f1`，全部 `EXIT=0`）
- `pnpm run check:board-parity`、`pnpm run check:tokens`（`0/0/0/0`）、`pnpm run check:i18n`（23/23 + 6740 键）、`NOMI_BASE_REF=origin/main node scripts/lint-changed.mjs`、`./node_modules/.bin/tsc -p tsconfig.app.json --noEmit`、`StoryboardPlanEditor.overflow.test.ts`（6/6）：**全绿**。

### 边界加固与干净树性能刷新增量复验（`25629d8a969b0f261928aad4f55ec9b59eb2c678`，全部 `EXIT=0`）
- 3 套目标 Vitest（`VITEST_MAX_WORKERS=2`：`StoryboardPlanEditor.actions.test.ts`、`storyboardPlanEdits.test.ts`、`StoryboardAnchorZone.structure.test.ts`）：**3/3 文件，51/51 passed**；
- `pnpm run check:controls`：**PASS**（0 违规）；
- `pnpm run check:walkthroughs`：**PASS**（108/108 规则单测通过，398 份走查棘轮零回归）；
- **干净树性能基线核验（`docs/evidence/2026-11-24-ux-storyboard-actions/storyboard-plan-open.perf.json`）**：
  - `"commit": "22cc8a2b8"`，`"head": "22cc8a2b8d1c9f6ad422bd741a33cec4043fc879"`，**`"dirty": false`**；
  - 5 轮 `storyboard-plan-open`（320 镜方案）`response` 样本 `[411.8, 407.3, 395.3, 380.8, 396.2]` ms，中位数 **396.2 ms** / p95 **410.9 ms**（预算 `1000 ms`），`longTasks` 中位数 **0** / p95 **0.8**，`verdict.status = "ok"`。

### 顺序发号、文件瘦身与重复导入修复增量复验（`b274878cd882312f60a42025fa452fe3c1ef41a2`，全部 `EXIT=0`）
- 审阅增量 `25629d8a9..b274878cd`：`669d5185c` 收口 `shot-1` 顺序发号、拆分 `storyboardMountPlan.ts` 并完成文件行数瘦身；复核阶段拦截 `storyboardDeleteUndo.ts:2-3` 重复 `import type`（`TS2300`），`b274878cd` 已删除重复行；全增量 `0` 本机路径泄露。
- 独立实跑全绿（`EXIT=0`）：
  - `./node_modules/.bin/tsc -p tsconfig.app.json --noEmit`：**PASS**（`0` 错误）；
  - `pnpm run check:filesize`：**PASS**；
  - `pnpm run check:root-cause-contracts`：**PASS**（55/55）；
  - 3 套目标 Vitest（`VITEST_MAX_WORKERS=2`：`storyboardPlanSingleOwner.loopback.test.ts` 20/20、`storyboardPlanEdits.test.ts` 37/37、`StoryboardPlanEditor.actions.test.ts` 6/6）：**3/3 文件，63/63 passed**。
- **刷新干净树性能基线（`storyboard-plan-open.perf.json`）**：`"commit": "669d5185c"`、`"dirty": false`、5 轮 `response` 中位数 **436.2 ms** / p95 **531.2 ms**（预算 `1000 ms`，`verdict.status = "ok"`）。
- **未验证边界**：Windows 真机、真付费生成与纯键盘全链路沿设计卡如实记为 `unverified`。
