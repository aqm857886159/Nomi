# Cold critical-path stage: CI contrast and withdrawn admission experiment

The transition experiment at `16fc56a190c5b38193cdb7c3f332c70c5ea1f077` is withdrawn. Final tracked `src/` and `electron/` contents, and the five production-admission tests, match delivered `b28959af7aec2401e26bfbfdeb5508bb7ffe8f31` exactly. The shared early feedback and required-code overlap remain; no new production performance change is delivered in this stage.

## Exact B289 CI and local Unit contrast

[Quality Gate38117963767](https://github.com/aqm857886159/Nomi/actions/runs/38117963767) completed `success` on exact B289. Contracts, all three Unit shards, all four E2E jobs, both Canvas Acceptance jobs, both Core Flow jobs, Tool Face, Validation Scope, Mac Package and aggregate passed. Canvas Performance and Desktop Preview were skipped. The [remote receipt](ci-b289-remote-result.json) preserves job IDs. Mac Package success is not a native Mac performance baseline.

The original full local Unit run failed16 files/21 tests. All16 files were selected under identical settings at B289 and main `4e1eecdad8c3ab6a3d44d38065faeb769c613be4`, in two sequential groups: both sides fail15 files/20 tests, with63 passing tests and92 tests blocked by existing failing setup hooks. The previously corrected canvas factory assertion is the only branch-specific difference, and now passes23/23 on both. The other15 test files have identical SHA256. Relevant production owners and configuration are unchanged. [Contrast and limits](cold-admission-unit-contrast.md), [machine receipt](cold-admission-unit-contrast.json).

- Ten browser files fail because the configured Playwright Chromium executable is absent before meaningful UI work.
- `mcpStdio` fails importing capability keys before its `beforeEach` temp-root setup, with the same ENOENT at both revisions.
- `generationParity` and `paidPostCode` hit their existing120s setup /30s catalog-APIMart timeout on both revisions; internal causes remain unproven.
- Antigravity descendant cleanup/cancellation and tryBudget shared-budget assertions fail on both; generic zombies are not claimed as the exact Antigravity cause.

No unrelated repair, retry/concurrency/budget change or populated user directory was introduced. Baseline dependencies linked, but its Electron postinstall download failed; that setup limitation is preserved. Remote Unit logs independently pass the named non-browser cases. These results establish shared baseline failures, not a blanket environment diagnosis.

## Post-studio interval and native counterfactual

The immutable06:01 trace on clean314a records studio request330.700ms → node mark745.500ms:72.920ms preparation/scheduling interval,229.088ms scheduled wait,89.013ms commit timer and23.779ms post-commit/effects interval. Renderer timer45 installs at403.620ms and fires632.708ms; compiled `Qy` matches installed React/ReactDOM19.3's `Throttled`300ms reveal boundary. Preparation and post-commit intervals are not pure CPU. Main CrBrowserMain's127.675ms/8916-microtask interval is separate. [Source-matched split](cold-admission-trace-breakdown.json).

The counterfactual uses the same small fixture, unchanged timing owners, Linux/Xvfb :97, Electron43.4.1 and1280×933 viewport, one warmup plus five measured attempts per cache, without concurrent heavy tests/builds. OS page cache remains uncontrolled. Independent p95 recomputation and all object/screenshot hashes are in [the seal](cold-admission-counterfactual.json).

| Source and batch | Cold feedback p95 | Cold actual menu completion p95 | Hot actual menu completion p95 | Disposition |
| --- | ---: | ---: | ---: | --- |
| Prior clean314a, same production as B289 |18.30ms |822.18ms |102.54ms | Retained production; cold budget failed |
| Clean16fc transition,06:52 batch |14.36ms |667.16ms |124.24ms | Withdrawn experiment; cold budget failed |

The667.16ms result belongs only to the withdrawn source, not the delivered implementation. Five measured samples cannot establish a significant improvement or regression. Spinner feedback, decoded content and real trusted matching-menu response remain separate observations. Runner exit2 is retained: cold `failed_budget`, hot `inconclusive`; CPU/memory/teardown and other acceptance dimensions are missing. All12 attempts satisfy the bounded project/domain-signature and offline-guard assertions; these do not prove preservation of every legacy payload byte.

The separate07:02 diagnostic trace on clean16fc is not pooled into the baseline. Studio request327.20ms → node mark598.20ms is271.00ms. Retry timer54 schedules228ms at460.036ms but is removed543.454ms; timer55 schedules138ms at550.158ms and is removed557.133ms. Neither fires before the first node, and no `Qy` executes in that renderer window. Scheduling still occurs; remaining loading/render/wait intervals are not declared closed. Main legacy migration/import126.35/125.05ms and workspace open/import43.11/9.27ms retain their original operations. Whole CPU profiles remain unsuitable for CPU-percentage claims. The seal links the unmodified diagnostic receipt, traces and profiles.

## Independent review and withdrawal

Readonly review line `/root/harness_review` found two Important gaps in16fc:

1. Studio was queued before a synchronously failing navigation, so transition error capture could report failure while still admitting studio. An additional actual-callback assertion produced7/8 RED; temporary navigation-first ordering produced8/8 GREEN. Both the experiment and that temporary correction are withdrawn; their [RED](checks/cold-admission-route-red.txt) and [GREEN](checks/cold-admission-route-green.txt) are historical candidate evidence, not final-source test results.
2. `hydrateProjectView` returns after queuing admission, before lazy listeners mount. `revealProjectTarget` can dispatch task-center/focus events immediately; `TaskCenterButton` and ReactFlow register listeners in their own effects. Existing canvas `isReady` and Surface commit signify data/domain readiness; parent App/Shell effects cannot prove nested lazy ReactFlow readiness. B289 has the same latent debt, while transition enlarges the window. No mounted notification recovery or queued-transition supersession regression was executed.

There is no existing listener-ready ACK that safely closes this class. A renewed candidate needs project-lived notification intent at its existing owner and actual consumer receipts, preserving stale-project guards. This expands ownership beyond the minimal performance scheduling experiment, so the candidate is withdrawn. The [original proposal](cold-admission-withdrawn-proposal.json) is an immutable archived proposal, not an active `docs/fixes` remediation contract or completed structural prevention. The escape ledger stays `reviewed` with no completion commits.

## Retained blockers and final validation

The retained production's prior clean314a receipt still records822.18ms cold actual completion. It is not relabelled as a measurement of the final documentation head; restoration is proved by byte identity. Cold500ms acceptance, remaining main import and renderer work, real display/Mac/Windows/GPU, CPU/memory/teardown and reliable p99 remain open. Native rename remains an executed failed attempt with legacy payload loss; this stage changes none of it.

Markdown8/8 fault-containment evidence used an active auto-reload cooldown. Default first chunk failure reloads the renderer; active-Agent interruption/recovery in that default path remains unverified. No product reload policy was suppressed or changed.

Final restored-source workflow checks pass51/51 and root-cause checks54/54. Selected normal pre-push gates, fresh build and exact new-head remote CI are reported separately after their commands finish. No merge or publication is authorized or performed.
