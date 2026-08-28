# Timeline source-window and transition feedback

Date: 2026-08-28
> 状态：✅ 已完成（单测、类型检查、生产构建与 Electron/Playwright 桌面/窄窗走查通过）

## Goal

Make two already-persisted editing facts visible on the timeline without changing the editing kernel:

- a video/audio clip whose source window has been trimmed;
- an authored `cut`, `dissolve`, `fade`, `match_cut`, or `whip_pan` transition, including duration and whether the current renderer supports it.

This is a visibility and honesty layer. It does not claim that unsupported effects render.

## Scope

1. Add a pure visual-feedback resolver for source windows and transition connections.
2. Show a compact source-window strip inside trimmed video/audio clips.
3. Show authored transition markers at clip boundaries, with type, duration, connection state, and unsupported state.
4. Add Chinese and English copy through the existing `timelineEditor` namespace.
5. Add unit coverage plus a reusable Electron/Playwright user-task walkthrough with desktop and narrow-window screenshots.

## UI contract

- Source window: a thin, non-interactive strip at the top of a trimmed clip. The full strip is the source duration; the filled segment is the visible source range. A compact crop icon appears only when width permits. The clip label remains the primary content and narrow clips must not overflow.
- Transition: a small marker centered on the authored boundary, above clips but inside the track lane. Supported transitions use the track/accent treatment. Unsupported or disconnected transitions use warning treatment and explicit tooltip/accessible text.
- Stable test attributes: `data-timeline-source-window`, `data-timeline-transition`, `data-transition-type`, `data-connected`, and `data-supported`.
- No new persistent toolbar controls, cards, global CSS, raw color literals, or new design tokens. Use current Tailwind/token classes, Tabler icons, and i18n.

## Domain rules

- Source-window values derive only from `frameCount`, `offsetStartFrame`, and `offsetEndFrame`, clamped for malformed legacy data.
- A transition is connected only when both clip IDs exist on the same track, `from` precedes `to`, and their timeline boundaries touch.
- `cut`, `dissolve`, and `fade` are supported by the current renderer/export path. `match_cut` and `whip_pan` remain visibly unsupported.
- Invalid duration or endpoints are not silently hidden. The marker remains visible at the best deterministic boundary and reports an unsupported connection.

## Out of scope

- No changes to Pi Agent, MCPSQ, Agent panel ownership, MCP schemas, timeline persistence, undo/redo, preview resolver, export resolver, or FFmpeg implementation.
- No transition authoring UI, drag handles, arbitrary tracks, retiming, effect parameters, or audio crossfade.
- Do not edit `TimelinePreview.tsx`, `TimelineMiniPreview.tsx`, `timelineWebmExport.ts`, or the parallel preview/export resolver work.

## Rollback

Remove the visual resolver, marker component, Clip/Track/Panel wiring, i18n keys, tests, and this plan. Persisted project data is untouched, so rollback requires no migration.

## Acceptance gates

- Pure resolver tests cover untrimmed/trimmed/clamped source windows and all transition support/connection states.
- Static walkthrough contract covers the three real user tasks: inspect a trimmed source, verify a supported authored transition, and identify an unsupported/disconnected transition.
- Targeted Vitest, ESLint, typecheck, token, i18n, file-size, walkthrough, and test-system contract gates pass.
- Production Electron build is exercised with Playwright at desktop and narrow widths. Screenshots show no clipping, overlap, unreadable labels, or false supported state and are manually inspected.

## Result

- Added a pure resolver for source windows and authored transition connection/support state. `cut`, `dissolve`, and `fade` report preview/export parity; `match_cut` and `whip_pan` remain explicit unsupported states.
- Timeline clips now show trimmed source ranges with compact crop affordances only when the clip is wide enough. Transition markers reserve a dedicated lane, stack deterministic duplicate markers, and expose stable data attributes plus bilingual accessible descriptions.
- Verification: 14 focused resolver tests passed; `pnpm run typecheck` passed; `pnpm run build` passed; production Electron walkthrough passed at 1440×920 and 900×760 with screenshots in `tests/ux/shots/timeline-visual-feedback/`.
- The repository's existing Windows `check:walkthroughs` baseline-path separator issue remains outside this slice; the new walkthrough itself executes successfully.
