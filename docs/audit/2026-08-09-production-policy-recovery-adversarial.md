# Production policy recovery adversarial review

Date: 2026-08-09
Scope: Production contract approval recovery for budget, provider, and model policy.

## Invariants

- Opening settings never records a contract rejection.
- Refreshing or completing settings never authorizes spend.
- Only the final explicit contract approval creates budget authorization.
- Every provider/model shown as required is derived from the jobs covered by the current gate.
- Main process and renderer use the same readiness evaluator.

## Six-role review

| Role | Attack | Result |
|---|---|---|
| CTO | Renderer preflight and service validation drift over time. | One pure readiness evaluator is shared by service, repository, and contract view. |
| Product | User fixes budget, then discovers provider and model failures one at a time. | The first contract view lists all missing prerequisites and replaces approval with one recovery action. |
| Design | Recovery opens a large settings page without saying what this Run needs. | Required provider/model rows move first, carry a contextual label, and the first missing field receives focus. |
| Frontend | Focus runs while the settings fieldset is disabled and silently disappears. | Focus waits for persisted policy loading before it can mark the request handled. |
| Backend/security | Recovery implicitly fills policy or authorizes the hard ceiling. | No setting is inferred; service rejects incomplete policy atomically; authorization remains zero until approval. |
| Adversarial user | A required catalog entry was removed or disabled after the plan was created. | Settings exposes the unavailable requirement and a direct route to the existing model catalog. |

## Evidence

- Pure policy readiness and aggregate-error tests.
- Production service test proves an incomplete approval leaves revision, gate, and budget unchanged.
- Electron journey covers all-missing → exact settings → ready contract → explicit approval.
- The same journey passes in `zh-CN` and `en`, with screenshots read at 1280×820.

## Residual constraints

- The existing policy schema allows model keys independently from provider keys. Contract approvals remain job-scoped and record the exact provider/model pair; changing that persisted schema is outside this recovery fix.
- An unknown cost remains visibly unknown. The user-supplied hard ceiling is an authorization boundary, not a fabricated estimate.
