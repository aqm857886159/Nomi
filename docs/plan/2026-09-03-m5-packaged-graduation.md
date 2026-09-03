# M5 packaged graduation plan

状态：🚧 进行中

## Scope

- Slice A: run the existing zero-quota MCP L2 creative journey against the
  built macOS app bundle and its bundled MCP stdio launcher.
- Slice B: record packaged evidence for M0-M4 commitments, including explicit
  gaps where `agentHostEnabled=false` or an audited boundary is not present.
- Slice C: add a release runbook for real Claude/Codex hosts and paid vendor
  generation. The existing Mac Package CI smoke remains the blocking packaged
  check; full L2 is not wired while its real parity failure is open.

## Non-goals

- Do not enable `agentHostEnabled`.
- Do not call a real host, spend vendor quota, publish, or change production
  Electron behavior in CI.
- Do not weaken assertions, budgets, or the known load-sensitive performance
  checks.

## Acceptance and rollback

- Development and packaged L2 journeys must use the same assertions and the
  same fake APIMart loopback; packaged MCP must resolve only from the bundle.
- Existing packaged smoke, focused system tests, typecheck, build, and the
  repository gates must exit 0. The known performance false-red is reported,
  not repaired here.
- Rollback is limited to reverting the M5 task commits; no main/default branch
  or existing worktree is touched.

## Delivery

Each slice is kept in its own commit and m5/* branch/PR where GitHub permits a
stacked review. PRs remain open and are not merged by this task.
