# From coding-agent rules to user-goal evidence

## Why

Repository tests answer whether code is consistent with its local contracts. They do not answer whether the user can complete the intended task. The evaluation contract adds that missing link without changing Nomi's runtime: an implementation is accepted only when its stated goal, automated proof, real-user journey, and recovery evidence agree.

## Goal

For every meaningful module or feature, an implementer writes a versioned goal contract before coding, keeps it beside the plan, and fills a report before the PR decision. The report distinguishes what machines verified from what a person observed. A missing journey or unavailable resource is recorded as `blocked` or `unverified`, never silently treated as pass.

## One evaluation loop

| Step | User-facing question | Existing owner used | Evidence |
|---|---|---|---|
| Goal | What should become easier or possible for the user? | Product/module owner and plan docs | One-sentence goal + success experience |
| Metrics | How will we know it worked? | Contract schema and domain rubric | Metric definition, method, target threshold, `targetOnly` flag |
| Implement | Does the change use the repository's real path? | Agent Runtime/Lane (`electron/agentLane/`), existing Skills, Tool/MCP registries | Diff and contract path; no parallel runtime/provider |
| Automated verify | Is deterministic state/wiring healthy? | Existing focused tests, `evals/lib/grading.mjs`, journey runners, typecheck/lint/build | Exact command and output; automated checks |
| Real journey | Can a person complete the task in the real app? | Existing Electron/Playwright isolation and product surface | Input, wait, inspect, action, edit/replay/export observations |
| Evidence | Can another reviewer reproduce the decision? | Versioned report schema | Run ID, commit, input, expected/observed state, screenshots/video/logs |
| PR decision | What is actually proven? | PR template and review | `pass`, `fail`, `blocked`, or `unverified` with failure/recovery reason |

## Director example

The Director pack applies the loop to one sentence: varied prompts should produce a whitebox scene, object motion, camera motion, and a complete playable preview that corresponds to the prompt. The matrix is deliberately only an evaluation target (`evals/director/prompt-cases.v1.json`), not a claim that the feature has been measured. The human protocol checks the viewport, play action, shot strip/timeline/camera path, local edit, replay, and export/hand-off. The rubric scores generation success, prompt correspondence, playable completeness, local-edit precision, time to first preview, and recoverability.

## Future changes

When code changes affect a contract, rerun its focused validator and the documented repository checks, then rerun the representative real-user journey. Add a case only when a real failure or newly agreed user goal justifies it. Compare measured reports by case ID and commit; keep target thresholds and observed results separate. A green unit suite without a real journey report remains `unverified`.

## Non-goals

This is not a generic Agent Builder, a second Runtime/Lane, a new Skill or Tool catalog, an LLM provider, or a replacement for Nomi's existing evaluation runners. It does not infer human judgments from automated output and does not change Director runtime behavior.
