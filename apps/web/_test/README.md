# Nomi Web Test Harness

This directory contains the web test harness that backs `docs/creator-full-flow-test-plan.md`.

## Commands

```bash
pnpm --filter @nomi/web test
pnpm --filter @nomi/web test:e2e
pnpm --filter @nomi/web build
```

Run E2E against an existing app:

```bash
NOMI_E2E_BASE_URL=http://127.0.0.1:5173 pnpm --filter @nomi/web test:e2e
```

## Current Coverage

- `unit/aiComposerKeyboard.test.ts`: Enter submits, Shift+Enter and IME composition keep editing.
- `unit/aiReplyActionButton.test.tsx`: assistant reply action inserts into the active document or copies when no document is active.
- `unit/generationAssistantModes.test.ts`: Agent/chat/refine assistant mode contract.
- `unit/generationCanvasReadOnly.test.tsx`: read-only canvas hides editing/generation controls.
- `unit/generationCanvasStore.test.ts` and `unit/generationCanvasStore.contract.test.ts`: canvas CRUD, history, clipboard, run state, result history, and snapshot normalization.
- `unit/importLegacyFlowGraph.test.ts`: legacy flow import into V2 generation canvas snapshots.
- `unit/modelOptionsContracts.test.ts`: dynamic model catalog options, explicit empty/error states, and no hard-coded model fallback.
- `unit/projectPersistence.contract.test.ts`: local project schema, revision, thumbnail, legacy record normalization, and explicit missing-record errors.
- `unit/sendGenerationNodeToTimeline.test.ts`, `unit/timelineContracts.test.ts`, and `unit/timelineGenerationContracts.test.ts`: timeline math, playback, clip insertion, overlap prevention, split/resize behavior, and generation-to-timeline failure states.
- `e2e/creator-full-journey.spec.ts`: project library, creation writing, creation AI, generation planning, mocked generation, preview, refresh, and reopen persistence.
- `e2e/creation-ai.spec.ts`: creation AI Enter behavior, Shift+Enter line break behavior, and paste-to-document action.
- `e2e/generation-canvas-workflows.spec.ts`: canvas CRUD, model selection, mocked generation, timeline, preview, model catalog drawer, and constrained layout.
- `e2e/generation-ai-modes.spec.ts`: browser-level assistant mode behavior with mocked agents response.
- `e2e/canvas-operations.spec.ts`: node kind creation, selection, copy/paste/delete, and disabled video generation without upstream asset evidence.
- `e2e/model-catalog-and-failures.spec.ts`: model integration entry points and explicit agent failure/malformed plan states.
- `e2e/mobile-layout.spec.ts`: creation, generation, and preview surfaces remain reachable on constrained viewports.
- `e2e/share-readonly.spec.ts`: public share route rendering and read-only controls.

## Policy

Default tests use mocks for deterministic UI and state contracts. They do not prove real provider generation. Any real image/video generation smoke must be opt-in, named clearly in the command or report, and must assert reachable persisted asset URLs.
