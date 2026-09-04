# Resident Composer real-user production journey

## Scope

Add one real Electron user-task walk from the Resident Composer through Agent planning, a real production write, human approval or rejection, receipt/revision, durable project state, and a cold restart read-back. The walk must use the visible composer and the real Electron/IPC/Host path; it must not seed Host items, reducer state, conversation results, or final project state.

This change does not touch the #462 storyboard canonical files and does not change CSS or visual direction.

## Gate contract

The journey is split into two explicit production boundaries:

1. Resident Composer: loopback HTTP is the only mocked external dependency. The real renderer, Agent runner, ProjectAgentHost, verified document-write adapter, approval card, receipt/revision journal, project persistence, and cold restart are exercised.
2. MCP stdio: the real `electron <repo>` stdio process and JSON-RPC framing are exercised against the isolated project. The test must prove that a production write is governed by the same Resident Host approval/receipt contract. If stdio writes directly through the MCP dispatcher, the journey records a blocker and fails closed; it does not treat direct disk mutation as approval evidence.

The H/B/E/T/N matrix is represented by the same task harness:

- H: normal intent, plan, approval, receipt, persistence, restart.
- B: empty, overlong, Unicode, cancellation, and duplicate submission behavior.
- E: malformed/illegal request, user rejection, stale revision, and no mutation after denial.
- T: Agent/model timeout and MCP/RPC timeout are distinct observations.
- N: loopback network failure and provider failure are distinct observations.

## TDD order

1. Add the journey with an assertion that MCP stdio production writes produce the Resident Host receipt/revision and approval boundary; run only that assertion and capture the red result.
2. Inspect the failure against the dispatcher, stdio server, Host receipt store, and real UI evidence.
3. Apply the smallest production change only if the missing capability is local and contract-safe. Otherwise leave the assertion red and document the exact blocker.
4. Run the same assertion green if repaired, then run the complete real Electron walk, persistence/restart checks, and packaged parity when a packaged binary is available.

## Evidence and coverage

The walk writes a machine-readable report containing mode, isolated project root, process identities, MCP request/response evidence, receipt/revision observations, restart observations, and the H/B/E/T/N outcome matrix. Screenshots are evidence only; no visual acceptance or CSS change is part of this task.

V8 coverage is reported only for changed production source. If the capability remains blocked and this patch changes no production source, the receipt explicitly says `changedProductionScope: []` and `v8: not-applicable`; it must not claim repository-wide 100% coverage. If production code changes, the receipt must show 100% statements and branches for that exact changed scope.

## Non-goals

- No #462 storyboard canonical edits.
- No CSS, layout, copy, or visual-direction redesign.
- No direct state injection to make a UI assertion pass.
- No merge, default-branch push, or PR approval.
