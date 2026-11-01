# Issue #237: provider onboarding and English first-run guide

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

Initial base: `26fbc87d3266460c9cd1cca2f4b9cf0f43db6f46`. Before delivery, merged updated upstream `e6d14729287d16c21883d1049463280648b47330`, then `e8c9c3b7fba7cce186360ac868ef08605eb6241e`, without rewriting history. Scope: request-size calculation, deterministic request coverage, and documentation. No installed-app configuration or live provider credentials are used.

## Design card (before implementation)

| Required field | Decision and evidence |
| --- | --- |
| ★1 User journey | Open Models → save a connection → select an exact model ID and kind → self-check → generate one image → attach a local reference → edit → use the accepted result in a shot. Primary signal: every supported GPT Image 2 ratio/tier produces a documented valid size, measured by the ratio/tier matrix in `paramTranslate.test.ts`. Guardrails: Auto remains omitted; multipart sends local bytes only to the selected endpoint, measured at `executeProfileOperation`. Live account/Windows verification remains unverified; no account was supplied. |
| ★1b Related surfaces | English README and model-connection tutorial; no UI, error-card, task-list, or localization changes. |
| ★2 Ownership | `catalog.parameter-wire-translation` → `applyParamMap` owns canonical-to-wire translation; its `ratioResToOpenAiSize` transform owns derived pixel dimensions and `templateContext` supplies the actual task kind. JSON and multipart are consumers. `taskTemplateParams` already owns omission of unset size. Catalog migrations and multipart dispatch remain unchanged. Door-map commands: `node scripts/door-map.mjs ratioResToOpenAiSize`, `applyParamMap`, and `templateContext`. |
| ★3 Reuse | Retain the serializable transform identifier and the shared JSON/multipart request pipeline. Use the existing GPT Image 2 profile to enumerate selectable ratios; do not add a provider-specific UI or protocol fallback. No dependency change. |
| ★4 States | Missing/Auto ratio: omit size. Concrete ratio: legal pixel dimensions. Saved connection: not proof of generation. Self-check failure: preserve configuration and inspect the reason. Upload failure: distinguish reference transport from authentication. Partial success: use only available modes. Loading/cancellation behavior is unchanged. Unknown relay contract: request a redacted public example before configuring it. |
| ★9 Acceptance and rollback | Before/after size matrix; final JSON and multipart assertions; Auto/missing/empty/whitespace size cases; local multipart reference with all other network calls rejected; existing v6 migration/idempotence tests. Run required repository gates and report actual failures. No claim that live anonymous hosts are repaired. Revert this task commit to undo the code, tests, and guide together. |

## Evidence and separate hypotheses

- [Issue #237](https://github.com/aqm857886159/Nomi/issues/237): screenshots show `Auto · 1K` / `Invalid size ""`, a failed request to the official OpenAI `/v1/chat/completions` endpoint, and a saved request-script configuration. The issue text separately reports anonymous-host upload failures. These do not prove a single cause, nor reveal the script's full request or saved catalog version.
- [Discussion #220](https://github.com/aqm857886159/Nomi/discussions/220): English onboarding was missing in August; an October comment already links `model-connection-en.md`. Update that guide rather than adding another.
- The supplied [storyboard/poster explainer](../guide/2026-08-23-storyboard-table-and-poster-factory-explainer.md) separates script → shot nodes → timeline from reference-video reconstruction and poster export. It is historical; this task does not promise every planned feature is shipped.

| Hypothesis | Current evidence | Disposition |
| --- | --- | --- |
| Empty `size` with Auto | `taskTemplateParams` uses `size || undefined`; exact templates omit undefined. Existing Auto request tests pass. | Already fixed on this base. Extend coverage through real dispatch; do not duplicate the fix. |
| Old catalog routes edits through chat | `catalogMigrateV7.test.ts` proves persisted v6 data is upgraded to a model-specific multipart edit mapping and remains stable on reread. | Existing migration retained. A hand-authored request script must be inspected separately; migration is not evidence that an arbitrary script is fixed. |
| Anonymous host failure | `runtime.ts` dispatches multipart before URL localization, and reference bytes can be read locally. URL-only routes still depend on their configured ingestion transport. | Lock direct multipart behavior with a network-denying fixture. Live host availability remains unverified. |
| Concrete size after switching away from Auto | `16:9 · 1K` becomes `1024x576` (589,824 pixels), below the documented 655,360 minimum. Existing tests assert that invalid value. Some 3:1 rounded dimensions also exceed the ratio ceiling. | Confirmed request-contract defect; repair the shared dimension transform and replace the incorrect expectation. Not asserted to be the exact historical cause of #237. |

## End-to-end path

1. Connection form and model selection: `src/ui/onboarding/OnboardingWizard.tsx`; labels in `src/i18n/locales/modelSetup.ts` and `onboardingProviders.ts`. Saving, self-checking, and generation are distinct actions.
2. Canvas node metadata and references: `buildCatalogTaskRequest` in `src/workbench/generationCanvas/runner/catalogTaskActions.ts`, with archetype parameters projected by `nodes/controls/archetypeMeta.ts`.
3. Persisted catalog: `readCatalog` in `electron/catalog/catalogStore.ts`; legacy edit repair in `relayImageEditMigration.ts`; `selectTaskMapping` selects the model/mode mapping.
4. Runtime: `executeProfileOperation` in `electron/runtime.ts`; JSON uses `buildProfileHttpRequest`, multipart uses `runMultipartProfileOperation`.
5. Both call `templateContext` → `taskTemplateParams` → `applyParamMap` → `ratioResToOpenAiSize` before rendering. The transform ID survives persistence; no schema migration is needed.
6. Multipart resolves local/data/remote references to bytes in `multipartOperation.ts`. JSON URL-only routes use `assetLocalization.ts` instead. Do not move multipart through anonymous upload.
7. Responses pass through `buildProfileTaskResult`; URL/base64 extraction is owned by `electron/tasks/assetUrlExtract.ts`. This task does not change decoding.

## Provider contract and follow-up

Checked 2026-10-27: [model](https://developers.openai.com/api/docs/models/gpt-image-2), [images/vision](https://developers.openai.com/api/docs/guides/images-vision), and [image generation, earlier GPT Image settings](https://developers.openai.com/api/docs/guides/image-generation#earlier-gpt-image-models). GPT Image 2 permits Auto or dimensions with edges divisible by 16, longest edge ≤3840, aspect ratio ≤3:1, and total pixels 655,360–8,294,400. The Images API generation and multipart edit examples are separate from image understanding through Chat Completions.

For any unresolved relay: provide the public API-example URL, exact base-URL host and path prefix, exact model ID, selected operation/mode, JSON or multipart field names/types, redacted status/response body, and Nomi build/OS. Say whether a local reference or public URL was used. Remove credentials, private contacts, private paths, and confidential images. A provider name alone is insufficient. No follow-up message is posted by this task.

## Shared transform domain

Declarative search also found `NEWAPI_VIDEO_PARAM_MAP` using the same persisted transform ID. Image constraints must use the actual task kind forwarded by `templateContext`; saved video mappings keep their existing dimensions. Two request-level video characterization tests failed before isolation. See [direction check](2026-10-27-image-size-direction-check.md).

## Code evidence and changed files

| File | Reason |
| --- | --- |
| `electron/catalog/paramTranslate.ts:43` | Complete the derived image-size domain after quantization; retain baseline video quantization. |
| `electron/catalog/profileHttpRequest.ts:26` | Forward the authoritative task kind through the existing shared mapping call. |
| `electron/catalog/paramTranslate.test.ts` | Replace the incorrect 1K assertion; cover all selectable ratios/tiers and invalid ratios. |
| `electron/catalog/providerOnboardingContract.test.ts` | Check actual JSON/multipart dispatch, Auto omission, direct local file bytes, and persisted video maps. |
| `docs/guide/model-connection-en.md` | Current setup controls, model/mode/reference steps, separate troubleshooting, and precise redacted follow-up. |
| `README.md` | Make the existing English tutorial link explicit. |
| `docs/engineering/concept-owners/catalog.parameter-wire-translation.json` | Register the existing shared translation owner and its contract boundaries; no new runtime path. |
| This report, the direction check, and the root-cause JSON | Evidence, compatibility decision, acceptance matrix, and machine-checked prevention contract. |

Existing behavior preserved: `taskParams.ts:203` omits unset size; `runtime.ts:212` dispatches multipart before URL localization at line 214; `catalogMigrateV7.test.ts:63` exercises the saved-v6 edit-route upgrade and repeated reads. A custom script is a separate execution path and is not rewritten.

## Deterministic verification

- Before numeric repair: 9 size-domain matrix failures.
- Before task-kind isolation: 2 video characterization failures while 14 image request checks passed.
- After repair and upstream merge: 7 focused test files, 145 tests passed. Includes migration/idempotence, JSON and multipart request construction, direct bytes, and legacy video dimensions.
- Changed-file ESLint: passed, zero warnings. Earlier whole-repository lint: zero errors, 91 existing warnings.
- No live model request, anonymous-host probe with private data, installed-app configuration write, or paid generation was performed.

## Repository verification receipt

This is a reviewable draft, not an all-green full-suite or live-provider claim.

| Check | Actual result |
| --- | --- |
| `pnpm run gates` contract phase | All 107 checks ran: 105 script passes, 2 blocking failures. The failures were missing concept-owner registration and three TypeScript errors in the new test matrix. Both were corrected and their checks rerun successfully; the entire 50-minute aggregate was not repeated. |
| Corrected `typecheck` | All five checks passed, including test types. The ratio matrix now narrows selectable option values to strings. |
| Concept owners and root-cause contracts | Passed again after the final upstream merge; both production files have contract coverage and changed regressions. |
| Filesize, tokens, i18n, lint | Passed. Filesize was repeated after the final merge; full lint reported zero errors and 91 existing warnings. Changed-file ESLint reported zero warnings. |
| `pnpm run test` | Did not pass: Vitest reported 2,104 passing files / 24,087 passing tests, 13 timeout failures in four files, and one worker error after a stalled Electron encryption fixture was terminated. The report also listed 2 expected failures and 22 skipped tests. The chained Node suites did not run in this invocation. |
| Isolated repeat of the four failing files | All four files / 21 tests passed with one worker and unchanged assertions/timeouts: project-action issuance, built-in catalog performance, audio import, and storyboard deletion/Undo. This does not erase the unsuccessful full run. |
| Final focused regressions and supplemental Node suites | On the final merged tree, all 7 focused files / 145 tests passed. `pnpm run test:node-suites` also passed separately, including worktree janitor, agent runtime, statistics, legacy MCP entry, and engineering-system tests. |
| `pnpm run build` and build-stamp verification | Passed for renderer and Electron on the final merged source tree. Existing bundle-size/Browserslist warnings remain. |
| Secrets and diff hygiene | Full tracked-file scan passed; final diff has only the scoped code, tests, guide, and required engineering records. No credentials or private issue attachments were added. |

The remaining full-suite blocker is the native test fixture: an Electron subprocess launched by `tests/ux/agent-runtime-fixture.mjs:188` with `tests/ux/_encryptFixtureKey.cjs` remained idle for more than eight minutes. Its parent worker was stopped to recover the test report, then the orphaned fixture process was cleaned up. No production behavior or test timeout was changed to mask it. The fixture is **unverified on this host**.

The design-lab screenshot check was advisory on this host (macOS x64 versus its recorded arm64 baseline) and initially could not launch its missing Chromium binary. Chromium was subsequently installed and the isolated storyboard browser tests passed, but a design-lab visual comparison and installed desktop UI acceptance remain **unverified**. No screenshot or mock result is presented as live provider acceptance.
