# Engineering Plan Quality Rubric

Use this rubric after drafting a complex plan, after an independent review, and
whenever the delivery process trips a cost or drift circuit breaker.

## Hard gates

A plan fails if any answer is no.

| Gate | Question |
| --- | --- |
| Current truth | Did the planner inspect current code, architecture, Git/PR state, dirty files, and existing evidence before relying on old plans? |
| Single authority | Is exactly one tracked execution document active, with older protocols explicitly historical? |
| Outcome | Is the user-visible or operational result measurable without referring to activity counts? |
| Invariants | Are single writers, irreversible effects, user assets, paid work, security boundaries, and forbidden replay states explicit? |
| Prior evidence | Were relevant PRs/reviews/incidents classified `adopt`, `adapt`, or `reject` and bound to acceptance criteria? |
| Batch value | Does every external batch close an end-to-end outcome and a safe remote checkpoint? |
| Proof | Does every acceptance criterion name the smallest sufficient evidence? |
| Bounded review | Can the reviewer block only current-contract P0/P1 findings? |
| Test budget | Are focused tests used during work and the full suite reserved for the pinned final candidate? |
| Failure breaker | Is a third unchanged run of the same failure signature prohibited? |
| Main strategy | Is the task branch checkpointed without continually chasing the default branch? |
| Cutover | If migration is involved, are preserved assets, invalidated work, replay, dual-write, backup, and downgrade behavior explicit? |
| Recovery | Could a new session resume from tracked state and the latest remote commit without reconstructing hidden history? |

## Scored dimensions

Score each dimension from 0 to 2. A complex plan should score at least 10/12
with no hard-gate failure before implementation.

| Dimension | 0 | 1 | 2 |
| --- | --- | --- | --- |
| Correctness | Requirements are vague or proof is indirect | Main path is covered but edge invariants are implicit | Contract, forbidden states, and criterion-to-evidence mapping are explicit |
| Delivery speed | Micro-steps each trigger ceremony | Some useful batching, some repeated gates | Shortest safe critical path with 2-5 meaningful macro batches |
| Compute cost | Full suites and duplicate review are routine | Some targeted checks but no reuse rule | Fingerprinted evidence, escalation ladder, and one final full run |
| Context cost | Handoffs paste history or recreate state | Tracked notes exist but authority is unclear | One tracked truth and path-based bounded handoffs |
| Recoverability | Progress is local or ignored | Commits exist but status/evidence is stale | Each macro batch updates tracked status and pushes a remote checkpoint |
| Scope stability | Phases silently expand | Scope is listed but lacks breakers | Frozen scope, explicit backlog, reviewer boundary, and drift breakers |

## Anti-pattern rejection table

| Pattern | Why it fails | Required correction |
| --- | --- | --- |
| One round per contract/test/file | Internal dependency is confused with delivery value | Fold steps into a macro batch with one exit criterion |
| Fresh implementer and reviewer per micro-task | Context, review, and test cost multiply | Batch same-owner work; review once per macro batch |
| Six fixed reviewers for every plan | Seats are filled without distinct risk ownership | Use one independent audit; add domain reviewers only for real risk |
| Full suite after each fix | Unchanged evidence is repeatedly recomputed | Run the invalidated direct evidence; full run at final candidate |
| Re-run the same failure | Activity substitutes for diagnosis | Fingerprint the failure; after two unchanged runs, reclassify or redesign |
| Keep rebasing onto moving main | Integration work displaces delivery indefinitely | Pin one final integration SHA after focused work is recoverable |
| Status only in ignored harness state | A session loss destroys the operational truth | Update the tracked plan and push each macro checkpoint |
| Phase name unchanged while scope grows | Progress reporting becomes misleading | Re-freeze scope, rename/reshape the phase, and update exits |
| Reviewer reports repo-wide debt | Current delivery expands without user value | Block only contract P0/P1; route P2/pre-existing debt to backlog |
| Lossless migration by default | Compatibility code persists without product need | Choose full migration only when continuity is an actual asset |
| Stale PR ignored or cherry-picked wholesale | Valuable problem evidence is lost or obsolete code is revived | Record `adopt`/`adapt`/`reject` per core point |
| Separate research/spec/plan/ticket/ledger truth | Documents drift and contradict | Keep one active delivery contract; create support artifacts only when they have independent value |

## Final self-review prompts

1. What ceremony can be deleted without weakening an invariant?
2. Which internal step has been mistaken for an external delivery batch?
3. Is the plan minimizing total turns and handoffs, not only one command's cost?
