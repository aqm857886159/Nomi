# Conversational Model Integration Implementation Plan

状态：🚧 进行中

> **For Codex:** REQUIRED SUB-SKILL: execute this plan with `subagent-driven-development`; every task uses TDD, then a spec-compliance review, then a code-quality review.

**Goal:** Make Nomi’s existing manual onboarding and new conversation-driven MCP onboarding share one certification boundary so that only models/workflows proven through the real production path become usable, without requiring the external Agent to have the Nomi repository.

**Architecture:** `IntegrationSessionService` owns conversation/session state and GUI handoff only. A canonical certification facade delegates HTTP work to the migrated Provider Adapter primitives and ComfyUI work to the existing smart conversion/binding primitives, while sharing one idempotent operation ledger, restricted media verifier, staging journal, and verified-only promotion gate. Existing UI and MCP enter through the same facade; direct “save/import → enabled” writes are removed.

**Tech Stack:** Electron, TypeScript, React 18, Zustand, Vitest, Playwright, MCP JSON-RPC, Electron `safeStorage`, existing Nomi Catalog/Provider Adapter/ComfyUI runtime, Sharp/ffprobe already present in the workspace.

**Design source:** `docs/superpowers/specs/2026-08-28-conversational-model-integration-design.md`

---

## Execution rules

- Work only in `/Users/aoqimin/Desktop/Nomi-model-onboarding-20260828` on branch `codex/model-onboarding-20260828`.
- Do not touch the dirty shared checkout at `/Users/aoqimin/Desktop/Nomi`.
- Before every commit run `git branch --show-current` and inspect `git status --short`.
- Write the failing test first and run it to prove the red state before implementation.
- Keep direct provider details out of generic session/UI modules.
- Do not add a second Catalog writer, a second ComfyUI parser, or positional `widgets_values` mapping.
- API keys may appear only in the trusted renderer→main credential-save call and in-memory request execution. Tests must use sentinel secrets and assert they do not appear in session files, MCP results, errors, URLs, or logs.
- No task may claim completion from mocked unit tests alone; Tasks 8–9 contain mandatory process/package journeys.

## Task 1: Enforce secure credential and verified-only visibility invariants

**Files:**

- Modify: `electron/catalog/secrets.ts`
- Modify: `electron/catalog/catalogCommit.ts`
- Modify: `electron/providerAdapter/registration.ts`
- Modify: `electron/providerAdapter/serviceCatalog.ts`
- Modify: `electron/catalog/modelCatalogListing.ts`
- Modify: `src/config/modelCatalogCache.ts`
- Test: `electron/catalog/secrets.test.ts` (create if absent)
- Test: `electron/providerAdapter/registrationCatalog.test.ts`
- Test: `electron/providerAdapter/promotionEnables.test.ts`
- Test: `electron/catalog/modelCatalogListing.test.ts`
- Test: `src/ui/onboarding/modelSettingsCatalogProjection.test.ts`

**Steps:**

1. Add failing tests proving:
   - new/edited API credentials throw and write nothing when `safeStorage` is unavailable;
   - legacy `enc=plain` records remain readable for migration display but report `needs_resave` and cannot certify;
   - staged/unverified models and mappings are disabled and absent from `nomi_list_models` / normal pickers;
   - promotion enables only verified modes; a failed mode never becomes enabled; vendor/model enablement derives from verified executable modes.
2. Run only the listed tests and capture the expected failures.
3. Split the existing plaintext fallback into an explicitly legacy/import-only reader path and a fail-closed new-write path. Route all onboarding credential writes through the secure path.
4. Change Provider Adapter staging and ComfyUI-compatible Catalog projections so new/edited candidates are `enabled:false` until verified promotion.
5. Make model listing and renderer cache use certification metadata/mapping availability, not only `enabled + keyStatus`.
6. Re-run the tests; then run all `electron/providerAdapter/*.test.ts`, `electron/catalog/modelCatalogListing.test.ts`, and related onboarding projection tests.

**Commit:** `fix(onboarding): require secure credentials and verified visibility`

## Task 2: Add bounded media certification and HTML/XML masquerade rejection

**Files:**

- Create: `electron/providerAdapter/certificationMedia.ts`
- Create: `electron/providerAdapter/certificationMedia.test.ts`
- Modify: `electron/providerAdapter/verifier.ts`
- Modify: `electron/providerAdapter/verifier.test.ts`
- Modify: `electron/providerAdapter/verifierPrivateAsset.test.ts`
- Modify: `electron/export/mediaProbe.ts` only if the shared timeout/output-limit primitive belongs there
- Test fixture directory: `electron/providerAdapter/__fixtures__/certification-media/`

**Steps:**

1. Add failing tests for valid PNG/JPEG/WebP, valid short video/audio, HTML/XML returned with 200, wrong Content-Type, corrupt headers, oversize streams, decode timeout, cross-origin redirect, and same-origin explicitly granted private assets.
2. Prove current verifier accepts or misclassifies at least the HTML/XML and corrupt-header fixtures.
3. Implement one streaming verifier that:
   - enforces byte and time limits before materialization;
   - checks Content-Type and magic bytes before decoder entry;
   - invokes image/video/audio/3D readers with time/output/resource limits;
   - returns stable `reasonCode + params`, never raw response bodies;
   - copies successful artifacts into Nomi-managed temporary/certification storage and persists only digest/metadata.
4. Route Provider Adapter mode verification and ComfyUI certification through this module. Remove any duplicate “download means verified” checks.
5. Re-run targeted tests and `electron/providerAdapter/verifier*.test.ts`.

**Commit:** `fix(onboarding): verify media before provider promotion`

## Task 3: Make certification submissions idempotent and crash-recoverable

**Files:**

- Create: `electron/integrationCertification/types.ts`
- Create: `electron/integrationCertification/operationLedger.ts`
- Create: `electron/integrationCertification/operationLedger.test.ts`
- Create: `electron/integrationCertification/promotionJournal.ts`
- Create: `electron/integrationCertification/promotionJournal.test.ts`
- Modify: `electron/providerAdapter/types.ts`
- Modify: `electron/providerAdapter/store.ts`
- Modify: `electron/providerAdapter/service.ts`
- Modify: `electron/providerAdapter/service.test.ts`
- Modify: `electron/providerAdapter/serviceLifecycle.test.ts`

**Steps:**

1. Add failing tests for duplicate `start` with one idempotency key, concurrent start/cancel, provider submission response lost after remote acceptance, process interruption at every ledger checkpoint, same-vendor competing sessions, journal replay, and corrupt journal handling.
2. Define a versioned ledger with `contractDigest`, `idempotencyKey`, lease, attempt, checkpoint, `remoteTaskId`, submission state, artifact evidence, and child run reference. Never persist a credential, signed URL, or raw provider body.
3. Extend Provider Adapter start so the caller supplies an immutable contract/idempotency key; duplicate calls return the original run. Persist `submitting` before network create. An unknown submission may reconcile only; it must not auto-create again.
4. Implement prepared promotion journal + revision/CAS. Promotion and session finalization must be replayable and must preserve the previous complete active revision on failure.
5. Replace “restart means fail” for recoverable submitted work with ledger-guided reconciliation. Keep genuinely unsafe/unknown cases fail-closed with a user action.
6. Re-run targeted tests and the complete Provider Adapter suite.

**Commit:** `feat(onboarding): add idempotent certification ledger`

## Task 4: Build the canonical certification facade and migrate HTTP onboarding

**Files:**

- Create: `electron/integrationCertification/service.ts`
- Create: `electron/integrationCertification/service.test.ts`
- Create: `electron/integrationCertification/httpConnector.ts`
- Create: `electron/integrationCertification/httpConnector.test.ts`
- Modify: `electron/providerAdapter/service.ts`
- Modify: `electron/providerAdapter/existingConnection.ts`
- Modify: `electron/providerAdapter/ipc.ts`
- Modify: `electron/providerAdapter/existingConnectionIpc.ts`
- Modify: `src/desktop/onboardingBridgeTypes.ts`
- Modify: `electron/preload.ts`
- Modify: `src/ui/onboarding/OnboardingWizard.tsx`
- Modify: `src/ui/onboarding/AdapterTaskWorkspace.tsx`
- Modify tests under `electron/providerAdapter/` and `src/ui/onboarding/`

**Steps:**

1. Add failing journey tests proving manual UI registration and a programmatic session create the same canonical run shape; saving connection-only stays “configured/unverified”; model selection does not become usable before certification.
2. Implement the facade as the only start/get/cancel/promote owner. The HTTP connector reuses Provider Adapter discovery/compile/repair and official request-building primitives; it does not copy them.
3. Change manual onboarding register/select/adapt IPCs to call the facade. Connection save may securely persist a disabled connection, but model confirmation must create a canonical run.
4. Update UI states/copy so secure save is distinct from verified completion. Remove callbacks/paths that directly present an unverified connection as completed.
5. Verify BaseURL regression cases (`/v1`, `/api/v3`, no version, trailing slash) use the same request builder in discovery and production.
6. Run Provider Adapter, onboarding bridge, wizard contract, and Catalog listing suites.

**Commit:** `refactor(onboarding): route http setup through certification`

## Task 5: Migrate ComfyUI UI/API workflows to the same certification boundary

**Files:**

- Create: `electron/integrationCertification/comfyuiConnector.ts`
- Create: `electron/integrationCertification/comfyuiConnector.test.ts`
- Modify: `electron/catalog/comfyuiWorkflowImportStore.ts`
- Modify: `electron/catalog/comfyuiWorkflowImport.ts`
- Modify: `electron/comfyuiIpc.ts`
- Modify: `src/ui/onboarding/ComfyuiWorkflowImportPanel.tsx`
- Modify: `src/ui/onboarding/workflowPage/ComfyuiWorkflowSettingsPage.tsx`
- Modify: `src/ui/onboarding/workflowPage/runTestGeneration.ts`
- Test: `electron/catalog/comfyuiWorkflowImportStore.test.ts`
- Test: `electron/catalog/comfyuiWorkflowImport.test.ts`
- Test: `electron/comfyuiWorkflowMatrix.integration.test.ts`
- Test: `src/ui/onboarding/comfyuiWorkflowBinding.test.ts`

**Steps:**

1. Add failing tests for API workflow and ordinary UI Save workflow, two+ media slots, VHS widget-order changes, missing nodes, ambiguous outputs, and distinct fixture upload into each bound slot. Assert `frame_rate` remains numeric and image filenames enter only declared media inputs.
2. Implement a Comfy connector that reuses `analyzeComfyWorkflowTextSmart`, `reconcileComfyWorkflowText`, normalized `images[]` bindings, `/upload/image`, `/prompt`, `/history`, `/view`, and Task 2 media verification.
3. Return all ambiguity as one `unresolvedFields[]` batch. Persist only explicit `{nodeId,inputKey,paramKey,mediaKind}` bindings.
4. Change existing import/save/test UI to stage a draft and start the canonical run; remove direct enabled Catalog import. Keep the current page shell/graph/binding UI.
5. Use different built-in visible fixtures for each media slot and run the real upload path. Do not reuse the old no-media “test started” as certification evidence.
6. Run all ComfyUI workflow unit/integration tests and the multi-input regression fixtures.

**Commit:** `refactor(comfyui): certify workflows before enabling`

## Task 6: Add persistent integration sessions, secure GUI handoff, and MCP tools

**Files:**

- Create: `electron/modelIntegration/types.ts`
- Create: `electron/modelIntegration/store.ts`
- Create: `electron/modelIntegration/store.test.ts`
- Create: `electron/modelIntegration/service.ts`
- Create: `electron/modelIntegration/service.test.ts`
- Create: `electron/modelIntegration/handoffQueue.ts`
- Create: `electron/modelIntegration/handoffQueue.test.ts`
- Create: `electron/modelIntegration/ipc.ts`
- Create: `electron/capabilityCore/mcpModelIntegrationTools.ts`
- Create: `electron/capabilityCore/mcpModelIntegrationTools.test.ts`
- Modify: `electron/capabilityCore/dispatcher.ts`
- Modify: `electron/capabilityCore/mcpToolCatalog.ts`
- Modify: `electron/capabilityCore/mcpToolResults.ts`
- Modify: `electron/capabilityCore/rpcServer.ts`
- Modify: `electron/capabilityCore/mcpStdioServer.ts`
- Modify: `electron/capabilityCore/appIntegration.ts`
- Modify: `electron/main.ts`
- Modify: `electron/preload.ts`

**Steps:**

1. Add failing tests for schema validation, CAS revisions, owner/capability binding, `needs_input`, candidate paging/search, secret redaction, duplicate begin/start, app-closed handoff queue, renderer ack, and tools-only MCP journey.
2. Implement the session store described by the design. It references canonical child runs; it does not copy certification results.
3. Implement begin/open-credentials/discover/select/submit-workflow/resolve-input/start/get/cancel. Enforce `additionalProperties:false`, size limits, expected revision, idempotency, signed client ownership, and rate limits.
4. Implement a persisted handoff queue with `requestId/sessionId/revision/target`, renderer subscription, ack, GUI wake/focus, and non-destructive behavior when settings has dirty edits.
5. Add the MCP schemas in their own module to protect file-size limits. Add localized structured outcomes; never include credentials, raw errors, signed URLs, paths, or fingerprints.
6. Inject the service through both GUI RPC and headless stdio. Headless credential opening returns `needs_nomi`; GUI path opens/queues the target page.
7. Run MCP catalog, dispatcher, protocol, stdio, result, and model-integration suites.

**Commit:** `feat(mcp): add conversational model integration sessions`

## Task 7: Complete the trusted UI handoff and session presentation

**Files:**

- Modify: `src/workbench/settings/useSettingsDialogController.ts`
- Modify: `src/workbench/settings/SettingsDialog.tsx`
- Modify: `src/ui/onboarding/useModelPageRequest.ts`
- Modify: `src/ui/onboarding/modelSettingsNavigation.ts`
- Modify: `src/ui/onboarding/OnboardingDrawer.tsx`
- Create: `src/ui/onboarding/IntegrationSessionAlert.tsx`
- Create: `src/ui/onboarding/IntegrationSessionStatus.tsx`
- Modify: `src/i18n/locales/onboardingProviders.ts`
- Modify: `src/i18n/locales/en/onboardingProviders.ts` or the repository’s current English locale counterpart
- Test: `src/workbench/settings/settingsDialogStructure.test.ts`
- Test: `src/ui/onboarding/modelSettingsNavigation.test.ts`
- Create: `src/ui/onboarding/integrationSessionPresentation.test.ts`
- Add/modify walkthrough under `tests/ux/`

**Steps:**

1. Add failing tests for each discriminated target (`credential`, `connection`, `workflow`, `verification`), stale revision rejection, app-open/app-closed delivery, dirty form preservation, exact normalized origin display, safeStorage unavailable, partial model/mode counts, zh-CN/en, and accessibility live status.
2. Extend page request/navigation with the persisted request contract; do not create a new settings modal or AppBar button.
3. Reuse existing fields/components but show a trusted scope panel: origin, auth location, initiating client, create/reuse/replace scope, and “secure save and continue verification”.
4. Ensure save says only “securely saved, not yet verified”. Show canonical run progress and partial recovery. Include the source alert inside ComfyUI’s visible full-page surface.
5. Run focused component tests, then launch the real app and capture/read screenshots in zh-CN/en and light/dark for HTTP and ComfyUI handoffs.

**Commit:** `feat(onboarding): show secure integration handoff`

## Task 8: Package the Skill, client setup, README, and no-repository harness

**Files:**

- Create: `skills/model-integration/SKILL.md`
- Create: `skills/model-integration/skill.json`
- Modify: `electron/skills/skillStore.ts`
- Modify: `electron/capabilityCore/mcpConfig.ts`
- Modify: `electron/capabilityCore/security.ts`
- Modify: `README.md`
- Modify: `README.zh-CN.md`
- Create: `docs/guide/conversational-model-integration.md`
- Modify: `docs/guide/capability-core-cli-mcp.md`
- Create: `tests/ux/model-integration-no-repo.mjs`
- Create: `electron/capabilityCore/mcpModelIntegrationJourney.test.ts`

**Steps:**

1. Before writing the Skill, run baseline external-Agent scenarios from an empty temp directory without the Skill; record where the Agent asks for secrets, guesses endpoints, truncates models, or calls completed too early.
2. Write a thin Skill that teaches tool order, official-doc evidence, secret handoff, complete ambiguity batching, pagination, partial truthfulness, and explicit Comfy bindings. It must not contain provider code or BananaRouter-specific logic.
3. Add `model-integration` to the explicit external Skill allowlist. Ensure tools-only clients can still complete the journey.
4. Add signed generic MCP configuration generation suitable for WorkBuddy/other hosts without treating unsigned `external` as trusted. Keep existing Codex/Claude/Cursor config behavior compatible.
5. Document the one-sentence user start flow, supported boundaries, safe key entry, ComfyUI UI/API workflows, partial results, and recovery. Do not instruct users to clone Git or edit JSON.
6. Run the no-repository harness from a temp directory with source-path access denied. Run Skill pressure tests again and compare behavior.

**Commit:** `docs(onboarding): ship no-repo model integration skill`

## Task 9: Run real provider, ComfyUI, restart, regression, and delivery gates

**Files:**

- Create/update: `evals/model-integration/` journey fixtures and redacted result manifests
- Create: `tests/ux/model-integration-packaged.e2e.mjs`
- Update: `docs/plan/2026-08-28-conversational-model-integration-verification.md`

**Steps:**

1. Build the desktop app and run J0 from empty directories with Codex and Claude Code; run a standards-compatible generic WorkBuddy harness. If a real WorkBuddy host is unavailable, mark that exact host verification unverified rather than calling the harness proof.
2. Check only whether a BananaRouter credential is securely configured; never print/decrypt it. If available, use the official model list, choose account-available text/image/video, confirm test spend in Nomi, and run J1. If unavailable, keep deterministic mock coverage green and record the external credential blocker without fabricating a live pass.
3. Run a second blind-provider challenge against a real API origin and official documentation that do not occur anywhere in the repository, Skill, fixtures, or prior provider-specific code. Start from an empty directory with Nomi source access denied. The Agent must paginate the complete remote model list, present capability-grouped choices, and integrate as many account-available models as practical without adding provider/model special cases. Real certification must cover every available capability family and multiple models per family when the account exposes them; unsupported, unaffordable, rate-limited, or credential-blocked entries must be reported individually rather than silently skipped.
4. Probe the configured ComfyUI instance. Run J2 with one ordinary UI-saved workflow and one API workflow, including distinct fixtures in two or more media inputs and the VHS `frame_rate` regression.
5. Run security/fault J3: plaintext unavailable, origin rebind, DNS/redirect, HTML/XML media, oversize media, duplicate start, unknown submission, concurrent cancel, corrupt journal, and crash at prepared promotion.
6. Run fresh-process readback with a separate same-identity Electron main process and zero network create. Assert the original idempotency key produced exactly one create.
7. Run packaged stop→restart/upgrade E2E with test credentials: restore the same session without re-entering the key; call verified modes from BananaRouter and the blind provider plus one ComfyUI workflow through the normal production entry; materialize and decode outputs.
8. Preserve a redacted manifest of the discovered model count, pagination completeness, selected models, per-capability live results, failure reason codes, request counts, and spend. A single successful model, a saved configuration, or mocked traffic never counts as provider completion.
9. Run focused suites, then `pnpm run gates`. Run the required real-user walkthrough and inspect screenshots manually.
10. Use `requesting-code-review`; fix all P0/P1 and repeat review. Use `verification-before-completion`, then `finishing-a-development-branch`.
11. Push `codex/model-onboarding-20260828`, open a PR, and report branch, commit(s), PR URL, live-vs-mock evidence, spend, discovered/certified model counts, and any honestly unverified external-host evidence.

**Final commit:** `test(onboarding): prove conversational integration journeys`
