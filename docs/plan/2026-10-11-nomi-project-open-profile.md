# Project-open bottleneck investigation plan

> **For agentic workers:** Use superpowers:executing-plans for this native implementation line. The coordinator's independent reviewer owns acceptance; it must not edit this checkout.

**Goal:** Locate the current small cold/hot project.open latency with production stage timing, renderer trace and renderer/main CPU profiles before choosing a production fix.

**Architecture:** Reuse the delivered fixture, launch/network guard and atomic action. Diagnostic-only instrumentation enables existing production User Timing before module load. Profiling is a separate leg and is never pooled with baseline latency or acceptance. Preserve every existing raw report and budget.

**Tech stack:** Electron43.4.1, Playwright, Chromium CDP tracing/Profiler, Node inspector, W3C User Timing.

**Spec:** Coordinator continuation on PR1172; original scenario-matrix-and-budget.md; current ed97b427c baseline and immutable schema2 receipt.

## Global constraints

- Same branch; no paid model, private upload, permission-policy change, merge or release.
- Fixed small contents and1280×933 Linux/Xvfb software-rendering environment. Native Mac/Windows/GPU performance remains unverified.
- Original ceilings stay100ms first visible feedback and500ms independent interactive-ready for small. Record content-decode separately; do not silently redefine the first-feedback ceiling.
- This batch first investigates project.open. Subsequent batches implement project switch/create, document/design, grouped media and real local Agent concurrency in that order, with their own executable contracts.

## Review focus

- Profiling overhead must not be interpreted as baseline latency or optimization benefit.
- Cold may include one-time fixture migration; stage evidence must identify it before any fixture or production change.
- Renderer and Node clocks are separate; compare stage durations, not their absolute timestamps.
- First feedback, content decode, production readiness and independent keyboard receipt must remain distinct.
- Agent lane/surface suspension and receipt recovery must retain ownership/order guarantees through any eventual optimization.

## Task0 — Correct metric semantics before profiling

The coordinator's independent review confirmed two P1 errors: schema2's visible mark is decoded image content, and its ready budget is applied to eligibility rather than a completed target-control input. Schema2 raw files stay immutable and keep their original statuses; analysis labels them historical diagnostics and withdraws their first-feedback/interactive budget conclusions.

**Files:** Existing workflow contract, probe, runner, summarizer and focused Node regression; existing measurement root-cause contract and evidence notes. No production edits.

- [x] Record schema3 first target-project feedback, decoded content, production canvas eligibility, trusted project-menu input and the resulting visible matching menu on one browser clock.
- [x] Keep content and target response independently ordered; finish the diagnostic window only after both. Apply100ms to feedback and500ms to actual target response. Content and eligibility have no invented ceiling.
- [x] Reject document-level key receipts, missing target responses, reloads and invalid marks. Regress delayed target response and content-after-response. Treat loading frames as diagnostics, since project.open has no active drag gesture; unsupported p99 stays unverified.
- [x] Preserve raw reports and source identities; explain historical semantics in analysis/PR. Run Node regressions, syntax and contract checks before profiling.

## Task1 — Diagnostic receipts

**Files:** Temporary diagnostic driver under/tmp, then preserve its source/hash and outputs under docs/evidence/2026-10-10-nomi-user-performance/profiles. Read-only production references: projectOpenTimeline.ts, projectPersistenceService.ts, NomiStudioApp.tsx, Electron projectOpenTimeline.ts. No production edits in this task.

**Consumes:** runCell(cell, options, dependencies), launchNomiApp(config), existing mark/measure prefixes nomi:open: and nomi:open:main:.

**Produces:** Exclusive per-sample renderer/main stage entries, traceEvents, renderer/main.cpuprofile, raw atomic marks and source identity; diagnostic:true and separate artifacts.

- [x] Run fresh small cold/hot stage-only diagnostic repetitions with existing production probes enabled before module evaluation; retain raw atomic marks and actual functional outcome.
- [x] Run one cold/hot CDP/inspector profile leg. Register trace-complete listeners before ending; stop collection after frozen browser marks and before teardown.
- [x] Analyze stage durations and sampled stacks, distinguish JS import/compile, migration/IPC, lane/receipt recovery, React/layout and image decode. Follow the dominant stack to source and enumerate its doors.
- [x] Publish the bottleneck evidence and exact diagnostic boundary to the coordinator before a production fix.

## Task2 — Evidence-driven implementation plan

- [x] After the dominant mechanism is identified, write the concrete correction plan/design card and schema-v3 root-cause contract covering the actual owner paths; choose a smallest regression and same-class test before changing production.
- [ ] Execute RED→GREEN, one minimal shared-boundary fix, unchanged-fixture1+5 cold/hot baseline without profiling, selected repository validation and independent acceptance.

Task2 code paths and regression signatures are intentionally not guessed here: it is a separate plan deliverable after Task1 investigation. No optimization is authorized by a profiling number alone.
