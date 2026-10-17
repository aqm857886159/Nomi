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
