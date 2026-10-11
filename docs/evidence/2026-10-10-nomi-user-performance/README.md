# Nomi user-workflow measurement repair evidence

> 2026-10-11 independent-review correction: schema2 `visible` means decoded content, `ready` means production eligibility, and Shift means a document-level key diagnostic. Their original `failed_budget` raw statuses are retained, but first-feedback100ms and target-interactive500ms conclusions are withdrawn. Schema3 separately measures existing spinner/title feedback and a real project-menu response; see `profiles/README.md` and [current batch](current-batch-verification.md).

This Draft contains instrumentation, fixture evidence and bounded required-project chunk overlap and shared Markdown admission/failure corrections. Full-product user journeys and performance acceptance are incomplete; no significant improvement is claimed. Independent audit of `0ee67956b` invalidated the old coverage claims; see PR #1172 comment `6104262889` and `docs/plan/2026-10-11-nomi-performance-harness-repair.md`.

The source-linked inventory records 88 entry families and all 17 node kinds. The schema3 atomic `project.open` performance runner and the bounded next-action functional runners are implemented. Ten project/document/design/group actions and actual conversation-switch abort/cold recovery have receipts; entire P1/P2/D/B/C/A/R acceptance journeys remain planned. `entry-inventory.json` specifies every entry's precondition, input, visible completion, data assertion and original budget. `combination-plan.json` contains 16 original four-axis planned cases plus24 expanded13-axis planned cases covering695 eligible pairs and six mandatory higher-order scenarios, in addition to every-entry solo baselines. These plans do not count as UI execution.

## Measurement contract

- CLI accepts `--key value` and `--key=value`; empty/unknown/duplicate/non-finite selections fail.
- Each warm-up and measured repetition gets fresh project files and a profile. Hot primes that same profile through production open/back-to-library. OS page cache is uncontrolled. Cold process launch is setup, excluded from the atomic project's input latency; P1 cold-launch journey remains planned.
- Trusted browser pointerdown → existing opening spinner or matching project title feedback → production eligibility → a real trusted project-menu input and visibly expanded matching menu. Decoded visible known image is a separate content milestone. All marks and frame observations use the callback browser clock; historical document Shift is only a diagnostic. A mounted/loading card cannot satisfy content readiness. One document and monotonic browser clock; reload/missing probe invalidates the sample. No fixed settling delay or automatic feel checkpoint runs inside the action window.
- Keep raw frame/task entries and milestone timestamps, then derive window-clipped distributions. Analysis pools raw distributions within each scale/cache cell; it never takes percentiles of percentiles. Sample counts and unsupported p99 are explicit.
- CPU/process memory values are end snapshots only. Main long tasks, action CPU distributions, memory trends and recovery acceptance remain unimplemented, so even a correctly completed action is performance-inconclusive or budget-failed.
- The existing main-process offline network guard is installed with an empty allowlist; its receipt must prove all layers loaded. No provider, private media, real credential or permission change is authorized.
- Schema3 outputs use timestamp + UUID and exclusive writes. Commit, dirty-tree flag and source-file hashes identify the code used. Screenshots are collected after timing and retained before profile cleanup. Historical schema1 and schema2 samples without decoded-content/persistence receipts remain untouched and are untrusted for current latency.
- planned / implemented / executed / passed are separate facts. An empty, planned, blocked, invalid or incomplete report exits nonzero. This first batch cannot produce performance acceptance.

## Reproduction

```bash
node --test tests/ux/nomi-user-workflow-performance.node-test.mjs
node tests/ux/nomi-user-workflow-performance.e2e.mjs --scale small --scenario project.open --cache cold,hot --runs 5 --warmup 1
node scripts/summarize-nomi-user-performance.mjs
```

Electron identity, a fresh production build and a display are prerequisites. `project.open` is not the full P1 journey. `--scenario P1,D1` deliberately emits planned rows without launching; no source/UI acceptance is inferred from Node tests. Native macOS/Windows, real GPU/private material and paid-account baselines remain unverified.

The first batch's verification, audit corrections and remaining gaps are recorded in [first-batch-verification.md](first-batch-verification.md). Raw observations include failed and superseded trials; `analysis.md` rejects those lacking the current evidence contract.
