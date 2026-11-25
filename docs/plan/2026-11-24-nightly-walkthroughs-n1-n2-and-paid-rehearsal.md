# #1121 Nightly walkthroughs and no-key rehearsals

## ★0 Prior art

- [Node.js `fs.mkdtempSync`](https://nodejs.org/api/fs.html#fsmkdtempsyncprefix-options) allocates a unique directory under a caller-provided prefix. Use it under `os.tmpdir()` for retained walkthrough evidence.
- [Ubuntu 24.04 release notes](https://documentation.ubuntu.com/release-notes/24.04/#unprivileged-user-namespace-restrictions) document the one-boot AppArmor setting for tools that create their own sandbox. Apply it in the ephemeral Linux walk job, alongside the sandbox runtime's `bubblewrap` and `socat` dependencies.
- [GitHub Actions runner variables](https://docs.github.com/en/actions/reference/workflows-and-actions/variables) describe `RUNNER_TEMP` as job-local scratch. Keep the batch list there and continue uploading the existing logs. Uploading the entire scratch tree would also collect profiles and project data.
- `scripts/nightly-walk-summary.mjs` already recognizes status 125 as a skip. Reuse it so the report can distinguish an unavailable prerequisite from a missing result.

## ★1 User outcome

Nightly maintainers need a useful result for each selected walkthrough. Start the batch without laptop-specific arguments, create isolated evidence, run available walkthroughs, record any missing media prerequisites, then report the original assertions. In the no-key batch, the storyboard edit should reach the text-model request and canvas single generation should reach the authorized image creation request. The loopback stand-in observes those requests without spending.

- Baseline and target: `45179348727` recorded five output startup failures, two dirty-tree verdicts, two missing media failures, a shortcut mismatch, a Linux sandbox startup failure and two pre-request rehearsal failures. Target all seven evidence writers past setup, both media-dependent walks reported as skipped only when their directory is unavailable, and both rehearsals at their declared endpoints. Measure selection and evidence paths with `scripts/nightly-walk-selection.node-test.mjs`, tree writes with the existing tree guard, and runtime outcomes with nightly logs and rehearsal receipts.
- Real scenarios are editor preview scope, importing the registered media through the canvas and MCP, and staging a storyboard edit and a single canvas generation. Direct import still requires the registered files. The no-key receipts cover request admission and cannot establish the provider's result.
- ★1b and ★1c. The tooltip check follows the existing platform label. The work uses isolated fixtures and has no persisted project or settings migration.

## ★2 Ownership

`delivery.nightly-walk-checkout` owns inventory and prerequisite selection. `door-map.mjs selectNightlyWalks --roots=scripts,tests/ux --include-tests` found the inventory wrapper and its tests. The workflow CLI and summary consume the same static batch membership. The runner records availability in each result, since the report job cannot inspect the walk runner's filesystem. `delivery.nightly-build-gate` owns tree-guard attribution. Walks own their evidence, with directory allocation shared by the seven affected scripts. `test-harness.paid-run` owns credential setup, request gating and rehearsal verdicts. The opened catalog supplies storyboard labels, and the existing isolated defaults fixture supplies the canvas model before renderer startup. The workflow owns the job-scoped Linux prerequisites and timeout.

## ★3 Consistency and prevention

Recurring across jobs and scripts. The first boundary that can avoid these failures is harness setup, before creating an app or sending a request. Run `45179348727` and the earlier tree-write case `40035294026` show that the backstop identifies a dirty writer after the fact. The output allocator prevents the reported repo defaults and startup failures before either write. Keep the walkthroughs and reuse the Node temp allocator, the summary's skip status and the existing no-key stand-in. A workflow-only list of path overrides would leave direct invocation broken. Removing the walks would lose coverage. Keep Ubuntu's packaged sandbox tools and the current runtime. Revisit the one-boot setting once an Ubuntu runner can launch the namespace sandbox with its default AppArmor policy.

## ★4 States

Omitted output creates a fresh directory. Explicit output selects the requested directory and existing checkout guards reject invalid paths. An unset or missing media directory produces a named skip, while missing files within an existing directory still fail in the walk. Failed assertions and incomplete batches retain their own verdicts. The sandbox setup runs before the walks. No-key rehearsals use the standard finish and receipt path.

## ★9 Acceptance and rollback

- New selection assertions must fail against the original CLI. Check both named media walks with an unset variable, a missing directory, a file, and an existing directory. Use an ordinary selected walk as the control so skipping everything fails. Check that skip rows preserve the full batch membership expected by the report.
- Check output allocation for fresh independent directories, explicit precedence, and rejection under a guarded checkout. The original tracked screenshot defaults and the old `node-toolbar-one-row` failure in `40035294026` are the dirty-write examples. Explicit external evidence is the passing control.
- Check that the walkthrough's shortcut matches the platform, the job installs both Linux tools before the first walk, the storyboard resolves labels after `newProject`, and canvas retains its authorized-model assertion with the default seeded before launch. A storyboard rehearsal ends at the brain request and canvas ends at the first image create request. Keep the existing no-key network gate.
- Verify with the requested nightly Node tests and targeted gates. Full Ubuntu and Electron replay requires a separate nightly run. Recheck at the first nightly run after integration. Revert this commit as one batch if selection, isolation or rehearsal routing regresses.
