# UX-simple PR-UX3 · Desktop evidence

Baseline `8ac07cffb`. The comparison uses isolated Nomi desktop windows and a locally encoded, two-second `360×640` MP4. The Phase 1 audit used generated shots. Both exercises go through the same shot library and timeline writer.

| Window content | Before | After empty export and clip rail | After first shot and real export |
| --- | --- | --- | --- |
| zh-CN light · 1280×800 | [Empty](zh-light/before-empty-collapsed.png), [first shot](zh-light/before-first-clip.png) | [Tooltip](zh-light/after-empty-tooltip.png), [片库](zh-light/after-empty-collapsed.png) | [9:16](zh-light/after-first-clip.png), [spec](zh-light/after-export-spec.png), [toast](zh-light/after-export-complete.png) |
| zh-CN dark · 1280×800 | [Empty](zh-dark/before-empty-collapsed.png), [first shot](zh-dark/before-first-clip.png) | [Tooltip](zh-dark/after-empty-tooltip.png), [片库](zh-dark/after-empty-collapsed.png) | [9:16](zh-dark/after-first-clip.png), [toast](zh-dark/after-export-complete.png) |
| en light · 1280×800 | [Empty](en-light/before-empty-collapsed.png), [first shot](en-light/before-first-clip.png) | [Tooltip](en-light/after-empty-tooltip.png), [Clips](en-light/after-empty-collapsed.png) | [9:16](en-light/after-first-clip.png), [toast](en-light/after-export-complete.png) |
| en dark · 1280×800 | [Empty](en-dark/before-empty-collapsed.png), [first shot](en-dark/before-first-clip.png) | [Tooltip](en-dark/after-empty-tooltip.png), [Clips](en-dark/after-empty-collapsed.png) | [9:16](en-dark/after-first-clip.png), [toast](en-dark/after-export-complete.png) |
| en dark · 1100×690 | [Empty](en-narrow/before-empty-collapsed.png), [first shot](en-narrow/before-first-clip.png) | [Tooltip](en-narrow/after-empty-tooltip.png), [Clips](en-narrow/after-empty-collapsed.png) | [9:16](en-narrow/after-first-clip.png), [toast](en-narrow/after-export-complete.png) |

## Real window and readback

1. Used `node tests/ux/ui.mjs up --locale <zh|en> --theme <light|dark> --size <1280x800|1100x690> --out <external-evidence-dir>` and `goto canvas`. Imported the source through the canvas file input with `setfile`. Clicked the Preview step, collapsed and reopened the Clips rail, then clicked the portrait shot.
2. Before the fix, the empty Export MP4 button was enabled, and the stage kept a `16:9` canvas after inserting the portrait video. After the fix, the empty button had native `disabled`, no native `title` and one app tooltip. The English rail label measured `horizontal-tb` and fit the 32 px rail at both widths.
3. The first click into the empty timeline set the stage to `9:16`. Its video decoded at `360×640`, filled the stage and enabled export. The enabled tooltip showed `9:16 · 1080p`. The project manifest read back `{"ratio":"9:16","source":"auto"}`. FFprobe verified the saved video at `1080×1920`, display aspect `9:16`.
4. Clicked the top-bar export button, then hovered the new action once the job finished to capture the success toast. In zh-CN light, clicked 打开文件夹 through the normal action. The notification uses the existing global placement, which still overlaps the docked Agent header as recorded separately in Phase 1 PR-UX2.
5. Targeted tests exercise the square and nearest-ratio cases, two timeline commit paths, exact default-as-manual persistence, and restoring a legacy payload. They also cover a positive-duration title-only export and show-in-folder IPC ownership. The isolated source MP4 and command journals stay outside the repository.

No new window-driver scripts were used.

## Timeline scrub

The registered scenario used 96 nodes, 24 video clips and five measured runs on the same Apple M5 Mac. The runner wrote its samples and JSON outside the checkout.

| Build | Median of frame-gap p95 | Across-run p95 | Long tasks |
| --- | ---: | ---: | ---: |
| Baseline `8ac07cffb` | 23.6 ms | 26.3 ms | 0 |
| PR-UX3 | 23.4 ms | 24.9 ms | 0 |

The change stays below the 33 ms budget. The scorer labeled both Mac runs a regression against the registered Windows machine's 18.3 ms median. The same-machine comparison shows a 0.2 ms lower median and 1.4 ms lower p95. The final production build, including the track-only subscription, was used for the final perf run. The five screenshot sets were taken before the subscription was narrowed. The rendered output and export behavior are the same.

## Square material and saved choices

The final build matched a `360×360` image to [1:1 on first insert](en-light/after-first-square.png). In a second project, selecting `16:9` explicitly in Inspector before adding the same image wrote `{"ratio":"16:9","source":"manual"}` and [kept that canvas after reopening](en-light/after-manual-reopened.png). The isolated [v0.24.0 library fixture](en-light/after-legacy-open.png) opened successfully with the legacy default and the existing media tracks.

The portrait path took one click to insert and one to export. The prior build required opening Inspector, opening its ratio picker and choosing 9:16 before the export could fill the canvas. The final tooltip also removed the need to open Inspector just to see the current export dimensions.
