# Real user test gates

Result: **BLOCKED** · provider=live · selected=1 · passed=0 · failed=0 · blocked=1

| Journey | Provider | Live | H | B | E | T | N | Persistence | Restart | Visual |
|---|---|---|---|---|---|---|---|---|---|---|
| production-mcp | blocked | blocked | blocked | blocked | blocked | blocked | blocked | blocked | blocked | blocked |

## Executed command evidence

- production-mcp: **blocked** · `node tests/ux/production-mcp-journey.e2e.mjs` · exit 2
  - error: live provider credentials and explicit spend authorization are not supplied by this gate
  - live provider: blocked — live provider credentials and explicit spend authorization are not supplied by this gate

Visual statuses are evidence states only; `pending-review` is not visual acceptance.

