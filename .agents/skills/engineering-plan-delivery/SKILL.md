---
name: engineering-plan-delivery
description: Use when creating, reviewing, revising, or resuming a multi-step engineering plan, architecture rollout, migration, or long-running delivery effort. Also use when rounds, tickets, reviews, test reruns, main-branch updates, or phase scope are multiplying and delivery is slowing down. Produces the shortest safe critical path, one tracked source of truth, bounded macro batches, proportionate research/review/testing, remote recovery checkpoints, and explicit cost circuit breakers. Do not use for a genuinely bounded one-file change or a read-only answer that needs no delivery plan.
---

# Engineering Plan Delivery

Act as the delivery architect. Optimize for correct, recoverable delivery under
time, compute, context, and coordination constraints. Process is useful only
when it removes uncertainty or protects an invariant.

## Non-negotiable outcomes

A valid plan has all of these:

1. One tracked execution document is the active source of truth.
2. Current repository, Git, PR, and runtime facts are verified before planning.
3. User assets, security boundaries, irreversible effects, and single-owner
   invariants are explicit.
4. Internal dependency steps are separated from external delivery batches.
5. Each external batch closes a meaningful end-to-end outcome and leaves a
   remote recovery checkpoint.
6. Tests and reviews are scoped by changed evidence, not repeated by habit.
7. Scope, failure, review, and cost growth have circuit breakers.
8. Completion is proved against the contract, not inferred from activity or a
   green but unrelated test suite.

## Classify before adding process

Classify the work from repository evidence, not from how familiar it sounds.

- **Bounded**: an existing flow, one local behavior, low-risk and reversible.
  State the intent and focused verification in chat, then implement. Do not
  create a plan file, research report, task graph, or reviewer ceremony.
- **Complex delivery**: multiple owners or layers, migration/cutover, user
  assets, security/paid effects, architectural choices, several sessions, or
  an existing plan that is drifting. Use the full workflow below.
- **Spike**: the output is a feasibility answer. Time-box the probe and discard
  its code unless a separately approved delivery task adopts it.

Upgrade a bounded task when hidden complexity appears. Do not downgrade an
active complex delivery merely because implementation has started.

## 1. Establish a resume-safe baseline

Inspect before proposing:

- actual code and current architecture, then active plans and ADRs;
- branch, upstream, remote task branch, PR, commits, and dirty files;
- existing test evidence and its source/input/environment fingerprint;
- current owners, entry points, durable state, and side effects;
- prior relevant PRs, reviews, incidents, prototypes, and approved UI designs;
- dependencies, blockers, product promises, user assets, and paid/audited work.

Never discard or mix unexplained dirty work. Identify its owner and preserve it
outside the scoped commit.

For prior PRs, keep a coverage section in the active plan: query/scope, relevant
PR ids, base/head, checked date, the problem exposed, and an `adopt`, `adapt`, or
`reject` decision. Relevance is limited to the frozen contract's owners and
surfaces, explicit incidents, and PRs the user named. A stale PR may contain
current problem evidence even when its code no longer applies. Bind every
adopted point to a contract clause or acceptance criterion; never treat the
section as a mechanical cherry-pick list. After coverage freezes, inspect only
new PRs or changed heads/reviews. For UI, start from the approved design and
current rendered product, then use the design system only to close real gaps.
Missing evidence blocks the overlapping acceptance criterion, not an unrelated
whole lane.

Write or update one tracked plan. Mark older plans, round protocols, ignored
harness files, and local ledgers as historical rather than allowing multiple
active authorities. Put status and recovery information in the tracked plan,
not only in ignored runtime state.

PR coverage, evidence matrix, rulings, and handoff pointers are sections of the
active plan by default. Split out a support artifact only when its size,
immutability, or compliance value is independently useful; the plan references
it one way. A support artifact never owns scope, phase status, next action, or
recovery authority.

## 2. Freeze the delivery contract

Before decomposing work, make these decision-complete:

- user outcome and measurable completion claim;
- implementation base and the final integration policy;
- scope, explicit non-goals, and unchanged owners;
- invariants and forbidden states, especially duplicate writers or replay;
- assets and durable data that must survive;
- migration, archive-only cutover, rollback, and downgrade behavior;
- dependencies and the smallest sufficient interfaces between them;
- acceptance criteria mapped to the evidence that can prove each one;
- remote checkpoint and PR strategy.

After the contract freezes, change it only through an explicit reviewed delta.
Do not silently expand a phase or rewrite a safety invariant because the current
implementation makes the original contract inconvenient.

Ask the user only for product direction, irreversible trade-offs, credentials,
or facts available only to them. Resolve repository facts yourself. Record a
reasonable reversible ruling when the contract already determines the answer.

### Migration versus archive-only cutover

Require full Agent-session migration when conversation/context continuity is a
promised user asset or when a contract, audit, or compliance rule explicitly
requires that history. The existence of paid work alone does not require full
session migration; it always requires domain-level reconciliation. Otherwise
prefer a safe archive-only cutover:

- preserve documents, canvas state, media, generated results, and other work;
- preserve paid, submitted, or `submission_unknown` work in its domain owner and
  reconcile it; never retry or resubmit until definitely-not-submitted is proven;
- archive old conversations/context as read-only or exportable;
- invalidate pending approvals and never replay uncertain approved work;
- mark only legacy Agent work with no external side effect as interrupted and
  require explicit resubmission;
- back up old state, write one cutover marker, and allow only the new writer;
- state downgrade limitations after the new writer has produced data.

Do not build lossless session migration merely to avoid making this decision.
Do not use a simplified cutover to discard user work or create dual writes.

## 3. Research only what can change a decision

Use primary sources: current code, official documentation, source repositories,
and original PR/review evidence. Record `adopt`, `adapt`, or `reject`, including
why a popular pattern does not fit this repository.

Research is complete when every open architectural choice has enough evidence
to decide. Do not create a separate report when the decision table fits in the
active plan. Avoid re-reading a source whose checked revision still covers the
same question.

## 4. Design macro batches

Plan the shortest safe critical path. For one PR or delivery window, prefer two
to five macro batches; exceed that only when an independently rejectable risk or
release boundary requires it.

Each macro batch must state:

- the end-to-end outcome it closes;
- entry dependencies and frozen interfaces;
- internal implementation order;
- owners removed or made authoritative;
- affected acceptance criteria and evidence;
- focused review/verification scope;
- commit, push, and recovery checkpoint.

An acceptance criterion must be false, absent, or observably incomplete at the
fixed base and become true because of the batch. Existing behavior cannot count
as evidence that a new batch delivered something.

Contract, test, implementation, adapter, UI, deletion, and documentation may be
internal steps of one batch. They are not automatically separate tickets,
reviews, commits, or pushes. Fold setup and scaffolding into the first outcome
that needs them. A batch that only creates coordination artifacts is invalid
unless that artifact itself closes a real compliance or recovery requirement.

Use a separate batch only when a reviewer could correctly reject it while
approving the neighboring batch, or when it creates a remote-recoverable state
that is safe and useful on its own. Batch repeated mechanical edits together.
For a wide mechanical refactor that cannot stay green as one vertical change,
use `expand -> migrate in ownership-safe groups -> contract/delete`, while
keeping the old form temporary and making its deletion an explicit exit gate.

## 5. Audit once, then synthesize

Before implementation, send the frozen contract and proposed batches to one
independent reviewer. Review three axes separately so one cannot mask another:

- **Spec**: the frozen outcome, scope, and acceptance criteria;
- **Standards**: repository rules and structural quality;
- **Owner/Authority**: the unique owner of state, identity, approval, task
  lifecycle, Undo, ledger, and side effects.

Bound the review to:

- missing or contradictory contract clauses;
- unsafe ordering, irreversible loss, or unowned side effects;
- acceptance criteria without proof;
- batches that are too broad to recover or too small to deliver value;
- unnecessary process, duplicate truth, and predictable cost blow-ups.

The reviewer may block only current-contract P0/P1 issues. Existing unrelated
problems and P2 improvements go to a backlog and must not expand the delivery.
Use additional domain reviewers only when distinct expertise is required by a
real interface or user-visible risk, not to fill a fixed roster.

The primary agent adjudicates the review, updates the single plan, and performs
one final rubric pass. Re-review only changed risk clauses. If two review/fix
cycles do not converge, stop the loop and revise the contract or batch shape.

Read [references/plan-quality-rubric.md](references/plan-quality-rubric.md)
before finalizing a complex plan and whenever a circuit breaker trips.

## 6. Execute without multiplying ceremony

Within a macro batch, follow dependency order and keep the batch open until its
end-to-end criterion closes. Use subagents for independent read-only research,
bounded review, or truly disjoint code ownership. Do not create a fresh worker
and reviewer for every micro-step, and do not let workers spawn duplicate
reviewers.

Persist handoffs as short tracked artifacts or paths, not pasted session
history. Handoff pointers belong in the active plan unless they point to an
immutable support artifact. Keep the controller responsible for the contract,
cross-batch state, scope rulings, and final synthesis.

Allow only one production writer per ownership lane. Parallelize research,
read-only audits, and implementation whose files and durable owners do not
overlap. Shared checkout state, HEAD, stash, generated output, or runtime state
counts as overlap unless isolation is proven.

At macro-batch closure:

1. Run the affected evidence set once.
2. Perform one bounded read-only review of the batch diff.
3. Fix only current-contract P0/P1 findings.
4. Perform one scoped re-review of only the P0/P1 fix diff or invalidated clause;
   never reopen the broad review.
5. Re-run invalidated evidence, not the entire closure suite.
6. Update the tracked plan with evidence, residual risk, and next batch.
7. Commit the scoped code and plan together, then push the task branch. Report
   the resulting commit in the PR/final report or the next checkpoint; a commit
   does not need to contain its own hash.

## 7. Control verification cost

Maintain an evidence-matrix section in the active plan:

`criterion -> command/inspection -> code/input/environment fingerprint -> result`

Run a command only when it closes an open criterion, narrows an unclassified
failure, or its fingerprint changed. Use the escalation ladder:

1. smallest deterministic failing test or inspection;
2. directly affected files and contracts during implementation;
3. affected project/gates once at macro-batch closure;
4. full repository test/build/package and real journeys once at the final
   candidate, after pinning the integration baseline.

Fresh evidence is required for the claim it proves, but freshness does not mean
rerunning unrelated commands. Reviewers consume recorded evidence and do not
repeat the same tests on unchanged code.

If the same command and failure signature recur twice without a relevant
fingerprint change, a third identical run is prohibited. Classify the failure
as contract, lifecycle, implementation, environment, or test defect; change
the diagnosis or plan before running again. After a fix, rerun only evidence
invalidated by that fix.

## 8. Integrate and checkpoint deliberately

Refresh the remote baseline before creating the task branch and record that
implementation base plus the final integration policy. During an open delivery,
inspect and push the remote task branch at checkpoints, but do not continually
merge or rebase a moving default branch.

After the final focused batch is remotely recoverable, fetch once, pin one
default-branch SHA, integrate it once, and run the final evidence set against
that fixed candidate. Re-evaluate only when repository policy blocks the PR or
a relevant security/correctness change makes the pinned baseline unsafe.

Never force-push or push directly to a protected/default branch without exact
authorization. Do not merge, squash, close, or approve the PR unless asked.

## Cost and drift circuit breakers

Pause execution, quantify the problem, and revise the single plan when any of
these occurs:

- a phase keeps its name while gaining owners, interfaces, or exit criteria;
- coordination artifacts grow faster than delivered behavior;
- status exists only in local or ignored files;
- the same failure or review issue reaches its second unchanged cycle;
- a reviewer repeatedly expands beyond the frozen contract;
- a batch can no longer be explained as one end-to-end outcome;
- a new writer, compatibility path, migration layer, or source of truth appears;
- main-branch integration or full-suite execution is happening repeatedly;
- context handoffs repeat history instead of pointing to tracked facts.

Report the measured cost, collapse or reshape batches, update the plan version,
and continue from the newest remote checkpoint. Do not create another parallel
protocol to describe the correction.

## Completion

Re-run the rubric hard gates, then report criterion evidence, residual risk,
branch/commit/PR, and the remote recovery point. Include final pinned-baseline
gates and real user journeys when the contract requires them. A macro batch, a
passing partial test, or a large amount of activity is not completion.

Read [references/prior-art.md](references/prior-art.md) only when maintaining
this Skill or deliberately revisiting the workflow design, not during normal
delivery.
