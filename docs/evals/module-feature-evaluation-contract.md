# Module/Feature Evaluation Contract

Use this contract when a code change has a user-visible goal that repository gates cannot prove by themselves. The JSON shape is versioned at `evals/contracts/module-feature-evaluation.schema.json`; the PR template points implementers to this page.

## Required before coding

Create a contract with:

- **User goal and success experience** — one sentence each, written from the user's point of view.
- **Metrics and thresholds** — each metric has an owner (`automated`, `human`, or both), a method, and `targetOnly: true` until measured.
- **Journey** — the real input, wait/processing step, user-visible inspection, primary action, local edit or recovery action, replay/export/hand-off, and pass/fail observation.
- **Evidence boundary** — deterministic checks versus human judgments. A test may prove state or wiring; it cannot prove that a user saw the intended result.
- **Failure and rollback** — what the user sees, how retry/undo restores the last good state, and what blocks a pass decision.
- **Non-goals** — explicit exclusions that stop scope from turning into a new runtime or provider.

## During implementation

Keep the contract in the change plan and use existing owners. For Nomi's agent path, Runtime/Lane execution remains in `electron/agentLane/`; Skills remain cataloged by the existing skill system; Tool/MCP descriptions remain sourced from the existing registries. The implementation may add domain fixtures and a report adapter, but must not create a second execution path to make an eval green.

## After implementation

1. Run focused automated checks, then the documented repo checks for the touched risk surface.
2. Run the real-user journey against the real app when the outcome is interactive or visual.
3. Record a deterministic report with `runId`, commit SHA, input, expected result, observed result, automated checks, human judgments, screenshots/video/log references, score, and failure reason.
4. Put the contract path and report path in the PR body. Use `pass` only when required evidence exists; use `blocked` or `unverified` when it does not.

## Director example

`evals/director/` instantiates this contract for the 3D Director. Its 24 cases cover indoor/outdoor/product/person prompts and one-shot/three-shot push/pull/orbit/follow/target-switch variants. The cases are target fixtures, not measured results. `scripts/eval-director.mjs validate` checks the matrix; `report` normalizes observed evidence while keeping automated checks separate from human judgments. `evals/director/real-user-protocol.md` defines the user journey from prompt through playable preview, local edit, replay, and export/hand-off.
