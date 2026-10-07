# PR1014 Cards 23 / 24 / 25 evidence

- Base `origin/main`: `91d56ae54`
- Branch: `audit/pr1014-cards23-25`
- Scope: read-only UI fact inventory (Card 23), minimum-window × English matrix accounting (Card 24), Electron installer and real-walk attempt (Card 25)
- No product code or gate criteria changed.

## Card 23 — fact inventory

`card23-fact-table.md` contains the exhaustive source inventory at the base commit:

- `git grep -l -E 'IconCheck\\b' -- 'src/**/*.tsx'` → 54 files
- 128 rows for every `IconCheck` / `✓` occurrence within those files, including import occurrences (imports are explicitly labelled)
- dialog/confirm/modal/popover candidates: 154 files / 663 matching lines
- action-bar/toolbar candidates: 99 files / 469 matching lines
- dropdown/select candidates: 86 files / 273 matching lines

Each row includes repository-relative `file:line`, control classification, order evidence, nearby primary-action text, component/function, icon import, rule mapping, and the exact source line. The table is evidence only; it does not declare a product defect or a pass/fail conclusion.

## Card 24 — matrix accounting

`card24-window-en-matrix.md` enumerates all 379 design-lab states (24 screens) for the first required quadrant, minimum BrowserWindow 1100×720 × English. The full four-quadrant matrix is 379 × 2 locales × 2 window sizes = 1,516.

- Minimum-window × en: 0/379 executed. Every row is explicitly recorded as blocked.
- Remaining 1,137 quadrants: not run and listed with the reason.
- `electron/main.ts:279-284` is the source for 1100×720.
- `card24-min-en/` contains the raw attempts. A non-Electron Chromium attempt also hit a missing Playwright browser binary; it is not counted as product evidence.

The blockers are environmental, not UI conclusions. No overflow, clipping, or reachability result is claimed.

## Card 25 — installer and three-walk attempt

Installer diagnosis and repair:

1. Initial command (raw error in `card25-three-walks-en.raw.log` context):
   `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ ELECTRON_GET_USE_PROXY=true node node_modules/electron/install.js`
   failed before download because the default cache path was not writable: `ENOENT ... mkdir '<home>/.cache/electron'`.
2. Retry using the existing proxy and the same mirror with `XDG_CACHE_HOME=<repo>/.cache` succeeded (exit 0).
3. `node_modules/electron/dist/electron --version` reported `v43.4.1`; `node scripts/check-electron-install.mjs` reported declared/package/dist/runtime all `43.4.1`.
4. The temporary cache was removed after verification; no binary/cache is committed.

Three real full-walk attempts were made after repair: `pb06-failure-small-window`, `pb10-node-display-rules`, and `pb12-storyboard-click-expectations`, English variants. All three are recorded as `broken`, not pass. The precise shared blocker is in `card25-pb06-debug.raw.log`:

- `Missing X server or $DISPLAY`
- `The platform failed to initialize. Exiting.`
- Electron then exits with SIGTRAP.

`which xvfb-run` and `which Xvfb` returned no path; `DISPLAY` is unset. Therefore no real-walk UI result is claimed. `card25-three-walks-en.raw.log` preserves the three-run raw summary and exit code 2.

## Reproduction commands

```sh
git ls-remote https://github.com/aqm857886159/Nomi.git refs/heads/main refs/heads/audit/pr1014-cards23-25
node scripts/check-electron-install.mjs
node tests/ux/full-walk/run.mjs --only pb06,pb10,pb12 --locale en
```

The full-walk command requires a connected display (or an already-approved, existing Xvfb setup). This worktree had neither, so it was stopped rather than installing unrecognized software or claiming a green walk.
