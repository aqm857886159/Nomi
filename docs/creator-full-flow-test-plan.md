# Nomi Creator Full-Flow Test Plan

This plan defines how Nomi is tested from the viewpoint of a real creator who expects the product to preserve work, explain failures, produce reusable assets, and make a shareable preview. It is intentionally organized around intolerable user failures rather than implementation ownership.

## Completion Standard

The creator flow is considered releasable only when the P0 automated suites pass, the P0 manual exploratory scripts pass on the release build, and every failure has an explicit user-visible state or a tracked blocker. A release is not acceptable when the app appears successful while the required project, canvas node, asset URL, timeline clip, preview state, or share state is missing.

The plan covers the current Nomi studio path:

1. Open `/studio`.
2. Create or resume a project from the library.
3. Write or revise source material in `创作`.
4. Move to `生成`.
5. Use generation AI in `Agent`, `问答`, and `润色` modes.
6. Edit the generation canvas manually.
7. Run image and video generation.
8. Reuse generated assets in the timeline.
9. Preview the timeline.
10. Refresh or reopen and verify persistence.
11. Open public share pages and verify read-only rendering.

## Intolerable User Failures

These failures block release because they destroy trust or make a creator's work unrecoverable:

- **Lost work:** project text, canvas nodes, generated asset URLs, timeline clips, or playhead edits disappear after step changes, refresh, or reopen.
- **False success:** UI says AI planned, generated, saved, imported, shared, or previewed something, but no corresponding durable state exists.
- **Wrong AI mode contract:** `问答` creates nodes, `润色` creates extra nodes, or `Agent` only returns prose when the user asked for canvas work.
- **Silent generation skip:** a downstream video/image node runs without real upstream asset URLs and hides the missing prerequisite.
- **Unusable result:** an asset is generated but cannot be inspected, reused downstream, dragged to the timeline, previewed, or persisted.
- **Read-only leak:** public share pages expose edit, connect, generate, or model controls.
- **Model/config opacity:** missing vendor token, disabled model, provider 401/429/500, malformed JSON, timeout, or network failure is hidden behind a generic success or a fabricated fallback.
- **Canvas collapse under real use:** drag, zoom, select, connect, or inspect becomes periodically frozen with realistic node and edge counts.
- **Cross-project bleed:** opening one project shows another project's text, canvas, media, timeline, model state, or share data.
- **Mock leakage:** mocked generation or mocked agent responses are presented as proof that real provider execution works.

## Full-Flow User Journey

### Persona And Scenario

Primary persona: a solo creator turning a short story idea into a visual video draft. They care less about implementation boundaries and more about whether every artifact remains visible and reusable.

Scenario used by manual and E2E tests:

- Story idea: "rainy neon street, one character entering a frame, cinematic watercolor mood."
- Expected creator artifacts: source text in `创作`, one text/script generation node, one image node, one video node, at least one real or mocked generation result depending on test tier, one timeline clip, a preview state, and a public share rendering.

### Step Assertions

| Step | Creator Action | Required Evidence | Blocking Failure |
|---|---|---|---|
| Library | Open `/studio`; create new project | Studio shell opens; project can be reopened after refresh | Project created only in transient UI |
| Creation | Type source text; ask AI to revise when available | Text remains editable and persists | Text reset after navigation or AI failure |
| Step navigation | Switch `创作 -> 生成 -> 预览 -> 生成` | Active step changes without losing source/canvas/timeline state | Any step switch resets state |
| Agent mode | Ask generation AI to plan nodes | Editable planned nodes and edges appear; no real generation starts automatically | Text-only answer when canvas work was requested, or auto-run without user action |
| Chat mode | Ask why a node failed | Assistant answer appears; node count does not change; no plan-parse error appears | Chat requires `<generation_canvas_plan>` or mutates the canvas |
| Refine mode | Select a node and refine prompt | Selected node prompt changes; node count remains stable | New node created or no selected prompt update |
| Manual canvas | Add image/video nodes; select; connect; delete; duplicate where supported | Store state and visual canvas agree | Controls appear to work but state is stale |
| Model catalog | Open model configuration | Dynamic model/config surface is visible; missing config fails explicitly | Hardcoded candidates masquerade as connected models |
| Image generation | Generate image node | Success records a real image URL and node history entry; failure records visible node error | Success without URL or hidden provider failure |
| Video generation | Generate video node from real image/video reference | Success records a real video URL; missing upstream real URL fails before provider call | Video runs from prompt-only/placeholder upstream |
| Timeline | Send or drag generated asset to timeline | Clip contains the generated media URL and duration; preview can consume it | Asset cannot become a timeline clip |
| Preview | Play/scrub preview | Playhead, active clips, and rendered preview agree | Preview shows stale or unrelated media |
| Persistence | Refresh and reopen latest project | Project text, generation graph, results, timeline, and selected step are recoverable as designed | Durable state differs from pre-refresh state |
| Share | Open `/share/:projectId/:flowId` | Public canvas renders imported flow data read-only | Share page blank, editable, or missing asset data |

## Priority Matrix

### P0 Release Blockers

| Area | Risk | Coverage Required | Current Automated Coverage | Manual Coverage |
|---|---|---|---|---|
| Project lifecycle | Work disappears after create/open/refresh | New project, last active project, refresh persistence | `creator-full-journey.spec.ts` | Script A |
| Creation text | User writing is lost or AI failure erases draft | Type, revise, navigate, refresh | `creator-full-journey.spec.ts`, `creation-ai.spec.ts`, `projectPersistence.contract.test.ts` | Script A |
| Generation AI modes | Assistant mutates wrong state | Agent creates nodes; Chat is answer-only; Refine edits selected prompt | `generationAssistantModes.test.ts`, `generation-ai-modes.spec.ts` | Script B |
| Canvas read/write | Canvas UI and store diverge | Add/select/connect/manual edit | `generationCanvasStore.test.ts`, `generationCanvasStore.contract.test.ts`, `canvas-operations.spec.ts`, `generation-canvas-workflows.spec.ts` | Script C |
| Generation prerequisites | Downstream generation runs without real upstream assets | Real URL requirement and visible failure | `canvas-operations.spec.ts`, `timelineGenerationContracts.test.ts` | Script D |
| Generation result durability | Success without reusable URL | Node result URL, history, downstream reuse, timeline clip | `generationCanvasStore.contract.test.ts`, `generation-canvas-workflows.spec.ts`, `timelineGenerationContracts.test.ts` | Script D |
| Timeline and preview | Generated work cannot become playable draft | Clip creation, playhead, active clip rendering | `timelineContracts.test.ts`, `timelineGenerationContracts.test.ts`, `generation-canvas-workflows.spec.ts` | Script E |
| Public share | Shared work is editable or unreadable | Legacy import, V2 read-only canvas, hidden controls | `importLegacyFlowGraph.test.ts`, `generationCanvasReadOnly.test.tsx`, `share-readonly.spec.ts` | Script F |
| Provider/config errors | Failures hidden by generic fallback | 401/429/500/timeout/malformed response visible | `modelOptionsContracts.test.ts`, `model-catalog-and-failures.spec.ts`, `generation-ai-modes.spec.ts` | Script G |
| Performance floor | Realistic canvas becomes unusable | 100+ nodes, drag/zoom/select for 30 seconds | Manual release gate only; not default CI | Script H |

### P1 High-Value Regression Coverage

| Area | Risk | Test Needed | Notes |
|---|---|---|---|
| Multi-tab editing | Last writer silently overwrites work | Two tabs edit same project; conflict state is explicit | Define expected conflict behavior before automation |
| Upload ingestion | Bad file corrupts project or blocks UI | Oversized image, unsupported type, malformed media metadata | Should assert explicit failure and no partial asset leak |
| In-progress refresh | Running generation loses status | Start generation, refresh, verify state is queued/running/error/recoverable | Requires real or deterministic task API harness |
| Model catalog data | UI uses stale hardcoded model list | Empty catalog, disabled model, provider token missing | Covered by `modelOptionsContracts.test.ts`; expand with live API smoke when model catalog API changes |
| Mobile layout | Controls overlap or disappear | iPhone 14 and narrow desktop for creation/generation/preview/share | Covered by `mobile-layout.spec.ts` and the mobile Playwright project |
| Accessibility contract | Tests cannot target stable controls | Labels and roles for primary controls | Add as components churn |
| Server sync | Local save succeeds but server import/save fails | Local durable save plus visible server sync error | Requires API route mocks or local API |

### P2 Depth And Polish

| Area | Risk | Test Needed |
|---|---|---|
| Export | Preview works but exported file is empty | Timeline export smoke with generated media fixture |
| Long sessions | Memory/performance degrades after many edits | 60-minute exploratory soak or scripted interaction loop |
| Edge editing detail | Handles or edge modes regress | Structural edge matrix tests for allowed/blocked connections |
| History and rerun | Users cannot compare generation attempts | Rerun-as-new-node keeps prior result and history |
| Localization | Mixed language labels break workflows | Chinese and English label smoke where app supports both |

## Manual Exploratory Scripts

Run these on the release build, not only on Vite dev. Record browser, build commit, base URL, account/config used, and whether providers were mocked or real.

### Script A: Project And Creation Persistence

Purpose: prove a creator's writing survives normal movement through the app.

1. Run `pnpm --filter @nomi/web build`.
2. Run `pnpm --filter @nomi/web preview --host 127.0.0.1`.
3. Open the preview URL and navigate to `/studio`.
4. Create a new project from the library.
5. Go to `创作`.
6. Type a multi-paragraph story idea with a distinctive phrase: `rain on glass, red umbrella, neon reflection`.
7. Switch to `生成`, then `预览`, then back to `创作`.
8. Refresh the browser.
9. Reopen the last active project if the library appears.
10. Confirm the exact distinctive phrase remains editable.

Pass: the text remains in the project and no unrelated project data appears.

Fail: text disappears, becomes read-only in studio, changes project, or a save error is hidden in console only.

### Script B: Assistant Mode Contract

Purpose: prevent the three AI modes from collapsing into one unreliable behavior.

1. In `生成`, open the generation assistant.
2. Select `Agent`; ask `用雨夜街道做一组可编辑分镜节点`.
3. Confirm planned nodes appear and no provider generation starts automatically.
4. Select `问答`; ask `这个节点为什么失败？`.
5. Confirm only an answer is added and node count stays unchanged.
6. Select one image node.
7. Select `润色`; ask `把选中节点改成更电影感的黄昏水彩镜头`.
8. Confirm the selected node prompt changes and node count stays unchanged.

Pass: each mode mutates only its intended state.

Fail: chat demands plan XML, refine creates a new node, agent produces text only, or any mode silently ignores parse/config errors.

### Script C: Canvas Editing And State Agreement

Purpose: prove the visible canvas and internal graph remain aligned.

1. Add a text node, an image node, and a video node.
2. Edit each node title and prompt.
3. Connect text -> image and image -> video.
4. Select nodes one by one and verify inspector/actions target the selected node.
5. Delete one edge and reconnect it.
6. Refresh and return to `生成`.

Pass: visible nodes, prompts, edges, and selected/action behavior match before and after refresh.

Fail: ghost edges remain, selections target old nodes, prompts revert, or toolbar actions apply to the wrong node.

### Script D: Real Generation And Prerequisite Failure

Purpose: prove the product never treats placeholders as real media.

1. Use a provider-configured account or local API environment with real generation enabled.
2. Create an image node with prompt `single red umbrella under neon rain, cinematic watercolor`.
3. Generate the image.
4. Confirm the image node stores a real URL and displays the asset.
5. Create a video node connected to that image node.
6. Generate the video.
7. Confirm the video node stores a real URL and displays/reuses the result.
8. Create a second video node connected only to a text node or an image node without result URL.
9. Attempt to generate the second video node.

Pass: real generation produces durable URLs; missing upstream real asset fails before downstream provider execution with a visible node error.

Fail: success without URL, provider failure hidden as success, downstream runs from prompt-only upstream, or generated media disappears after refresh.

### Script E: Timeline And Preview

Purpose: prove generated work becomes a playable draft.

1. Use an image or video node with a real result URL.
2. Send or drag it to the timeline.
3. Confirm a clip appears with the expected media type and duration.
4. Move the clip on the track.
5. Scrub the playhead across empty time and clip time.
6. Press play.
7. Switch away and back to `预览`.
8. Refresh and reopen the project.

Pass: clip timing, playhead, active clip rendering, and persistence agree.

Fail: the clip exists visually but has no media URL, preview renders stale media, playhead state corrupts, or timeline is lost on refresh.

### Script F: Share Read-Only Contract

Purpose: prove public links show work without exposing creator controls.

1. Open a public share URL with a flow containing at least one image result.
2. Confirm project and flow labels load.
3. Confirm the canvas renders the image/video/text nodes.
4. Try to find generation toolbar, connect handles, generate buttons, prompt edit controls, model catalog controls, and destructive actions.
5. Attempt keyboard shortcuts that normally edit the canvas.

Pass: share page renders readable content and exposes no edit/generation controls.

Fail: blank share canvas, missing asset URL, visible edit affordance, or successful mutation from public view.

### Script G: Provider And Model Failure Honesty

Purpose: prove users see the real reason generation cannot run.

1. Test with no model/provider configured.
2. Test with invalid token.
3. Test with a provider route mocked or configured to return 401.
4. Test 429.
5. Test 500.
6. Test timeout/network failure.
7. Test malformed provider JSON.

Pass: each failure leaves the node/project in a recoverable error state and shows a specific reason; no fallback model is silently used.

Fail: generic success, automatic model/vendor fallback, swallowed error, fake URL, or missing retry/error history.

### Script H: Large Canvas Performance Floor

Purpose: catch the creator experience where the canvas works briefly, freezes, then recovers cyclically.

1. Create or import a graph with at least 100 nodes and 200 edges.
2. Drag one node continuously for 30 seconds.
3. Pan and zoom for 30 seconds.
4. Select a group of nodes and move the selection.
5. Open/close assistant and inspector while the canvas is large.
6. Watch browser performance and console errors.

Pass: interaction remains usable; no periodic multi-second freezes; no save/network work runs every animation frame.

Fail: repeated stalls, hot-path full graph scans on drag, console flood, or state updates unrelated to position causing top-level rerenders.

## Automated Suite Map

### Current Unit Suites

| Suite | Command | Protects | Does Not Prove |
|---|---|---|---|
| `_test/unit/aiComposerKeyboard.test.ts` | `pnpm --filter @nomi/web test -- unit/aiComposerKeyboard.test.ts` | Enter-to-send and Shift+Enter/IME text editing contract | Full browser focus behavior |
| `_test/unit/aiReplyActionButton.test.tsx` | `pnpm --filter @nomi/web test -- unit/aiReplyActionButton.test.tsx` | Assistant reply paste/copy action | Editor rendering in a full browser |
| `_test/unit/generationAssistantModes.test.ts` | `pnpm --filter @nomi/web test -- unit/generationAssistantModes.test.ts` | Agent/chat/refine mode contract at component/client level | Real model behavior, real provider generation |
| `_test/unit/generationCanvasReadOnly.test.tsx` | `pnpm --filter @nomi/web test -- unit/generationCanvasReadOnly.test.tsx` | Hidden edit/connect/generate controls in read-only canvas | Public route data loading |
| `_test/unit/generationCanvasStore.test.ts` | `pnpm --filter @nomi/web test -- unit/generationCanvasStore.test.ts` | Basic canvas CRUD, clipboard, snapshots, panel state | Full browser drag/pan behavior |
| `_test/unit/generationCanvasStore.contract.test.ts` | `pnpm --filter @nomi/web test -- unit/generationCanvasStore.contract.test.ts` | Store CRUD/history/clipboard/run/result contracts | Visual canvas rendering |
| `_test/unit/importLegacyFlowGraph.test.ts` | `pnpm --filter @nomi/web test -- unit/importLegacyFlowGraph.test.ts` | Legacy share flow import into V2 snapshot | Network share route |
| `_test/unit/modelOptionsContracts.test.ts` | `pnpm --filter @nomi/web test -- unit/modelOptionsContracts.test.ts` | Dynamic catalog options and explicit empty/error states | Live catalog connectivity |
| `_test/unit/projectPersistence.contract.test.ts` | `pnpm --filter @nomi/web test -- unit/projectPersistence.contract.test.ts` | Local project schema, revision, thumbnails, legacy normalization | Multi-tab conflict behavior |
| `_test/unit/sendGenerationNodeToTimeline.test.ts` | `pnpm --filter @nomi/web test -- unit/sendGenerationNodeToTimeline.test.ts` | Generation asset to timeline insertion and missing-asset failure | Drag-and-drop UI |
| `_test/unit/timelineContracts.test.ts` | `pnpm --filter @nomi/web test -- unit/timelineContracts.test.ts` | Timeline playback active clip and media-time math | Visual preview frame rendering |
| `_test/unit/timelineGenerationContracts.test.ts` | `pnpm --filter @nomi/web test -- unit/timelineGenerationContracts.test.ts` | Timeline normalization/editing/playback/generation clip contracts | Real media decoding |

### Current E2E Suites

| Suite | Command | Protects | Mock Policy |
|---|---|---|---|
| `_test/e2e/canvas-operations.spec.ts` | `pnpm --filter @nomi/web test:e2e -- canvas-operations.spec.ts` | Node creation, selection, copy/paste/delete, and missing-upstream video guard | Mocked app API |
| `_test/e2e/creation-ai.spec.ts` | `pnpm --filter @nomi/web test:e2e -- creation-ai.spec.ts` | Creation AI Enter behavior and paste-to-document action | Mocked workbench agent |
| `_test/e2e/creator-full-journey.spec.ts` | `pnpm --filter @nomi/web test:e2e -- creator-full-journey.spec.ts` | Project library, creation, AI planning, mocked generation, preview, refresh, reopen | Mocked workbench agent and task API |
| `_test/e2e/generation-ai-modes.spec.ts` | `pnpm --filter @nomi/web test:e2e -- generation-ai-modes.spec.ts` | Browser-level Agent/chat/refine behavior plus explicit agent/task failures | Mocked workbench agent and task API |
| `_test/e2e/generation-canvas-workflows.spec.ts` | `pnpm --filter @nomi/web test:e2e -- generation-canvas-workflows.spec.ts` | Canvas CRUD, model selection, mocked generation, timeline, preview, catalog drawer, constrained layout | Mocked app API |
| `_test/e2e/mobile-layout.spec.ts` | `pnpm --filter @nomi/web test:e2e -- mobile-layout.spec.ts` | Creation/generation/preview reachability on constrained viewports | Mocked app API |
| `_test/e2e/model-catalog-and-failures.spec.ts` | `pnpm --filter @nomi/web test:e2e -- model-catalog-and-failures.spec.ts` | Model integration entry points, explicit agent failure, malformed plan failure | Mocked app API |
| `_test/e2e/share-readonly.spec.ts` | `pnpm --filter @nomi/web test:e2e -- share-readonly.spec.ts` | Public share route read-only rendering | Mocked public project/flow routes |

### Coverage That Remains Environment-Dependent

The default suite now covers the full mocked creator chain. The following checks still need a configured provider, budget, production build, or explicit product decision before they can be automated as default CI:

| Check | Priority | Required Assertions |
|---|---|---|
| Real image/video generation smoke | P0 | Real provider output stores reachable image/video URLs, persists after refresh, and can feed downstream nodes |
| Provider matrix failures | P0 | 401/429/500/timeout/malformed JSON from live or contract test servers produce explicit node errors and no fallback URL |
| Large-canvas performance run | P1 | 100+ node graph remains interactive under drag/pan/zoom; no console error flood |
| Multi-tab project conflict | P1 | Conflicting edits expose deterministic behavior after the expected product rule is defined |
| Export smoke | P2 | Timeline export contains non-empty media from generated fixture assets |

## Mocked-Vs-Real Generation Policy

Mocked tests and real generation tests answer different questions. They must not be mixed in reports.

### Mocked Tests

Use mocked agent/provider responses when the goal is deterministic UI, store, parsing, routing, or read-only behavior.

Allowed mocked evidence:

- Assistant mode contract.
- Canvas plan parsing and node insertion.
- Public share import/rendering.
- Timeline math and preview rendering with fixture media URLs.
- Provider error shape mapping when the mocked response is deliberately an error.

Mocked tests may assert that a URL-shaped fixture is preserved, but they must not claim the provider generated a real asset.

### Real Generation Tests

Use real provider calls only in opt-in smoke runs where credentials and budget are intentionally provided.

Required real evidence:

- Provider task is accepted or returns a direct result according to the real API contract.
- Final node result contains an actual reachable `imageUrl`, `videoUrl`, `imageResults[].url`, or `videoResults[].url`.
- The asset can be displayed or downloaded by the app.
- The asset remains after refresh/reopen.
- Downstream nodes consume the real URL, not prompt text or planned metadata.

### Required Separation

- Default CI may run mocked tests only.
- Real generation smoke must be opt-in through environment variables and clearly named in logs.
- Release notes must state whether real generation smoke passed, failed, or was not run.
- A passing mocked suite cannot waive a P0 real-generation blocker.

## Release Gating

### Pull Request Gate

Run before merging test or workflow changes:

```bash
pnpm --filter @nomi/web test
pnpm --filter @nomi/web test:e2e
pnpm --filter @nomi/web build
```

Required result:

- All P0 unit and E2E tests pass.
- No new `test.skip`, `test.only`, broad timeout increase, or weakened assertion is introduced without documented reason.
- E2E traces/screenshots/videos are inspected for any failure.

### Release Candidate Gate

Run against a production build:

```bash
pnpm --filter @nomi/web build
pnpm --filter @nomi/web preview --host 127.0.0.1
NOMI_E2E_BASE_URL=http://127.0.0.1:4173 pnpm --filter @nomi/web test:e2e
```

Then run manual Scripts A through H. If preview uses a different port, replace `4173` with the printed Vite preview URL.

Required result:

- P0 automated suites pass on the built app.
- Scripts A through F pass.
- Script G passes for at least no-config and one real provider error class.
- Script H has no repeated multi-second freeze.
- Real generation smoke is passed or explicitly marked blocked by environment/config, not silently skipped.

### Hotfix Gate

When shipping a fix for a specific incident:

```bash
pnpm --filter @nomi/web test
pnpm --filter @nomi/web test:e2e -- creator-full-journey.spec.ts generation-ai-modes.spec.ts share-readonly.spec.ts
pnpm --filter @nomi/web build
```

Also rerun the manual script that maps to the incident. A hotfix cannot ship if it creates one of the intolerable user failures above.

## Failure Triage Rules

Classify every failure by user impact first, implementation area second.

### P0

P0 failures block release:

- Work lost after refresh/reopen.
- False success without durable artifact.
- Wrong AI mode mutation.
- Real generation success without real URL.
- Downstream generation runs without real upstream asset URL.
- Public share exposes edit/generation controls.
- Provider/config failure is hidden or silently falls back.
- Cross-project data exposure.

Required action: stop release, create an owner, preserve traces/logs, add or update an automated regression test, and rerun the mapped manual script.

### P1

P1 failures can ship only with explicit owner and deadline:

- Mobile layout blocks a secondary control but desktop P0 works.
- Multi-tab conflict behavior is confusing but does not lose confirmed saved work.
- Large canvas interaction is degraded but not frozen.
- Error message is technically correct but lacks enough detail for support triage.

Required action: file follow-up, document user workaround, and add coverage to the P1 suite map.

### P2

P2 failures do not block release:

- Cosmetic mismatch that does not hide controls or content.
- Non-critical accessibility label missing on secondary action.
- Export polish issue when in-app preview is correct.
- Minor localization inconsistency.

Required action: track normally and batch with polish work.

## Exact Commands

Install dependencies when the workspace is fresh:

```bash
pnpm -w install
```

Run all current web unit tests:

```bash
pnpm --filter @nomi/web test
```

Run unit tests in watch mode:

```bash
pnpm --filter @nomi/web test:watch
```

Run coverage:

```bash
pnpm --filter @nomi/web test:coverage
```

Run all current Playwright E2E tests:

```bash
pnpm --filter @nomi/web test:e2e
```

Run E2E against an already running local dev server:

```bash
pnpm --filter @nomi/web dev --host 127.0.0.1
NOMI_E2E_BASE_URL=http://127.0.0.1:5173 pnpm --filter @nomi/web test:e2e
```

Run E2E against a production preview:

```bash
pnpm --filter @nomi/web build
pnpm --filter @nomi/web preview --host 127.0.0.1
NOMI_E2E_BASE_URL=http://127.0.0.1:4173 pnpm --filter @nomi/web test:e2e
```

Run one E2E file:

```bash
pnpm --filter @nomi/web test:e2e -- creator-full-journey.spec.ts
```

Run one unit file:

```bash
pnpm --filter @nomi/web test -- unit/generationAssistantModes.test.ts
```

Run the current P0 unit files explicitly:

```bash
pnpm --filter @nomi/web test -- unit/generationAssistantModes.test.ts unit/generationCanvasReadOnly.test.tsx unit/importLegacyFlowGraph.test.ts unit/projectPersistence.contract.test.ts unit/timelineGenerationContracts.test.ts
```

Run the current P0 E2E files explicitly:

```bash
pnpm --filter @nomi/web test:e2e -- creator-full-journey.spec.ts generation-ai-modes.spec.ts share-readonly.spec.ts
```

Open the latest Playwright HTML report after an E2E run:

```bash
pnpm --filter @nomi/web exec playwright show-report playwright-report
```

## Coverage Gaps

Current uncommitted tests cover the default mocked P0 creator journey. The remaining gaps require a real provider environment, production-size data, or an agreed product rule:

- Real image/video provider execution is not automated.
- Preview E2E asserts surface/control reachability; browser-level active media rendering should be expanded when stable media fixtures are available.
- Provider 401/429/500/timeout/malformed JSON honesty is covered by default mocks for generic failure/malformed plan and unit-level catalog errors; a live provider matrix is still environment-dependent.
- Multi-tab conflict behavior lacks an agreed expected contract.
- Large canvas performance has a manual script but no automated threshold.
- Server sync failure behavior is not separated from local persistence in E2E.

## Maintenance Rules

- When a user-visible creator workflow changes, update this plan and the matching automated suite map in the same change.
- When adding a P0 bug fix, add a regression test that fails on the original bug.
- Keep mocked tests deterministic and fast; keep real generation tests opt-in and explicitly labeled.
- Do not weaken a P0 assertion to make CI pass. Reclassify only when the user impact is proven lower than stated here.
- Do not use generated placeholder URLs as proof of generation. They are fixtures, not assets.
