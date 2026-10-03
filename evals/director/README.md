# Director goal-alignment evaluation pack

This is the first domain pack for the generic [Module/Feature Evaluation Contract](../../docs/evals/module-feature-evaluation-contract.md). It measures the product goal that a varied prompt should become a whitebox scene with object motion, camera motion, and a complete playable preview whose content corresponds to the prompt.

## Contents

- `prompt-cases.v1.json` — 24 reviewable prompt targets. They cover indoor, outdoor, product, and person scenes; one-shot and three-shot compositions; push, pull, orbit, follow, and target-switch camera requests. `status: targets-only` means these are not measured results.
- `prompt-case.schema.json` — versioned case shape.
- `rubric.v1.json` — six weighted dimensions and initial P0 thresholds. Thresholds are targets until a real report records a run.
- `report.schema.json` — Director report shape, including separate automated and human evidence.
- `real-user-protocol.md` — the real app journey from prompt through whitebox inspection, play, timeline/camera path, local edit, replay, and export/hand-off.

## CLI contract

```bash
node scripts/eval-director.mjs validate
node scripts/eval-director.mjs report --input <observed-run.json> --output <report.json>
```

`validate` is zero-cost and deterministic. `report` normalizes an observed run and emits stable JSON plus Markdown; it does not launch Electron, call a model, or fabricate human judgments. Use the existing `evals/lib/isoApp.mjs` and `evals/lib/journeyRunner.mjs` when a future live run is ready.

## Focused smoke test

```bash
node --test scripts/eval-director.node-test.mjs
```

The smoke test validates the 24-case target matrix, catches missing required elements, verifies that the Director pack is wired to the generic contract/PR template, and proves deterministic report output. It does not claim that the Director product currently meets the targets.
