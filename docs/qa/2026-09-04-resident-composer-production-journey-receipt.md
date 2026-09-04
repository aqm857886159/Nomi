# Resident Composer production journey receipt

Date: 2026-09-04  
Base: `origin/main` at `68e88075` (#462 merged)  
Branch: `codex/agent-resident-composer-journey-20260904`

## Execution status

The journey was executed against the real development Electron app after a fresh `pnpm run build`.
It is a real user-input walk: the test fills the visible Resident Composer textarea, sends the intent, receives a tool plan from the loopback model boundary, observes the real pending approval card, clicks the real approval or rejection button, and reads the persisted project through the real project IPC. It does not inject Host items, reducer state, conversation results, or final project content.

Command:

```text
node tests/ux/resident-composer-production-journey.e2e.mjs
```

Evidence report:

`.tmp/pi-resident-composer-production-development-1788511580860/report.json`

(The leading space above is not part of the path.) The run launched Electron twice with different PIDs (`35467` then `35509`), used an isolated temp root, made zero paid calls, and had no unexpected model requests.

## Red evidence and blocker

The original strict receipt assertion was red because the approved document write persisted the appended content into `project.json` but did not create `.nomi/project-agent-proposal-receipt.json`. The revised harness keeps this assertion as a fail-closed blocker, records the evidence, continues to the real MCP stdio write and cold restart, and exits non-zero when the blocker remains. The final rerun reproduced the same result with `textRequests: 4`, `unexpected: []`, `paidCalls: 0`, and `result: "failed"`.

The same run also showed that the real `electron <repo>` MCP stdio server accepted `nomi_document_edit` and persisted `MCP_APPEND`, but did not create or advance the same Resident Host receipt/revision journal. This is consistent with the current production dispatcher route in `electron/capabilityCore/dispatcher.ts`, where `document.write` calls `writeProjectDocument` directly.

Blockers recorded by the harness:

1. `resident-host-document-receipt-missing`: Resident Host document approval mutates the project but does not persist the required durable proposal receipt/revision journal.
2. `mcp-stdio-bypasses-resident-receipt`: real MCP stdio `document.write` mutates the project without minting or advancing that shared Host receipt/revision journal.

These are product capability blockers, not test setup failures. The harness does not manufacture a receipt to make the journey green.

## Matrix

| Area | Evidence in this change | Result |
| --- | --- | --- |
| H | Visible intent → real Agent planning request → pending approval → approval → project persistence; receipt assertion remains strict | Blocked by missing durable document receipt |
| B | Empty Composer input remains disabled; Unicode intent and content pass through the real Agent/project path | Passed for exercised cases; overlong and duplicate cases remain open |
| E | A second real intent creates a real approval card; user clicks reject; rejected content is absent from the project | Passed for rejection/no-mutation case |
| T | Existing MCP production contract test covers Agent/MCP timeout as typed `capability_timeout`; no unsupported UI timeout pass is claimed here | Contract-covered, Resident UI continuation open |
| N | Real MCP stdio production write is exercised; the shared receipt convergence fails. Existing contract test separately covers network and provider failure sanitization | Blocked on receipt convergence; UI network/provider journey remains open |

The real cold restart still passed its narrower persistence/read-back assertion: after closing the first Electron process and launching a second process, the project was opened through the UI and both the Resident-approved append and MCP stdio append were read back from the document.

## Coverage receipt

```json
{
  "changedProductionScope": [],
  "v8": {
    "statements": "not-applicable",
    "branches": "not-applicable"
  },
  "reason": "This patch changes tests and QA documentation only; it changes no production source."
}
```

This is not a whole-repository 100% claim. A V8 100% statements/branches receipt becomes applicable only when production code is changed to close the blockers, and then it must be collected for that exact changed production scope.

## Remaining gap

The next implementation must make document writes from both Resident Host and MCP stdio use one approval/receipt/revision contract, then rerun this same harness and require a committed receipt with an advanced revision. Until that implementation exists, this journey remains intentionally red/blocked.
