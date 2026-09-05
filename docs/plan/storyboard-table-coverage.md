# Storyboard table design-to-runtime coverage

## Scope

This audit maps the storyboard table samples to the current `StoryboardWorkspace` / `StoryboardPlanEditor` runtime. It covers the image-first anchor strip, row-by-row generation table, model capability parameters, references, result preview, and batch actions. The matrix is an inventory and contract skeleton; an entry marked `runtime-present-unmeasured` is not production proof.

## Source designs

- `docs/design/mockups/2026-09-01-storyboard-table-image-first.html` (v5 table and anchor strip)
- `docs/design/mockups/storyboard-options/A-inline-generation.html`
- `docs/design/mockups/storyboard-options/B-first-column-composer.html`
- `docs/design/mockups/storyboard-options/C-anchor-strip-inline-reference.html`
- `docs/design/reviews/2026-06-15-storyboard-editor-redesign.html` (legacy reference states)

## Evidence boundary

The current implementation has real rows, anchor cards, model selects, per-row references, preview callbacks, and batch selection. No real Electron journey currently proves that a user can upload image/video references accepted by each selected model, preserve aspect ratio through generation, play generated video in-row, or restore the table after restart. Static HTML samples do not count as those proofs.

## Next coding slices (priority order)

1. Add stable `data-storyboard-*` anchors for row output, reference slots, model capability warnings, aspect/duration controls, preview player, and batch generation status.
2. Define a model capability projection (accepted reference kinds/count, aspect options, duration) and render the same contract in row controls and validation errors.
3. Implement a real reference upload/mention path for image and video, including rejected-kind and over-limit states, with persisted reference IDs.
4. Add generated-image/video preview states (poster, playing, failed, retry) and ensure output dimensions follow the selected aspect.
5. Add an Electron journey covering anchors → row reference → model → batch generate → preview → restart readback.

## Verification

Run `node scripts/check-storyboard-table-coverage.mjs`, focused storyboard tests, `pnpm run typecheck`, `pnpm run build`, then the real Electron journey. Report each state as `runtime-present-measured`, `runtime-present-unmeasured`, `missing-runtime-anchor`, or `blocked`; never upgrade based on a mockup screenshot alone.
