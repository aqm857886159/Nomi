---
name: root-cause-remediation
description: "Mandatory for every Nomi corrective change: user-reported bugs, regressions, CI-only failures, flaky tests, performance or security defects, review/audit findings, and compatibility failures in any production path. Classify one_off versus recurring before implementation. Recurring and high-risk repairs require a schema-v3 contract, shared enforcement boundary, structural prevention, dependency lifecycle decision, and changed regression evidence."
---

# Root Cause Remediation

## Mission

Act as an investigator and system owner, not a patch author: restore the missing invariant at the earliest shared boundary. Judge every step by the four principles below.

This skill is the detailed operating source for P2/R21. `CLAUDE.md` and generated `AGENTS.md` only carry the trigger; `scripts/root-cause-contracts.mjs` is the merge-time enforcement authority.

## 判断用的四条

**1 身份和主人跟着东西走。** 后面还会用到的东西（数据、请求、任务、引用、决定），从产生起带着不变的身份和负责它的主人；之后按身份找、向主人要结论，不在别处重新推断出另一份结论。外面来的东西在入口解析一次、发身份是正当的；同一件事可以有几种表示（意图、编码后的参数、显示），但只有主人决定它是什么。
问（看改动时问）：这段代码是不是在入口之后，靠解析、按类型或名字分支、列清单、自己再算一遍，去找回本该带着的信息？

**2 状态照实说。** 成功、失败、还没结束、不知道，在主人那里分开记；显示可以少分几种，但不能把不知道说成失败或成功。到点只说明「不等了」，事情仍归主人跟到底；开始了的东西要有主人负责结束。从外面得知的事（文档、别人的决定和它的前提）也记着何时、从哪得知，没核过或过期的，都当「不知道」。
问（设计卡写主人那一格时答）：到点以后事情归谁跟、谁负责结束？「不知道」和没核过、过期的知道，有没有被当成失败、没发生或还对？

**3 做完由目的定，判据要能失败。** 动手前写清依赖结果的一方要做成什么、做成时看见什么（含要多快、占多少）。判据：一个没做成的实现——什么都不做、全部拦下、删掉功能、拿旧结果冒充新结果——通不过它；它从目的推出，不从这一次的坏事或实现推出；由不改代码的人在改之前写好，换入口、输入形状、顺序、旧数据还测得到。
问（任务书和验收时答）：目标那句是谁、在改之前写的？什么都不做、全部拦下时，目标测试红不红？

**4 挡是转嫁代价，要记账。** 锁、拒绝、跳过、上限、确认、置灰，把「结果错」换成「没结果」或「多一步」，代价落在依赖结果的一方。只有「不做」本身是目的的一部分时才算对：不可逆的损失、花错钱、安全边界；这时对方要知道为什么，还要有路做成原本的事。帮着把结果做成、不让对方多付代价的重试不是挡。其他的挡，先指出它在弥补第 1–3 条的哪一条，修那一条。
问（看改动时问）：代价落在谁身上？「不做」是不是目的的一部分？不是的话在弥补哪一条？

绑定行：「依赖结果的一方」在 Nomi 里是做片子的人、替他干活的 Agent、接我们的外部 Agent 和系统。

## Required Workflow

1. Reproduce the symptom with the smallest deterministic fixture. Preserve the failing output before editing production code.
2. Trace the complete path from user input through parsing, state/persistence, shared services, and the final request/write/decode boundary.
3. Separate `symptom`, `direct_cause`, and `class_root`. The class root is the missing invariant that explains why equivalent inputs or callers can fail, not the line that happened to throw.
4. Classify recurrence before implementation: `one_off` requires repository-wide evidence that no other user, input, entry, machine, or future run can reach the mechanism and no reusable invariant can prevent it; observed once is not evidence. Otherwise classify `recurring`.
4a. Before first proposing a solution, and again when changing it, check this object’s past decisions and deletion records (`docs/design/`, `docs/engineering/concept-owners/`, `git log --grep`, and known facts supplied by the coordinator); verify the original wording and whether it still serves long-term product value and smooth UX. When an old decision or boundary forces repeated patches or degrades user experience, overturn and replace it directly in repository sources of truth (`concept-owners/*.json` with optional `supersedes`, `framework-boundaries.json`, `boards/*.board.json`) in the same commit while deleting the old implementation — never leave a dual-track fallback or record decisions in out-of-repo ledgers. With the goal written (principle 3), compare fixing in the current direction, taking a different approach (changing modes or adopting an existing solution), and deleting it. Choose from the facts; write `unknown` where evidence is missing. For a small matter with an already clear fix, one sentence is enough.
5. Count the doors before choosing where to fix. Run `node scripts/door-map.mjs <mutator symbol or file>` to enumerate every write and read entry point of the state whose invariant broke, and paste the output into the contract's `doors`. A door map you typed by hand is the same thing as the sentence "I checked"; the script is the check. The tool counts direct call sites only, so follow one more hop when a door is reached through a wrapper. **If the fix changes what a shared read face returns** (filtering, hiding, reshaping), enumerate every reader of it — including `tests/ux` walkthroughs and scripts that call it through `window.nomiDesktop` — and check each reader's expectation before shipping; 改了读面返回什么，就把它的全部读者（含走查）逐个核一遍 (2026-10-22: hiding blank drafts in the project list broke golden path and real-user-journeys, which find a just-created project through `listAsync`).
6. Search the repository by data shape, contract, producer, and consumer. Record at least two independently checked same-class entry points; do not search only for the reported provider, version, model, or fixture name. 这一步是修缺陷用的；任务是删掉某个东西时，范围按归属定（它属于谁的目录、声明、夹具、测试），全仓搜索只用来最后核对剩下什么，不用来决定删什么。
7. Identify the earliest shared boundary that can make the failure **impossible by construction** (Poka-Yoke) rather than catching it after the fact:
   - First try **source elimination** (`prevention.poka_yoke_tier = "impossible-by-construction"`): (a) `route-deletion` — physically delete the divergent write/render path (backed by `legacy_paths.status = "removed"` or `door_reduction.after < before`); (b) `type-or-schema` — make the illegal state unrepresentable in TypeScript types or boundary schemas; (c) `shared-core` — make UI, Agent, and external callers share one parser/projection/host component so they cannot drift.
   - Only fall back to **post-hoc scanning / runtime assertion** (`prevention.poka_yoke_tier = "post-hoc-gate"`) when source elimination is impossible across languages/processes/external bytes, and state the concrete reason in `prevention.why_not_impossible_by_construction` (>=16 chars). Prose-only rules (`CLAUDE.md`, `rules.json`, `SKILL.md`) are never valid `enforcement_path` or sole structural artifacts and fail CI.
8. For third-party behavior, inspect current official documentation, source, installed versions, and platform/package drift. Choose `upgrade-now`, `retain-with-exit`, or `not-applicable`; retention requires a target and testable exit criteria.
9. Read `references/contract-v3.template.json`, then create or update a schema-v3 `docs/fixes/*.root-cause.json` before a recurring or high-risk production fix. Preserve the template's exact field names, object shapes, and enums; every changed high-risk production file must be covered by `scope_paths`. 如果是旧合同的复发，跑 `node scripts/eng-metrics.mjs --candidates <合同路径>` 核对候选后填 `recurrence_of`。
10. Write the goal test (principle 3) and show it red on the do-nothing and block-all versions; the reported case is one of its inputs. Run only this red slice before implementation.
   门岗反例夹具只截取本次相关片段；不要把整份旧规则 / 旧文件复制进夹具。先证明夹具会红，按字节还原后再证明回绿。
11. For recurring repairs, enforce the invariant at the shared boundary and list changed structural code in `prevention.artifacts`. Delete obsolete behavior in the same change; tests, documentation, and fallback paths are not structural prevention.
12. Run the changed class tests and `pnpm run check:root-cause-contracts`. After the logical batch is stable, run the risk-selected repository validation once.

## Decision Rules

- A platform or dependency version may explain the symptom, but it is not automatically the class root. Bind the application-level contract explicitly, then decide whether the dependency also needs an upgrade.
- Upgrade now when a supported target-aware package can replace the old runtime without weakening packaging, security, or cross-architecture guarantees.
- Retain with exit only when an application invariant safely spans current versions and the upgrade has concrete prerequisites, owner paths, and verification criteria.

## Forbidden Patch Shapes

- Broadening a regex or weakening validation without proving the underlying invariant.
- Calling a dependency old but neither upgrading it nor recording a target-aware exit plan.
- Listing vague entry points, nonexistent paths, unchanged tests, or prose that cannot be tied back to code.

## Contract v3 Review

Before implementation, confirm the contract contains:

- `generality_proof` explaining why the solution spans the class;
- `shared_boundaries` with real path, symbol, and responsibility;
- `doors`: every write and read entry point of the affected state, generated by `scripts/door-map.mjs`, each `{kind, path, symbol}` — the door's identity is file + symbol, never a line number (line numbers drift on unrelated edits and produced a whole family of no-op "keep the line numbers current" commits);
- `door_reduction`: `{before, after}` where `after` equals `doors.length`; when two or more doors survive unchanged, `why_not` must say why each entry has to exist;
- `same_class_entry_points` with path, entry, disposition, and evidence;
- `recurrence` with `one_off`/`recurring`, reason, and concrete repository scan evidence;
- recurring `prevention` with a supported mechanism, `poka_yoke_tier` (`impossible-by-construction` + `source_mechanism: route-deletion|type-or-schema|shared-core`, or `post-hoc-gate` + substantive `why_not_impossible_by_construction`), non-prose shared `enforcement_path`, invariant, fail behavior, no exception policy, strategy, and changed structural code/gate artifacts;
- `class_regression_tests` that are also changed `regression_tests`;
- `legacy_paths` as `removed` or justified `not-applicable`;
- `dependency_lifecycle` as `not-applicable`, `upgrade-now`, or `retain-with-exit`.

The exact machine contract is `references/contract-v3.template.json`. In particular, use `same_class_entry_points[].entry_point`, disposition `enforced` or `not-affected`, the exact `recurrence` and `prevention` keys, and an object-shaped `legacy_paths`; do not paraphrase schema keys in a contract outline. `prevention.kind` is one of `centralized-boundary`, `schema-validation`, `type-system`, `runtime-assertion`, `static-gate`, `migration`, or `dependency-upgrade`. Each external source is `{kind: official-doc|source-code, url, checked_at: YYYY-MM-DD, purpose}`; otherwise use a truthful `internal_only_reason`. Run the checker immediately after drafting so field-shape errors are resolved before production work.

Schema v1 and v2 contracts are immutable history. Any modification must migrate that contract to v3; new legacy contracts fail CI.

## Final Review

Do not call the issue solved until every answer has code or test evidence:

1. Is no compatibility exception or fallback left, and does every block the fix adds pass principle 4?
2. Did the reported case fail before the fix and pass after it? For a user-reported problem this means replaying the user's own flow under the same real conditions (what counts as real depends on the problem, for example a real model for generation, real old-version data for an upgrade): complete, with every difference from the user's run named, the same symptom seen before the fix and the same steps passing after it. Derive what to cover from the user's flow and the door map, not from a fixed list (`docs/engineering-rules.md` R13). Record it in the PR's `## 真实场景复现`; a fake-provider walk alone does not count, and missing resources are written as `未验证：原因`.
3. Are dependency and migration decisions explicit, bounded, and testable?

Unknowns belong in `residual_risks`; they are not permission to claim completion.

## Reference

- `references/contract-v3.template.json` - exact schema-v3 authoring template; always read it before drafting a contract.
