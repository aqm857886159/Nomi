# Nomi Release Media Pack Skill Implementation Plan

> 🚧 进行中/待实施（状态标记由 `check:doc-status` 门岗要求；本行不改动原方案内容）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a built-in Nomi playbook that turns verified desktop-release evidence into a story-first, bilingual release media package with bounded TikHub research and an honest Nomi-to-local-post handoff.

**Architecture:** Add one new `skills/release-media-pack` Skill Pack v2. Its manifest reuses the existing playbook orchestrator and current document/canvas tools; its Markdown defines the release-evidence, TikHub, story, generation, post-production, localization, and status contracts. No new network, audio, filesystem, or publishing tool is introduced, so unavailable execution is explicitly handed off instead of simulated.

**Tech Stack:** Skill Pack v2 JSON + Markdown, existing Zod manifest loader, Vitest built-in-skill regression tests.

---

## File map

- Create `skills/release-media-pack/SKILL.md`: runtime-injected workflow, taste rules, hard gates, and honest capability boundary.
- Create `skills/release-media-pack/skill.json`: seven-stage playbook, current tool whitelist, provider requirements, permissions, inputs, examples, and stage references.
- Create `skills/release-media-pack/README.md`: operator-facing material-pack layout, TikHub/runtime preflight, local post-production handoff, and status meanings.
- Create `skills/release-media-pack/examples/release-evidence.template.md`: source-of-truth checklist for current and previous releases.
- Create `skills/release-media-pack/examples/material-pack-manifest.template.json`: reusable artifact/state manifest without fake output paths.
- Create `skills/release-media-pack/evals/evals.json`: three pressure scenarios and objective assertions derived from the baseline run.
- Modify `electron/skills/builtinSkills.test.ts`: require the new built-in, validate its stage order, tool containment, pause gates, and no nonexistent runtime tool claims.

### Task 1: Add a failing built-in contract test

**Files:**
- Modify: `electron/skills/builtinSkills.test.ts`

- [ ] **Step 1: Write the failing test**

Add a test that loads `skills/release-media-pack/skill.json`, expects the stage order `evidence → research → story → build → generate → assemble → handoff`, verifies the release pack has separate story and handoff pauses, and asserts every stage tool is present in the top-level whitelist.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `pnpm vitest run electron/skills/builtinSkills.test.ts`

Expected: FAIL because `skills/release-media-pack/skill.json` does not exist.

### Task 2: Add the minimal valid playbook manifest

**Files:**
- Create: `skills/release-media-pack/skill.json`

- [ ] **Step 1: Declare the current executable boundary**

Use only `read_full_text`, `read_selection`, `read_canvas_state`, `propose_storyboard_plan`, `create_canvas_nodes`, `connect_canvas_edges`, `set_node_prompt`, `run_generation_batch`, and `arrange_storyboard_to_timeline`. Do not declare TikHub, audio, filesystem, FFmpeg, HyperFrames, or upload tools that do not exist.

- [ ] **Step 2: Declare seven paused stages**

Set dependencies linearly from `evidence` through `handoff`; give generation only `image`/`video` model preferences; reuse existing writer/director skill references by directory handle.

- [ ] **Step 3: Run the focused test and verify remaining failures are about missing Markdown/content only**

Run: `pnpm vitest run electron/skills/builtinSkills.test.ts`

Expected: manifest schema and stage-contract assertions PASS.

### Task 3: Write the runtime Skill and operator contract

**Files:**
- Create: `skills/release-media-pack/SKILL.md`
- Create: `skills/release-media-pack/README.md`

- [ ] **Step 1: Write the runtime workflow in no more than 200 lines**

Include: release truth before claims; TikHub 20/10 bounded research and stop conditions; story before features; central title/motion/audio rules; separate ZH and EN outputs; Nomi MCP spend gate; current external handoff boundary; complete/conditional/partial/blocked definitions.

- [ ] **Step 2: Write the operator-facing material-package layout**

Document the version-scoped folder tree, official TikHub documentation URLs, runtime-only credential rule, GitHub Skill verification/safety boundary, local HyperFrames/FFmpeg QA, and actual-file-link handoff requirement.

- [ ] **Step 3: Scan for forbidden claims**

Run: `rg -n 'TBD|TODO|中英混排|自动上传|已完成音频|已接通 TikHub' skills/release-media-pack`

Expected: no placeholder or false-capability claim; references to mixed language appear only as prohibitions.

### Task 4: Add reusable templates and behavior evals

**Files:**
- Create: `skills/release-media-pack/examples/release-evidence.template.md`
- Create: `skills/release-media-pack/examples/material-pack-manifest.template.json`
- Create: `skills/release-media-pack/evals/evals.json`

- [ ] **Step 1: Add the release-evidence template**

Require current/previous exact tag or commit, installer identity/hash/platform/signing, merged change evidence, packaged-build reproduction, user-visible wording, limitations, and official links.

- [ ] **Step 2: Add the manifest template**

Use the package statuses `complete|conditional|partial|blocked` and artifact states `planned|draft|verified|published`; leave paths empty until real artifacts exist.

- [ ] **Step 3: Add the three baseline pressure scenarios**

Store the exact urgency, TikHub-secret/copying, and unavailable-MCP prompts with assertions for evidence, 20/10 bounds, no secret persistence, originality, separate locales, current tool boundary, technical QA, and honest status.

- [ ] **Step 4: Validate JSON syntax**

Run: `node -e "for (const f of ['skills/release-media-pack/skill.json','skills/release-media-pack/examples/material-pack-manifest.template.json','skills/release-media-pack/evals/evals.json']) JSON.parse(require('node:fs').readFileSync(f,'utf8'));"`

Expected: exit 0.

### Task 5: Run same-scenario GREEN evals and repository gates

**Files:**
- Review only: `skills/release-media-pack/**`

- [ ] **Step 1: Run three fresh agents with the new Skill**

Each agent reads one original `/tmp/nomi-release-media-pack-evals/eval-*.md` plus `skills/release-media-pack/SKILL.md` and writes a response. Grade against `evals/evals.json` without sharing the baseline response.

- [ ] **Step 2: Fix only observed failures and rerun affected evals**

Expected: all objective assertions pass; no extra provider/runtime claims are introduced.

- [ ] **Step 3: Run focused and full verification**

Run: `pnpm vitest run electron/skills/builtinSkills.test.ts electron/skills/skillManifestSchema.test.ts electron/skills/playbookOrchestrator.test.ts`

Then run: `pnpm run gates`

Expected: all configured checks pass with only repository-baseline skips/warnings.

### Task 6: Deliver by pull request

**Files:**
- Commit only the design, plan, Skill, templates, evals, and focused test.

- [ ] **Step 1: Re-fetch and guard the remote baseline**

Confirm the remote branch head has not diverged unexpectedly; integrate current `origin/main` non-destructively if required.

- [ ] **Step 2: Commit and push the task branch**

Commit message: `feat(skills): add release media pack playbook`

Push: `git push -u origin codex/release-media-pack-skill-20260827`

- [ ] **Step 3: Open a PR without merging it**

The PR description must state current executable Nomi stages, explicit TikHub/audio/local-post gaps, eval results, and gate results. Report branch, commit, PR URL, and blockers.

## Self-review

- Spec coverage: evidence, TikHub, story, Nomi generation, local handoff, double-locale assets, copy, QA, and status all map to a file/task above.
- Placeholder scan: no implementation step relies on TBD/TODO or an undefined runtime tool.
- Type consistency: stage IDs, status values, provider kinds, permissions, and tool names match the existing Skill Pack v2 schema.
