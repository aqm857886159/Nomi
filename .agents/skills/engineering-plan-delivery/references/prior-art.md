# Prior Art And Decisions

Read this file only when maintaining `engineering-plan-delivery` or deliberately
revisiting its workflow design. Normal plan execution uses the rubric instead.

Checked against primary source on 2026-08-29.

| Source | Adopt | Adapt | Reject |
| --- | --- | --- | --- |
| Matt Pocock repository philosophy | Small, composable skills that preserve engineer control and can be adapted locally | Keep one orchestration skill because this repository needs resume-safe long-running delivery, but reuse its existing tracker and tooling | Installing a second tracker/setup framework or copying the whole skill suite |
| Matt Pocock `to-spec` | Explore current code and test through the highest existing seam | Keep the spec compact and bind it to the tracked plan | Extremely extensive user-story lists for an internal migration |
| Matt Pocock `to-tickets` | Vertical, demoable outcomes and explicit dependency edges | Treat tracer bullets as internal batch structure | One ticket per fresh context as the default delivery unit |
| Matt Pocock `implement` | Run single test files regularly and the full suite once at the end | Typecheck only affected projects during batches | Repeated full-suite execution during implementation |
| Matt Pocock `code-review` | Pin a diff base and separate standards from spec compliance | Add Owner/Authority as a third independent axis | Open-ended review without a frozen contract |
| Matt Pocock `grilling` | Find facts without asking the user | Ask only unresolved material decisions in bounded groups | Relentless rounds until every design-tree branch is visited |
| Matt Pocock `writing-for-agents` | Precise trigger pointers, checkable completion criteria, progressive disclosure, and deletion of no-ops or cheap environment caches | Keep conditional detail inline until a real branch or sequence earns a reference file | Splitting documents merely to reduce line count or coining extra process vocabulary |
| Matt Pocock `retro` | Diagnose navigation, checks, reviewer guidance, tool economy, no-ops, and information access at the environment layer | Run this diagnosis only after observed repeated cost or a circuit breaker | A mandatory retrospective after every batch or more implementation-context rules by default |
| Superpowers `brainstorming` | Scale process by spike/bounded/architectural class and use YAGNI | Use one contract approval for the whole complex delivery | Approval after every section or sub-project loop |
| Superpowers `writing-plans` | Split only where a reviewer can reject tasks independently | Keep 2-5 minute actions inside a batch checklist | Make each tiny action a commit/review unit |
| Superpowers `subagent-driven-development` | Batch same-shape work, use file handoffs, scoped re-review, one final fix wave | One reviewer per macro batch and one final branch review | Fresh worker plus review per task and five review/fix rounds |
| Superpowers `verification-before-completion` | Evidence before claims and requirement checklist before completion | Freshness is tied to the claim and fingerprint | Treat every transition as requiring a fresh full command |
| GitHub Spec Kit `specify -> plan -> tasks -> implement` | One directional chain from requirements to execution | Collapse research/model/contracts into the active plan unless independently valuable | Boilerplate artifact trees and horizontal setup phases by default |
| Anthropic `skill-creator` | Strong trigger description, operational core in `SKILL.md`, nuance in references, eval-driven revision | Use a small discriminating eval set for this process skill | Add scripts or framework before repeated behavior proves they are needed |

Primary revisions:

- Matt Pocock Skills `6654f6b60cd9d5be8b54c6fafe44346dabeb3b76` (2026-08-24): https://github.com/mattpocock/skills/tree/6654f6b60cd9d5be8b54c6fafe44346dabeb3b76
- Superpowers `b36e0829c6d0140e93cfef2ca599b1b07d4a7797` (2026-08-12): https://github.com/obra/superpowers/tree/b36e0829c6d0140e93cfef2ca599b1b07d4a7797/skills
- GitHub Spec Kit `51e52be6c3b26fed3ff5424c671f4a559519a759` (2026-08-28): https://github.com/github/spec-kit/tree/51e52be6c3b26fed3ff5424c671f4a559519a759/templates/commands
- Anthropic Skills `3b3fad96af16a10759d930941b4520ba0c40edae` (2026-08-21): https://github.com/anthropics/skills/blob/3b3fad96af16a10759d930941b4520ba0c40edae/skills/skill-creator/SKILL.md

## Maintenance Gate

When a real delivery failure suggests another instruction, first test whether
the proposed wording changes a decision on a paired realistic eval. If it does
not, delete it as a no-op. If it overlaps an existing rule, replace or tighten
that rule instead of appending another one. Add a new rule only for an observed
behavior gap that cannot be fixed more cheaply in navigation, information
access, automation, reviewer guidance, or tooling.

## Important adaptations for Nomi

- Historical MCP, Skill, Registry, and UI PRs are problem/design evidence even
  when their code is stale. Freeze a coverage index and scan only increments.
- Acceptance criteria must be observably false or incomplete at the fixed base.
- Each production ownership lane has one writer; parallelism is for disjoint
  owners, research, or read-only review.
- Plan review keeps Spec, Standards, and Owner/Authority findings separate.
- A wide mechanical refactor may use expand/migrate/contract, but deletion of
  the temporary old form remains an explicit exit gate.
