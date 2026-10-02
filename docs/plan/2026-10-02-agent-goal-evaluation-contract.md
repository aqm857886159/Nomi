# Agent coding goal-alignment evaluation contract

> 状态：🚧 进行中（draft PR scope, targets only）。This document defines a reusable contract for coding-agent work; the Director pack is the first example. It does not change the Agent Runtime, Lane, Skill, Tool, or MCP implementations.

## Why

Green unit tests and repository gates prove that code is internally healthy. They do not prove that the delivered experience reaches the user's goal. A coding agent can satisfy a checklist while omitting the user-visible outcome, changing the wrong object, or leaving recovery impossible. This contract makes the missing proof a required, reviewable artifact.

## Goal

Every non-trivial module or feature starts with a versioned contract that states the user goal, the observable success experience, metrics and target thresholds, a real user journey, the automated/human boundary, failure and rollback behavior, and the evidence needed for a PR decision. The implementation is evaluated against that contract at the end of the same change.

## Canonical files

- Generic contract schema: `evals/contracts/module-feature-evaluation.schema.json`.
- Generic report schema: `evals/contracts/module-feature-report.schema.json`.
- Director target matrix: `evals/director/prompt-cases.v1.json`.
- Director rubric: `evals/director/rubric.v1.json`.
- Director report contract and deterministic CLI: `evals/director/report.schema.json`, `scripts/eval-director.mjs`.
- Real-user protocol: `evals/director/real-user-protocol.md`.
- PR entry point: `.github/PULL_REQUEST_TEMPLATE.md`.

## Coding-agent workflow

1. **Goal** — write one user sentence and the success experience before editing code. Name the module and the user-visible outcome.
2. **Metrics** — choose observable metrics, owners, measurement methods, and thresholds. Mark every threshold `targetOnly: true` until a real run produces evidence.
3. **Implementation** — use the existing Runtime/Lane/Skill/Tool contracts. Do not introduce a parallel runner, provider, or tool registry. Keep the contract path in the plan and PR.
4. **Automated verification** — run the smallest focused test first, then the documented typecheck/lint/build or gates required by the touched paths. Automated checks cover deterministic facts such as schema, persistence, wiring, and playable-state invariants.
5. **Real-user journey** — run the shortest representative journey in the real app. Observe the user-visible state and capture screenshots/video when the contract names a visual or interactive outcome. Do not replace this step with a unit test.
6. **Evidence** — record run ID, commit SHA, prompt/input, expected card/state, observed result, automated checks, human judgments, artifacts, score, and failure reason. Keep infra errors separate from product failures.
7. **PR decision** — choose `pass`, `fail`, `blocked`, or `unverified`. A green code suite cannot upgrade `blocked` or `unverified` to `pass`; missing real-user evidence stays explicit.

## Existing system ownership

- **Runtime/Lane**: `docs/ARCHITECTURE-NOW.md:40-42` records `electron/agentLane/` as the only production agent path and `verbDeclarations.ts`/`modelFacingToolRegistry.ts` as the tool-face owners. The evaluation invokes and observes that path; it does not reimplement it.
- **Skill**: the existing skill catalog and repository instructions define how an agent reads project rules and plans work. This contract is a required work artifact, not a new runtime skill.
- **Tool/MCP**: tool schemas and MCP projections remain owned by the existing registries (`docs/ARCHITECTURE-NOW.md:42,62,65`). Reports may reference tool evidence, but the eval pack does not add aliases or bypass approval/lease boundaries.
- **Journey/evidence**: existing Lane C primitives in `evals/lib/journeyRunner.mjs:1-7` and `evals/lib/isoApp.mjs` provide real Electron isolation and persisted-state evidence. The Director smoke path only validates the fixture/report contract; a live app run is a future measured run.

## Acceptance and thresholds

The contract defines P0 thresholds as targets only. A target is not a result until a report contains the run ID, commit, and evidence. If a required resource is unavailable, record `blocked` or `unverified` and the exact blocker.

The first Director target is: varied prompts produce a whitebox scene, object motion, camera motion, and a complete playable preview whose content corresponds to the prompt. Its six dimensions and target thresholds live in `evals/director/rubric.v1.json`.

## Non-goals

- No generic Agent Builder, replacement runtime, second Lane, new LLM provider, or parallel Skill/Tool/MCP registry.
- No claim that the initial Director matrix is measured coverage; all 24 cases are evaluation targets until real runs populate reports.
- No automatic human-judgment fabrication, visual score inference from unit tests, or replacement of existing app journey runners.
- No Director runtime behavior change in this PR.

## Rollback

The change is additive. Revert the contract docs, schemas, fixture pack, CLI, smoke test, and PR template together; existing `evals/lib`, Director runtime, and production agent paths remain unchanged.
