# Limitations and separate blockers

> 2026-10-11 independent-review correction: schema2 `visible` means decoded content, `ready` means production eligibility, and Shift means a document-level key diagnostic. Their original `failed_budget` raw statuses are retained, but first-feedback100ms and target-interactive500ms conclusions are withdrawn. Schema3 separately measures existing spinner/title feedback and a real project-menu response; see `profiles/README.md` and [current batch](current-batch-verification.md).

Updated 2026-10-11. See immutable schema2 runs and `first-batch-verification.md` for the actual command, code hashes and result. Original schema1 launch reports remain historical evidence only.

## Implementation gaps

- Full P/D/B/C/A/R journeys are planned. Removed P1/P2/C1/C2/C3 branches were partial gestures, not their documented workflows. D/B/A/R never had production actions; selectors already exist for documents/designs.
- Atomic `project.open` has schema3 performance measurements; ten bounded next UI actions have functional receipts. Opening a project excludes app launch and does not establish P1, project switching, multi-document editing, storyboard batch, mixed-media interaction or recovery acceptance.
- Real native Agent sessions now use loopback SSE only as the external model endpoint. Creating another conversation aborts the previous native lane as explicitly required by laneWorkspace.switchTo; same-workspace stream/tool concurrency is blocked by that contract, not counted as execution/pass. Actual switch-abort cold recovery is functionally verified with unchanged transcript bytes and no new model request; it has no performance acceptance. Tool overlap remains blocked/unexecuted.
- CPU/memory are end snapshots. Main long-task instrumentation, action CPU distributions, resource trends/teardown acceptance, GPU/runtime build metadata and reliable p99 support remain incomplete. No performance-pass state is enabled for this batch.
- The fixture now has nonempty drafts, competing plans, mixed groups and result history, and exact total shots12/48/320. Media still reuses two repository-generated images and two short silent videos. Audio/director/whiteboard/panorama/model3d fixtures and real user diversity remain planned.
- 88 source entry families,1637 source bindings,24 expanded13-axis pairwise rows/695 eligible pairs and six high-risk combinations are an audit/plan. Reconcile fine-grained full-walk click controls and capability constraints before claiming all-entry coverage.

## Environment and resource boundaries

- Historical run stopped before a window because no display/Xvfb existed. Initial repair-batch trial additionally found missing Electron runtime and build outputs. These are separate from the unimplemented journeys.
- Electron43.4.1 official archive was fetched to temporary storage, checked against the installed package checksum, and installed in this checkout's ignored node_modules. Xvfb was extracted to `/tmp`; no system package/permission/product config was changed. The final small/cold and small/hot1+5 runs completed functional checks, but those schema2 budget conclusions are now withdrawn. Corrected schema3 cold first-feedback/actual-target budgets still fail, hot is inconclusive, and exit2 remains. This environment leg now has actual windows; no native hardware acceptance follows from it.
- macOS/Windows machines, real GPU, packaged release, private documents/media and real accounts remain unverified. The Mac line only accepts; it does not edit this branch.
- GitHub connector access now permits reading/updating PR1172. The earlier `gh` GraphQL authorization failure is historical, not the current measurement blocker.

The only production correction routes four eager Markdown consumers through the existing fully typed lazy boundary. Two loopback text requests exercise actual native sessions; no paid model, private upload, permission-policy change, merge or release. Cold budgets, full metrics/matrix and native display/Mac/Windows/GPU acceptance remain open.
