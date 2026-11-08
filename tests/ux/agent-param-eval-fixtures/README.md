# Parameter evaluation fixtures

The run shape comes from the real six-shot draft captured by this evaluation (P30); the event envelope follows `tests/ux/fixtures/task-center-agent-drafts/` and `task-center-states.walk.mjs`. The current repository reads this same event journal shape. Shot content and identities are fixed, parameters reset to five seconds and 16:9; no task is submitted.

Canvas node shape and project payload follow `tests/ux/fixtures/journey-project-fixture.mjs`. Seeding occurs only while the isolated project is closed, then the project is reopened and the fake brain reads the nodes through `look_at_canvas`.

These fixtures replace every model-authored draft prelude. Append tasks keep the original canvas-draft context; whether the product supports appending there remains a measured product result. A seeded draft does not invent a reversible write receipt for the undo task.
