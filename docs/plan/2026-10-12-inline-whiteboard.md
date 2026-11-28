# Inline whiteboard — approved implementation card

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

Implementation line: inline-whiteboard-editor. Independent line: whiteboard-independent-review. Categories: new interface, interruptible local editing, canvas, data format. Approval: user said “去实现吧” and “弄好提交pr” on 2026-10-12 after the centered compact exploration.

| Card | Decision and evidence |
|---|---|
| 1 User task | Creator opens an existing image's whiteboard in place, moves the image independently, adds text, completes the edit, and inspects an older version. Standalone board supports the same editor. Three tasks: real local image edit/save/reopen; standalone import/draw/erase → screenshot-derived node. Baseline: full-screen navigation; target: zero page transitions, no duplicate preview, no unavailable placeholder actions. Quality gates: original-function census and real gesture/save/reopen. Record each step expected/actual in UX report. |
| 1b Related surfaces | Existing image quick actions restore after Done; NodeVersionCardsHost retains version actions; existing node composer is suppressed through nodeAttachedPanel while editing. Errors stay inline and retryable; no automatic generation. |
| 2 Ownership | One active editor session owned at node level, independent of selection-only toolbar. WhiteboardState owns scene/text/transforms. Existing canvas node store owns frame position/size; NodeResizer owns gesture history/persistence. Version lifecycle owns numbering/main selection. Door maps: WhiteboardModal (two entrances); serializeWhiteboardState (DrawingTool + old modal). |
| 3 Reuse | Move existing save/screenshot/project-context owner into inline host and delete WhiteboardModal. Reuse Leafer renderer/editor/export, old draw/erase/selection/group/import/background-removal hooks, WhiteboardLibraryPanel, FloatingToolbarShell, AnchoredPopover, Workbench controls, NodeResizer and version cards. Mantine useStateHistory provides document undo; no homegrown history framework. Existing Tabler icon family and Nomi tokens only; no global CSS additions. |
| 4 States | Empty board remains editable; loading has loading mark; saving/import/background removal expose actual busy state and prevent duplicate action; failure retains editor and draft with retryable action; project switch cancels late commits through existing execution context; read-only has no edit entrance. Text input/IME keeps native behavior. All tool parameters are inline; all expanded panels center on the entire frame. zh/en + light/dark are required. |
| 5 Interruption | Drawing/text: close Done commits, deselection retains session, project switch unmount saves synchronous draft only to its owner, restart restores persisted draft. Import/remove-background/screenshot: existing project signal rejects stale commits; repeated action blocked during busy; failure leaves editor open. App quit during an in-flight external operation leaves last persisted document; no new generation is initiated. |
| 6 External inputs | Local image import retains file type/size/read failure handling; existing background-removal service retains phase/error feedback; persisted legacy documents default missing text/transforms safely without altering assets. Leafer behavior checked against installed 2.1.7 source. No new provider requests. |
| 7 Budget | One active Leafer instance; inactive nodes retain ordinary previews. Reuse the unified registry/runner introduced by main PR #1187: `inline-whiteboard-drag`, 32 nodes / 30 offscreen / 1 shared real 4K image / 1 editor. Drag frame-gap p95 ≤33ms and zero >50ms long tasks, enforced in each complete real journey; five successful fresh-project repetitions establish the baseline. 2026-10-17 added five scenarios on the same registry through one probe (`tests/ux/whiteboard-perf.probe.mjs`): `inline-whiteboard-idle-panel` (idle main-thread busy ≤1%; per-frame polling measured 2.2–2.6%, none measured 0.2%), `inline-whiteboard-open` (click to usable ≤1000ms; 421ms), `inline-whiteboard-type` (per-key response p95 ≤100ms; 15.5ms), `inline-whiteboard-many-images` (25 visible images, in-editor drag frame gap ≤33ms; 6.2ms) and `inline-whiteboard-moving-panel` (frames the size panel strays from its anchor during wheel zoom; 12 of ~230, equal with and without the per-frame loop that was removed). Those numbers use the repository's real 640×360 shot on a Windows i9 machine (noisy), not the 4K clip. Open-to-first-persisted-image is not openToInteractive. Still unverified: many visible *distinct large* decoded images, long strokes/history, 4096² export, the user's full project, a 4K source; preview 4MP / export 16MP limits do not bound original decoded asset memory. Baseline values are recorded by the coordinator after the actual unified run, with noisy flag because other host apps remain active. |
| 8 Conditions | Desktop only (explicit user requirement). Real Electron zh/en, light/dark and minimum desktop window screenshot/gesture runs planned. Windows and clean packaged install are unverified; no phone work. |
| 9 Acceptance/rollback | Independent review must compare all census groups to real task evidence. Focused document tests + whiteboard UX walk + repository risk-selected gates + build. Revert scoped PR commit restores former host/data readers; new additive fields are harmless to old readers. No merge authorized. |

## Functional classification
- [x] 新界面 / 改交互
- [x] 新增功能 / 性能
- [x] 长跑 / 可打断
- [x] 大数据量 / 画布 / 长列表
- [x] 数据格式
- [ ] 花钱
- [ ] Agent 行为
- [ ] 生成效果

## System contract

No new tokens or global styles. Use existing WorkbenchButton/ToolIconButton, FloatingToolbarShell and AnchoredPopover. Extend the shared floating-toolbar container with below-node placement rather than cloning its zoom/clamp mechanism. Replace the full-screen whiteboard host in both entrances; no reachable second editor. All scene transformations pass through a serialized capture/restore boundary. Browser exploration is reference only; the board checklist and production-component walk are the implementation contract.

## Census

Independent census: image and standalone entrances; save/no-op close; screenshot export and derived-node transaction; brush pressure/smoothing/colors/size; true local eraser and cursor; selection/multiselect/group; image move/scale/snap/flip; delete/locked/background protection; background-removal phases; import busy/type/read/error; five ratios; board/result library counts/thumbnails/dimensions/select/visibility/delete/empty/scroll; asset/result drag/drop; keyboard move/delete/native input; all existing version operations; node geometry persistence. Each is mapped in InlineWhiteboard.board.json functionCensus and the UX acceptance report.

## Direction check: recurring shared boundaries

### 0. Class root
Generic placement, editing ownership and delivery-stage policy were treated as local caller details; each caller could violate the same invariant again. This PR is reviewable preparation, not approval to merge a policy change.

### 1. Classification
| Symptom | Direct cause | Class |
|---|---|---|
| Size popup covers toolbar after resize | Anchor movement was not observed | Shared placement lifecycle |
| Extreme-edge toolbar clips buttons | Minimum width conflicts with unconditional centering | Shared screen-space constraints |
| Version action targets a later project | Context issued after waiting for editor | Action ownership at entry |
| First push cannot create its PR | Push requires merged settlement evidence | Delivery-stage ownership (`gate-family`) |

### 2. Why recurrence occurs
The same shared boundaries serve multiple callers. Fixing only the whiteboard cannot protect existing menus, version cards or future first PRs. Experience law ⑫ applies: visible controls must remain reachable and actions must affect their initiating project. Delivery policy itself is not a product interaction; it must distinguish preparation from settlement without pretending reviewed means fixed.

### 3. Falsifiable predictions
Without shared anchor observation, resizing/zooming an open panel leaves stale placement; the real walk's seven resize/wheel steps detect it. Without minimum-width admission, extreme left/right centering clips buttons; the clamp matrix tests both edges, five scales and three prior shifts. Without a shared stage decision, every new user contract repeats the first-push deadlock; subprocess node tests exercise a real temporary Git repository.

### 4. Independent target
Implementation-line tests are not independent acceptance. The separate whiteboard-independent-review line read sources, failure logs and actual zh/en screenshots. The 51-row census remains partial; no screenshot baselines or test expectations were relaxed to make the failure disappear. First performance journey failure is retained.

### 5. P0 and replacement boundary
Use installed Floating UI 1.8.0 `autoUpdate` for generic placement observation, Mantine for input/history, and Git for commit identity/ancestry. Nomi's inverse-scaled node toolbar and result/project ownership remain domain adapters. `gate-family` is the existing self-written registration: GitHub's PR/branch protection can enforce remote checks, but cannot express this repository's root-cause-contract ↔ reviewed escape ledger ↔ class-check relationship before a PR exists. Keep that policy in the existing single evaluator; do not create another gate. Re-evaluate the registration on 2026-10-19 with the contract recurrence check; replace the local policy when an adopted declarative policy engine can represent these committed links and stage semantics without a duplicate source of truth. This PR does not claim the entire gate family is replaced.

### 6. Options
| Option | Change and tradeoff | Decision |
|---|---|---|
| Adopt established mechanisms | Floating UI observation; Mantine inputs/history; Git ancestry; existing evaluator remains domain-policy owner | Recommended and used; references: `node_modules/@floating-ui/dom`, `src/design/forms.tsx`, `scripts/pr-body-criteria.mjs` |
| Patch each caller | More local watchers, clamps or evidence exemptions | Reject: repeats the class root |
| Rewrite gate/toolbar frameworks | Replace all existing callers during this feature | Defer: broader migration needs its own reviewed contract; no second framework here |
| Delete constraints/checks | Hide tools or skip ledger validation | Reject: loses existing capability or settlement assurance |

### 7. Core tradeoff and prevention
Keep ordinary editing centered and compact, but prefer reachable buttons when an extreme edge cannot fit the minimum width; keep first-push evidence reviewable while CI/merge requires real settlement. Structural regressions: `floatingToolbarClamp.test.ts`, `anchoredPopoverPlacement.test.ts`, `whiteboard-refactor.walk.mjs`, `pr-body-criteria.node-test.mjs`, `pr-judgement-lib.node-test.mjs`. Escape ledger `FB-20261012-inline-whiteboard-popup-overlap` binds the real walk as its class check; it remains reviewed, not fixed.

## 2026-10-17 change: region annotation tool removed

User decision on 2026-10-17: "1189 的标注工具先拿掉". The global annotation layer planned for 0.24 replaces it, so this PR does not ship a second, per-board copy (P1: removed in the same PR, nothing left half-built).

- Removed: the `note` tool and its toolbar button, the numbered list / overlay pins / region drag, the "use these changes" entrance that appended text to the node prompt, the nine i18n keys per locale, the `whiteboardAnnotations.ts` reader, its tests, its walk steps and the board-manifest element (now `dropped` with the user quote).
- Kept: `whiteboardDraftIdentity` (moved into `whiteboardState.ts`) because the draft-per-result-version binding is not an annotation concern.
- Migration: projects saved while the tool existed hold `node.meta.whiteboardAnnotations`. Nothing reads it any more and nothing deletes it: the saves in `InlineWhiteboard` spread the existing `meta`, so the key stays in the project file untouched. No migration is attempted and no error is raised on load; the walk seeds such a project and checks both facts (legacy data kept, editor opens clean). The 0.24 annotation layer defines its own storage and may offer to import the old entries; until then they are inert data.
- Review findings F1, F3 (the blue region box part), F4 (the annotation panel part) and F5 (the Prepare assertion part) lived on this tool and disappear with it; see the PR body for the per-finding ledger.

## 2026-10-22 change: the first drag draws, and Done leaves a picture on the board node

用户 10-22 反馈「画板用不了」（逃逸账本 `FB-20261022-whiteboard-board-unusable`，方向检查 `docs/engineering/direction-checks/2026-10-22-whiteboard-first-gesture-and-visible-result.md`）。用户 2026-10-22 拍板：按推荐，选 A；推翻清单 O40「独立画板完成只保存 state，不截图」。

| ★ | 内容 |
|---|---|
| 1 用户任务 | 创作者点开画板，直接拖就能画；按「完成」后，节点上看得见自己画的东西，还能连到下游当参考；点那张图（先选中再点，和空启动器同一套规矩）能回去接着画。 |
| 2 归属 | 默认工具归 `WhiteboardDrawingTool`（初值改为画笔，删掉 select 初值）。「完成要不要出图」归 `InlineWhiteboard.handleClose`：原来按 sourceKind 分两条，现在换成一条规则——节点已有图或画板上有东西就走同一个出图事务 `saveImageWhiteboardSnapshot`，否则只存 state。「有没有东西」只有一个定义：`whiteboardHasVisibleContent`。节点怎么呈现归 `WhiteboardCardBody`：有图显示画布预览（`DeferredNodeImage` + `canvasImageSourceOf`，和角色卡同款），没图显示启动器。两者共用抽出来的 `CardActivationButton`。 |
| 3 复用 | 出图走图片入口原有的版本事务（`appendNodeResultVersion` + 落盘），缩略图用现成的画布预览组件，激活规矩用现成的 `useEmptyNodeActivation`；没有新样式，也没有新的全局 CSS。 |
| 4 状态 | 空画板：只存 state，显示启动器。有内容：完成即出一版图。没改动的完成：已经有图就不出新版本；只有 state、还没图的老画板，下次完成时补出图。截图后马上完成：不出重复版本。画板被清空、但以前出过图：完成会出一张空白版本（如实反映画板当前的样子）。出图期间「完成」和「截图」两个按钮禁用；失败时编辑器留着、可以重试（沿用原有逻辑）。 |
| 7 性能 | 新增的操作是「完成 → 节点上看见那张图」。最坏规模取尺寸面板上限：4096×4096、12 张照片（6 张不同）、24 笔，导出被 16MP 像素预算封顶。登记场景 `inline-whiteboard-done-export`，预算 3000ms（proposed），基线中位 4143.7 / p95 4489.3（5 次，noisy，i9-13900H）。**超预算，已登记欠账**：拆开看，Leafer 导出约 0.8s，共享落盘（`importWorkbenchLocalAssetFile` 写 9.8MB + 派生预览）占 2–2.8s；1280×720 的小画板同一段也要约 1.5s（一次性实测 1483 / 1546 / 1491ms），说明固定开销在落盘这段，不在画板。图片入口自 #1189 起走的就是这段，这次没有让它变慢。协调 10-22 派 P-asset-persist 修共享落盘，在那之前保证「完成 → 可见反馈」≤100ms：点「完成」后按钮当帧变成「保存中」（复用 `NomiLoadingMark`，aria-busy），实测 7.9 / 19.5 / 20.8 / 18.6 / 17.8ms（最坏画板 5 次，中位 18.6ms）。编辑器要等导出读完画布才能收起（Leafer 导出读的是正在显示的画布），所以反馈放在「完成」钮上，画板内容保持显示。 |
| 9 验收 / 回滚 | `tests/ux/whiteboard-refactor.walk.mjs` 里，先红的三条转绿，另加三条：从缩略图重开、截图后马上完成不出重复版本、没改动的重开再完成不多版本；单测在 `whiteboardProjectContext.test.ts` 的 board Done 组和 `whiteboardInlineState.test.ts`；Windows 打包版中英各跑一遍创作者路径。回滚：撤掉本 PR，老数据不受影响——新增的只有节点结果，旧读者照常能读。 |

### 验收清单（实现前写，见 R-whiteboard 报告）
- 入口 1（添加条新建画板）：点一次启动器就打开，工具是画笔；直接拖能画出一笔；完成后节点上看得见画的内容；再打开笔画都在、能接着画；空着打开再完成不出图。
- 入口 2（老画板：只有 whiteboardState、没有 result）：项目打开时节点仍显示启动器（不会凭空出图）；打开后不改动直接完成，就补出图。旧数据不丢、不被自动改写。
- 入口 3（图片节点浮条「画板」）：原地展开，默认画笔；直接拖是画线，照片不动；完成后正好多一版；不改动就完成，不多版本。
- 打包版：上面三个入口，中英各一遍。

### Also fixed on the way
未改动的重开曾把画板从 1280×720 变成 1280×719，于是又出一个版本。原因是节点尺寸存的是取整后的值，`WhiteboardDrawingTool` 的 ResizeObserver 又把这点取整误差读回成了一次「改尺寸」。现在规定：画框和文档尺寸差不到 1 个屏幕像素就当作同一个尺寸，只有真的拖动画框才改文档尺寸。
