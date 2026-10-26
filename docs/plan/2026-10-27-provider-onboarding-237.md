# Issue #237: provider onboarding and English first-run guide

Base: `26fbc87d3266460c9cd1cca2f4b9cf0f43db6f46`. Scope: request-size calculation, deterministic request coverage, and documentation. No installed-app data or live provider credentials are used.

## Design card (before implementation)

| Required field | Decision and evidence |
| --- | --- |
| ★1 User journey | Open Models → save a connection → select an exact model ID and kind → self-check → generate one image → attach a local reference → edit → use the accepted result in a shot. Primary signal: every supported GPT Image 2 ratio/tier produces a documented valid size, measured by the ratio/tier matrix in `paramTranslate.test.ts`. Guardrails: Auto remains omitted; multipart sends local bytes only to the selected endpoint, measured at `executeProfileOperation`. Live account/Windows verification remains unverified; no account was supplied. |
| ★1b Related surfaces | English README and model-connection tutorial; no UI, error-card, task-list, or localization changes. |
| ★2 Ownership | `ratioResToOpenAiSize` owns derived pixel dimensions. `taskTemplateParams` already owns omission of unset size. Catalog migrations and multipart dispatch remain unchanged. Door-map commands: `node scripts/door-map.mjs ratioResToOpenAiSize`, `applyParamMap`, and `templateContext`. |
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
