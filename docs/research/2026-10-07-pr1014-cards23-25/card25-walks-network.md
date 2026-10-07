# Card 25 — Electron startup, real walks, and outbound request evidence

This Card 25 run used the repaired Electron 43.4.1 runtime and fresh isolated profiles supplied by the existing UX walk launchers. It did not call a paid generation provider. A temporary, uncommitted main-process preload recorded Electron `session.webRequest.onBeforeRequest` events and Node diagnostics channels (`undici:request:create`, `http.client.request.start`); the callback immediately returned and never blocked a request. Query strings were removed before writing raw JSONL.

The environment initially had no X server. The exact failure is retained in [`raw/card25-no-display-blocker.log`](raw/card25-no-display-blocker.log). I started an Xorg dummy display `:99` for the real Electron walks; this changed no product files.

## Walk results

| run | command | result | raw stdout | raw requests |
|---|---|---|---|---|
| smoke | `node tests/ux/smoke.e2e.mjs` | **PASS — 18 assertions** | [`smoke.stdout.log`](raw/card25/smoke.stdout.log) | [`smoke-network.jsonl`](raw/card25/smoke-network.jsonl) |
| strategy | `node tests/ux/storyboard-strategy-no-model.walk.mjs` | **PASS**; closed 53 video models and verified the no-video-model state | [`strategy-no-model.stdout.log`](raw/card25/strategy-no-model.stdout.log) | [`strategy-no-model-network.jsonl`](raw/card25/strategy-no-model-network.jsonl) |
| narrow row | `node tests/ux/storyboard-narrow-row.walk.mjs` | **FAILED existing visual assertions** (three placeholder spill findings: 17/19/17 px); all four locale/density screenshots were produced | [`storyboard-narrow-row.stdout.log`](raw/card25/storyboard-narrow-row.stdout.log) | [`storyboard-narrow-row-network.jsonl`](raw/card25/storyboard-narrow-row-network.jsonl) |
| adapter unlock | `node tests/ux/adapter-failed-unlock.walk.mjs` | **COMPLETED**; captured the seeded failed-adapter panel, but the expected model row was absent in this fixture | [`adapter-failed-unlock.stdout.log`](raw/card25/adapter-failed-unlock.stdout.log) | [`adapter-failed-unlock-network.jsonl`](raw/card25/adapter-failed-unlock-network.jsonl) |
| vendor identity (additional) | `node tests/ux/vendor-connection-identity.walk.mjs` | **FAILED** at the fake gateway connection-list assertion (`actual 0`), retained as raw evidence | [`vendor-connection-identity.stdout.log`](raw/card25/vendor-connection-identity.stdout.log) | [`vendor-connection-identity-network.jsonl`](raw/card25/vendor-connection-identity-network.jsonl) |

The three real `.walk.mjs` runs are strategy, narrow-row, and adapter-unlock. The smoke run is the requested smoke equivalent. The vendor walk was an additional zero-cost attempt and is reported as failed rather than hidden.

## Design-lab startup

`design-lab-primitives-forms.walk.mjs` completed all 8 states and produced the contact sheet. The first attempt exposed the missing Playwright headless-shell cache; the successful rerun pointed Playwright at the preinstalled Chromium through an isolated browser-path shim. The raw startup output, including the harmless “port 5657 already in use” reuse warning, is [`design-lab-primitives-forms.stdout.log`](raw/card25/design-lab-primitives-forms.stdout.log).

## Request counts

Across the five instrumented Electron runs there are 562 raw JSONL events:

- 545 renderer `electron-webRequest` events and 17 main-process Node diagnostic events.
- 525 local/file or loopback events.
- 11 `raw.githubusercontent.com` main-process reads from the built-in prompt catalogs.
- 24 `skill-preview` custom-protocol renderer reads and 2 `asset` custom-protocol reads.
- No provider API host or generation endpoint was observed; no paid generation was started.

Every raw event includes `timestamp`, `step`, `process`, `host`, query-free `path`, and up to the first eight captured stack frames. The raw JSONL files are the source of truth for host/path and process attribution.
