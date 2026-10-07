# Card 24 — minimum-window × English design-lab matrix

This is a read-only geometry audit on `origin/main` `520466c13af5ccc9e4b2cafba89dcf05ca41388c`. The probe sets `nomi:locale:v1` to `en` before every page and records the raw row for every state at both the production minimum content size and a normal reference size. It does not click, mutate state, or intercept requests.

The production minimum comes directly from [`electron/main.ts:283`](../../../electron/main.ts:283) and [`electron/main.ts:284`](../../../electron/main.ts:284): `minWidth: 1100` and `minHeight: 720`.

## Matrix

- 24 design-lab screens, 379 states, 758 cells (each state × 2 sizes).
- Sizes: `1100×720` (`min-1100x720`) and `1440×900` (`normal-1440x900`).
- Checks: visible text overflow (excluding intentional ellipsis/tooltips), outside-viewport geometry, ancestor clipping, interactive target below 24 px, and center hit-test occlusion.
- Raw matrix: [`raw/card24/matrix.json`](raw/card24/matrix.json).
- Raw run log and complete timeout rows: [`raw/card24-run-1.log`](raw/card24-run-1.log).
- Findings have a PNG captured at the same cell in [`raw/card24/`](raw/card24/).

## Result

| row result | cells |
|---|---:|
| clean | 230 |
| findings | 488 |
| readiness errors | 40 |
| total | 758 |

All non-error rows report `language: "en"`. The 40 readiness errors are explicit `page.waitForFunction(window.__designLabReady)` 180-second timeouts in the `director-refine` 3D-heavy screen; they are preserved as rows in `matrix.json` and listed verbatim in the raw log. They are probe readiness failures, not silently treated as clean geometry.

The probe itself is [`tests/ux/card24-window-matrix.mjs`](../../../tests/ux/card24-window-matrix.mjs). Re-run from the worktree with:

```bash
node --check tests/ux/card24-window-matrix.mjs
CARD24_CONCURRENCY=8 node tests/ux/card24-window-matrix.mjs \
  --out docs/research/2026-10-07-pr1014-cards23-25/raw/card24
```
