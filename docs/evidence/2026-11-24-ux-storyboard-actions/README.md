# Storyboard add actions

The Phase 1 desktop captures show the disclosure on a zero-card section. Add shot sits at the end of the scrolling table and falls below the fold at 1280×800 and 1100×690. The original report supplied the same locale, theme, and viewport combinations below. The 1280×800 Chinese light capture came from its exploratory storyboard walk. [Coordinator approval](https://github.com/aqm857886159/Nomi/issues/1586#issuecomment-7126279479)

| Viewport | Locale | Theme | Before | After | Editable reference | Added shot |
| --- | --- | --- | --- | --- | --- | --- |
| 1280×800 | zh-CN | light | [Phase 1](before-phase1-1280x800.zh-CN.light.png) | [Initial](after-empty-1280x800.zh-CN.light.png) | [Reference](after-reference-1280x800.zh-CN.light.png) | [Shot 3](after-shot-added-1280x800.zh-CN.light.png) |
| 1440×900 | zh-CN | light | [Phase 1](before-phase1-1440x900.zh-CN.light.png) | [Initial](after-empty-1440x900.zh-CN.light.png) | [Reference](after-reference-1440x900.zh-CN.light.png) | [Shot 3](after-shot-added-1440x900.zh-CN.light.png) |
| 1440×900 | zh-CN | dark | [Phase 1](before-phase1-1440x900.zh-CN.dark.png) | [Initial](after-empty-1440x900.zh-CN.dark.png) | [Reference](after-reference-1440x900.zh-CN.dark.png) | [Shot 3](after-shot-added-1440x900.zh-CN.dark.png) |
| 1440×900 | en | light | [Phase 1](before-phase1-1440x900.en.light.png) | [Initial](after-empty-1440x900.en.light.png) | [Reference](after-reference-1440x900.en.light.png) | [Shot 3](after-shot-added-1440x900.en.light.png) |
| 1440×900 | en | dark | [Phase 1](before-phase1-1440x900.en.dark.png) | [Initial](after-empty-1440x900.en.dark.png) | [Reference](after-reference-1440x900.en.dark.png) | [Shot 3](after-shot-added-1440x900.en.dark.png) |
| 1100×690 | zh-CN | light | [Phase 1](before-phase1-1100x690.zh-CN.light.png) | [Initial](after-empty-1100x690.zh-CN.light.png) | [Reference](after-reference-1100x690.zh-CN.light.png) | [Shot 3](after-shot-added-1100x690.zh-CN.light.png) |
| 1100×690 | en | dark | [Phase 1](before-phase1-1100x690.en.dark.png) | [Initial](after-empty-1100x690.en.dark.png) | [Reference](after-reference-1100x690.en.dark.png) | [Shot 3](after-shot-added-1100x690.en.dark.png) |

## Desktop verification

All seven desktop runs used a fresh production build, an isolated empty profile on macOS, and the stock `verify-nomi` driver. A temporary launcher preset supplied the two exact sizes outside the stock presets. The real app rendered at the stated dimensions. At 1280×800 the exploratory baseline and the new run both used two shots. The other Phase 1 captures came from an established project and the new runs started from blank projects.

Each run used `up --locale <locale> --theme <theme> --size <viewport> --vendor fake-apimart`, then `goto storyboard`, `doctor`, DOM reads, clicks, fills, and screenshots. At scroll position zero both actions were hit-testable and the empty disclosure was absent. One click created the first editable reference. The fixed footer click revealed the entire third row before its prompt was filled. The back and generate controls were visible in each frame and passed the initial hit check.

After returning to the library and reopening the same project, each run read back 3 shots, reference name `Mara`, and shot 3 prompt `Mara opens the studio door.` The loopback server recorded two catalog GETs per run and zero submissions. The network guard recorded no external requests. The launcher sampled 205 `UIElement` observations and zero foreground grabs. The implementation line visually reviewed the screenshot matrix.

`node scripts/verify-line-meter.mjs docs/evidence/2026-11-24-ux-storyboard-actions` measured 0 new driver scripts, 0 driver lines, and 140 stock driver calls. [Command journal](commands.jsonl) · [Readbacks and launch receipts](readback.json)

## Regression counterexamples

| Version | Observed failure |
| --- | --- |
| Before the fix | The empty reference test expected zero disclosure controls and saw one. Clicking the existing reference action timed out because it was absent. |
| Before the fix | The footer test found three shots in its fixture and could not find its Add shot button within the footer. |
| Visible button with its write blocked | The click succeeded and the first reference row count stayed at zero. The interaction test failed on the missing row. The original callback was restored before build. |

## Scope and selectors

The empty and expanded reference action uses the existing `storyboardEditor.addAnchor` label (`添加参考` / `Add Reference`). The installed locale never contained the longer text from the Phase 1 description. Existing exact-name checks use these shorter labels. The old disclosure hook remains on the populated-state disclosure. Existing Add shot role selectors still match one button.

The draft-save walkthrough at `tests/ux/project-save-draft-contract.walk.mjs` has a zero-card fixture and its setup requires the old disclosure hook to exist before it clicks Add Reference. That setup is incompatible with the approved empty state and is outside the file allowlist. The desktop runs above exercise reopen and readback through the new empty state.

The implementation-line evidence is for local draft editing. Windows, paid generation, and a complete keyboard-only pass are unverified by this task. The initial recurring-fix contract is in this evidence directory because the initial file allowlist excluded the central contract directory. [Design card](../../plan/2026-11-24-ux-simple-storyboard-actions.md)

## Performance and gates

- perf-scenario：storyboard-plan-open 中位数 436.2 / p95 531.2 / 预算 1000 / 原始结果 docs/evidence/2026-11-24-ux-storyboard-actions/storyboard-plan-open.perf.json

The five samples opened a 320-shot plan in a 160-document project from a clean build of `669d5185c`. The report's source tree matches the production build stamp and its `dirty` flag is `false`. The initial implementation passed 17 changed-file tests and 54 other storyboard files, including the original editor, Agent handoff, and popover keyboard suites.

The board parity, token, and i18n commands passed. This checkout exposes changed-file lint through `node scripts/lint-changed.mjs`, which reported zero errors and zero added warnings. The commit's changed texts and images were scanned for local path markers. A repository-wide scan against the starting tree already found matching text in 823 tracked files.
