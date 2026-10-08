# Walk coverage routing direction check

## 1. Problem and invariant

The validation policy must select the same zero spend walkthrough lane for every spending source and registered walk. Workflow provisioning must use the repository's existing Playwright install command, and the routing file must have one deterministic path.

## 2. Current failure

The previous patch added a second Chromium installer, a filesystem fallback, and filename regular expressions. Those copies create drift and can classify a spending file without enabling the spending walk lane.

## 3. Existing solution assessment

The mature solution already present in this repository is the routing table (`docs/engineering/test-routing.json`) plus the existing Playwright install step. Reusing those contracts removes the duplicate installer and keeps the policy data owned by one file.

## 4. Options

| Option | Cost | Risk | Decision |
|---|---|---|---|
| Keep duplicate installer and fallback | More code and two sources of truth | CI drift returns | Reject |
| Keep copied filename regexes | Easy to add exceptions | Missed prefixes and false positives | Reject |
| Use routing JSON, direct Playwright install, and exact walk paths | Small migration and focused tests | CI Linux execution remains delegated to CI | **Recommended** |

## 5. Structural change

The policy reads `test-routing.json` only through `import.meta.url`, uses an exact `Set` for registered walks, emits `spendWalks`, and the workflow gates the spend job on that output. The broad source rule is tested with independent production paths.

## 6. User tradeoff

The tradeoff is strict, predictable CI coverage versus allowing a local fallback or a hand-written convenience path; the strict route is safer for payment boundaries.

## 7. Feature tests

`scripts/validation-policy.node-test.mjs` locks the spend output, exact walk membership, and representative prefixed production paths. `scripts/check-quality-gate-workflow.node-test.mjs` locks direct Playwright provisioning.
