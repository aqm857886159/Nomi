# Parameter evaluation fixtures

The run shape comes from the real six-shot draft captured by this evaluation (P30); the event envelope follows `tests/ux/fixtures/task-center-agent-drafts/` and `task-center-states.walk.mjs`. The current repository reads this same event journal shape. Shot content and identities are fixed, parameters reset to five seconds and 16:9; no task is submitted.

Canvas node shape and project payload follow `tests/ux/fixtures/journey-project-fixture.mjs`. Seeding occurs only while the isolated project is closed, then the project is reopened and the fake brain reads the nodes through `look_at_canvas`.

These fixtures replace every model-authored draft prelude. Append tasks keep the original canvas-draft context; whether the product supports appending there remains a measured product result. A seeded draft does not invent a reversible write receipt for the undo task.

## Scoring and comparison

A write is accepted only when it has a completed result with `isError=false`. Acceptance is not proof of the requested fields: declared readback requirements are checked against persisted drafts separately. Anchors do not count toward `plan.count`. The baseline can only score the original 31 test segments; fixture repair does not retroactively create the missing eight segments.

`catalogDependent` marks named-model availability; `defaultModelDependent` marks tasks whose setup or action relies on saved defaults. Summary JSON and text show both groups and the independent group separately, including accepted writes, passed turns and unscorable task ids.

Retry measure `tool-and-first-error-line/v1` uses the tool name plus the first error line (`askback-trajectory.mjs` wallKey). Production uses a finer error-code-and-field-path key. This evaluation deliberately retains the same coarse measure before and after a change; burst counts are not production circuit-breaker counts. Prelude and test segments are annotated separately.

The dry brain only reads the canvas and acknowledges the test stage. A dry pass proves fixture visibility and instrumentation, never model parameter quality or the task's product success. Spend cards are always declined; delete/undo cards follow explicit per-task approvals, with unspecified decisions recorded as declined.
