# Nomi Comprehensive Test System Design

## Status

Approved in conversation on 2026-07-14. The user selected the unified, long-lived test system and explicitly required detailed functional test plans and complete execution against the local Electron application.

## Goal

Build one trustworthy test system that answers three questions after every meaningful change:

1. Is the code healthy?
2. Can users complete Nomi's real creation journeys?
3. Is the produced experience and media actually correct?

The system must never report green when it ran no meaningful cases. Every defect found during this effort must be reproduced, traced to its root cause, fixed test-first, and retained as a regression test.

## Current State and Confirmed Baseline

- Vitest currently discovers 275 files: 274 pass and 1 is skipped; 2,596 tests pass and 1 is skipped.
- The production renderer and Electron build complete successfully.
- `tests/ux/smoke.e2e.mjs` passes 10 assertions covering launch, catalog seeding, project library, project opening, and the workbench toolbar.
- The repository contains roughly 273 unit/integration test files and 63 executable UX/E2E/walkthrough scripts.
- The current `pnpm test:journeys` command exits zero while running zero journeys because J3/J5 were removed. This is a confirmed false-green defect and the first required repair.
- Existing infrastructure is substantial but fragmented across Vitest, Electron scripts, journey evals, generation evals, walkthroughs, design-fidelity checks, performance probes, and manual audit documents.

## Product Testing Model

### Layer 0 — Repository and Build Health

Run deterministic gates for file size, design tokens, dangling tokens, generated archetype defaults, lint, type checking, unit/integration tests, and production builds. These checks protect code health but never substitute for product validation.

### Layer 1 — Functional Units and Domain Rules

Test pure functions, stores, persistence, catalog mappings, request translation, task state, export planning, canvas graph rules, agent transactions, and recovery policies. Add coverage reporting as diagnostic evidence, using ratcheted baselines rather than chasing a vanity percentage.

### Layer 2 — Electron Integration Contracts

Exercise the real renderer-to-preload-to-IPC-to-main-process chain in isolated profiles. Cover project creation/open/save/reload, asset localization, model catalog seeding, task submission and recovery, generated asset attachment, timeline persistence, and ffmpeg export.

### Layer 3 — Detailed User-Facing Functions

Maintain a product capability inventory. Each visible capability must have four minimum classes of test:

- normal use;
- boundary or extreme state;
- failure and recovery;
- persistence across reload/restart.

Interactive surfaces additionally require geometry and visual checks for clipping, overflow, overlap, focus, keyboard use, dark mode, and constrained window sizes.

### Layer 4 — Complete Creation Journeys

Automate and evidence Nomi's standard journeys:

- J1 product copy to generation-ready promotional video;
- J2 story to styled comic short with character/scene references;
- J3 new-user first success;
- J4 reference-image-driven generation;
- J5 modify an existing node and export;
- extension journeys for camera movement, batch generation, interruption recovery, and final-media validation where existing product capabilities justify them.

Every journey consists of checkpoints. A checkpoint records action, expected state, actual state, screenshot, relevant persisted project state, trace/events, timing, and responsibility layer on failure.

### Layer 5 — Real Generation and Final Artifact Quality

Use configured local credentials and the user's default authorization for evaluation spend. Validate outbound model identity, mode and parameters; reference transmission; task polling; asset download and localization; canvas/timeline attachment; and final export.

The final artifact is checked separately across video, audio, shot structure, reference adherence, and stability. An MP4 merely existing is insufficient. Evidence includes ffprobe output, duration, stream inventory, sampled keyframes, shot boundaries, audio presence, and visual review.

## Detailed Functional Coverage Matrix

The committed matrix is the source of truth for scope. Rows are product capabilities; columns are test dimensions. Initial capability groups are:

1. Application lifecycle: cold launch, second instance, restart, crash recovery, isolated profile.
2. Project library: empty state, creation, open, rename, delete, missing/corrupt project, recent ordering.
3. Creation workspace: text editing, AI send/stream/approval/rejection, proposal editing, undo, failed turn recovery.
4. Generation canvas: add/select/move/connect/delete/duplicate nodes, zoom/pan/fit, keyboard shortcuts, undo/redo, save/reload.
5. Node types: text, image, video, audio, panorama, whiteboard, 3D scene, and supported utility nodes.
6. Model selection and parameters: vendor/model/mode changes, archetype defaults, unsupported values, stale parameter removal, reference limits.
7. References and assets: upload/import/capture, drag and drop, localization, missing file, duplicate, reorder, removal, cross-node propagation.
8. Generation execution: spending guard, batch plan, submit, poll, success, partial success, empty response, timeout, retry, cancellation, recovery.
9. 3D director: presets, staging, camera movement, preview capture, context loss recovery, serialization, downstream reference wiring.
10. Timeline and preview: add/reorder/trim/scrub/play, audio/video synchronization, persistence, invalid media.
11. Export: plan, ffmpeg command/filtergraph, progress, cancel, missing executable/media, output validation.
12. Settings and onboarding: credentials, model discovery, validation, secret handling, first-run and repeat-run behavior.
13. Skills, prompt library, memory, browser capture, and capability-core entry points.
14. Cross-cutting experience: light/dark mode, small/large windows, popovers at viewport edges, keyboard focus, error clarity, latency feedback.

Each row records automation level, fixture, test file, last run, evidence, and uncovered reason. A capability cannot be marked covered solely because another broad journey happens to pass through its screen.

## Case Design Rules

Cases are generated from `capability × state × boundary × failure`, then curated to remove meaningless combinations.

For example, a video node includes at least:

- empty configuration and generation-ready configuration;
- text-to-video, image-to-video, first/last-frame, and multi-reference modes when supported by the selected model profile;
- switching models and modes without leaking stale provider-specific parameters;
- zero, one, maximum, over-limit, missing, and invalid references;
- duplicate submit protection, cancellation, navigation during execution, timeout, authentication failure, empty vendor response, and recovery;
- save/reload and full application restart during relevant states;
- successful result attachment to canvas, timeline, preview, and export;
- popover geometry at canvas/viewport edges and constrained window sizes.

Tests assert public behavior and persisted/domain contracts rather than duplicating implementation details. Mocks are used only at external boundaries; high-risk paths also run against real Electron and real providers.

## Anti-False-Green Invariants

- A requested suite with zero selected cases exits nonzero.
- Every suite prints discovered, selected, passed, failed, skipped, and unsupported counts.
- A skipped case requires a machine-readable reason; unexpected skips fail release mode.
- Required journey IDs are asserted against the registry.
- A report is valid only when evidence artifacts referenced by failed checkpoints exist.
- Infrastructure failures are distinct from product failures and both cause nonzero exit in required runs.
- Real-generation success requires a localized, inspectable output asset; a vendor task ID alone is not success.
- Export success requires validated media streams and duration, not merely process exit zero.

## Test Data and Isolation

- Every automated Electron case uses temporary user-data, settings, and projects directories.
- Fixtures are small, deterministic, and checked into a dedicated test-fixture area when licensing permits.
- Provider tests record metadata and hashes, not secrets. Credentials remain in the user's normal secure store.
- Real generation cases have explicit maximum attempts and spend metadata. Existing hard caps remain in force.
- Tests clean up processes and temporary directories even after failure; retained evidence is copied into the run directory first.

## Orchestration and Reports

Provide a single manifest-driven runner with profiles such as quick, CI, full-local, real-generation, and release. It reuses existing scripts rather than creating parallel implementations.

The run report includes:

- commit, environment, profile, duration, and case counts;
- results by layer and capability;
- journey checkpoint drill-down;
- root-cause ownership layer: UI, state/domain, IPC, runtime, provider, filesystem, export, or test infrastructure;
- screenshots, traces, persisted state, logs, generated media, and media-probe evidence;
- coverage deltas and uncovered capability rows;
- spend/tokens for evaluation cases;
- a concise release verdict that cannot hide failures behind aggregate scores.

## Defect Closure Workflow

1. Reproduce consistently and preserve evidence.
2. Trace the bad state backward across component boundaries.
3. State one root-cause hypothesis and test it minimally.
4. Add the smallest failing regression test and observe the expected failure.
5. Implement one root-cause fix.
6. Observe the regression test pass, then run its containing layer and affected journeys.
7. Record the fixed capability and evidence in the matrix/report.

No symptom-only workaround, parallel fallback implementation, or unresolved discovered backlog is considered completion.

## Scope Boundaries

- This effort does not replace Nomi's product UI with a test dashboard.
- It does not introduce a new general-purpose test framework unless existing Vitest/Playwright/Electron infrastructure demonstrably cannot meet a requirement.
- It does not make every visual-quality judgment a brittle pixel snapshot. Deterministic geometry and contract assertions form the lower bound; human/VLM review handles genuinely perceptual quality.
- It preserves existing useful tests and deletes or migrates obsolete parallel scripts only when their coverage is absorbed by the unified system.

## Acceptance Criteria

- The false-green journey command is impossible: zero selected required cases fails.
- The capability matrix covers every current user-visible module and identifies every remaining unsupported external boundary honestly.
- Normal, boundary, failure/recovery, and persistence cases exist for every high-risk capability.
- J1–J5 execute against the current local application with checkpoint evidence; real-provider portions either run successfully or produce a precise external/credential limitation with all preceding local checkpoints validated.
- At least one real generation reaches a localized asset and at least one complete timeline/export path produces a media file validated by probe and human inspection.
- Every product defect discovered during execution is fixed at root cause and protected by a regression test.
- All repository gates pass on the final isolated branch.
- Final manual Electron walkthrough verifies visual and interaction quality rather than relying only on assertions.

## Rollback

The work is isolated on `codex/full-test-system`. Each logical repair is committed separately. Test orchestration can be reverted independently from product fixes; no existing passing coverage is removed until equivalent coverage is demonstrated.
