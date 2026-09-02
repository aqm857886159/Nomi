# Provider and Flagship Model Expansion Certification Implementation Plan

> ✅ 代码、零费用流程、代表性 live canary 与发布验证已完成；仍有明确外部阻塞项（KIE Suno ACK Worker 部署、部分供应商账户/权限），已在账本中保持 `blocked` 或 `simulated`。

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete and certify Nomi's curated flagship provider/model integrations through one evidence-backed production path, while keeping unsupported or externally blocked mappings fail-closed and clearly labelled.

**Architecture:** Keep the existing model → provider → parameters flow and extend only the shared catalog/runtime contracts. `modelArchetypes` owns capability facts, Catalog `Mapping`/`HttpOperation` owns provider transport, `GenerationRuntime`/`ProductionRun` owns execution and persistence, and the certification ledger records evidence rather than duplicating contracts. Runway uses its official upload lifecycle; KIE Suno uses a generic mode discriminator plus callback ACK/polling; fal uses one shared create → status → result lifecycle.

**Tech Stack:** Electron, React 18, TypeScript, Vitest, Node test runner, pnpm, Playwright smoke, provider Catalog contracts, PR #221 MCP, managed assets, Cloudflare Worker ACK endpoint for KIE callbacks.

**Spec:** `docs/plan/2026-08-30-unified-model-integration-certification.md`

## Global Constraints

- Preserve the existing model → provider → parameters UI; add provider/model logos only at existing selectors.
- Do not create parallel model schemas, runtime executors, uploaders, or provider-specific UI systems.
- Every changed `provider × model × mode` must pass official contract → static gate → loopback → failure matrix → MCP zero-cost journey → minimal live canary.
- Live canaries must use Nomi's production executor, result validation, managed assets, journal commit, and fresh-process readback.
- Never guess a provider field, model ID, limit, status, response path, or fallback; record `blocked` when official evidence or an external prerequisite is missing.
- Exhaust zero-cost evidence before any paid request; use one minimal, idempotent canary per distinct wire/lifecycle/result shape.
- Never write credentials into source, fixtures, logs, ledger entries, screenshots, or artifacts.
- Keep `documented`, `simulated`, `live-certified`, and `blocked` distinct; only `live-certified` is a real-provider certification claim.
- Do not run the model radar in this task.
- 不直接 push 受保护的默认分支；所有代码通过 PR #241 进入 main。用户已授权在检查全绿后由本任务合并 PR；Cloudflare Worker 生产部署仍需单独批准。

---

### Task 1: Freeze the task branch and reconcile the existing worktree

**Files:**
- Read: `AGENTS.md`
- Read: `docs/ARCHITECTURE-NOW.md`
- Read: `docs/plan/2026-08-30-unified-model-integration-certification.md`
- Read: `docs/handoff/2026-08-30-provider-model-expansion-unified-certification-handoff.md`
- Read: `/private/tmp/nomi-pr221-main-merge.3Ci24q/docs/handoff/2026-08-30-local-model-agent-runtime-architecture-handoff.md`
- Inspect: all current worktree changes on `codex/provider-model-expansion-20260830`

**Interfaces:**
- Consumes: the existing branch, uncommitted provider fixes, current ledger, and the latest fetched `origin/main`.
- Produces: a protected working baseline and a file-level scope list; no reset, checkout, cleanup, or overwrite.

- [x] **Step 1: Confirm branch, worktree, and remote baseline.**

  Run:

  ```bash
  git branch --show-current
  git worktree list --porcelain
  git status --short
  git fetch origin main
  git log --oneline --decorate -5
  ```

  Expected: branch is `codex/provider-model-expansion-20260830`; existing uncommitted changes remain intact; `origin/main` is available for a later non-destructive review.

- [x] **Step 2: Read all five required architecture and handoff documents before touching provider code.**

- [x] **Step 3: Record the current inventory from `docs/integration-certification/model-certification-ledger.json`.**

  Expected current inventory: 62 mappings across KIE, APIMart, fal, Runway, MiniMax, ElevenLabs, and Meshy.

### Task 2: Close the deterministic provider-contract fixes

**Files:**
- Modify: `electron/catalog/paramTranslate.ts`
- Test: `electron/catalog/paramTranslate.test.ts`
- Modify: `electron/catalog/kieGeminiOmni11.ts`
- Test: `electron/catalog/kieGeminiOmni11.test.ts`
- Modify: `electron/catalog/elevenlabs.ts`
- Test: `electron/catalog/elevenlabs.test.ts`
- Modify: `electron/catalog/minimaxOfficial.ts`
- Test: `electron/catalog/minimaxOfficial.test.ts`
- Modify: `electron/catalog/builtinVendorSeeds.ts`
- Modify: `electron/catalog/seedBuiltins.ts`
- Test: `electron/catalog/seedBuiltins.test.ts`

**Interfaces:**
- Consumes: canonical request parameters and the shared `HttpOperation` mapping types.
- Produces: strict provider wire serialization, stable mapping identity manifests, and safe legacy-host migration.

- [x] **Step 1: Add and test the generic `toString` parameter transform.**

  The transform must serialize a numeric canonical value such as `duration: 8` as the provider-required string `"8"` without changing unrelated parameters.

- [x] **Step 2: Declare KIE Gemini Omni 1.1 media slots and duration conversion.**

  The mapping must explicitly declare `audio_ids`, `video_list`, `character_ids`, `first_frame_url`, and `last_frame_url`; a numeric duration must render as a string before dispatch.

- [x] **Step 3: Enforce Eleven Music v2 prompt/seed mutual exclusion and Eleven SFX v2's 22-second ceiling.**

  The request transform must reject `duration_seconds > 22` before provider dispatch and accept exactly 22 seconds. Music v2 must carry `prompt` and `model_id` without emitting `seed`.

- [x] **Step 4: Use MiniMax's current official host while preserving user-owned custom relays.**

  Seed reconciliation may repair only the exact old official host; it must not overwrite a custom `baseUrl`, custom name, enabled state, credentials, or user-owned settings.

- [x] **Step 5: Run focused contract tests.**

  Run:

  ```bash
  pnpm exec vitest run electron/catalog/paramTranslate.test.ts electron/catalog/kieGeminiOmni11.test.ts electron/catalog/elevenlabs.test.ts electron/catalog/minimaxOfficial.test.ts electron/catalog/seedBuiltins.test.ts
  ```

### Task 3: Reconcile Runway, KIE, fal, and long-tail catalog coverage

**Files:**
- Inspect/modify: `electron/catalog/runwayOfficial.ts`
- Inspect/modify: `src/config/modelArchetypes/runwayVideo.ts`
- Inspect/modify: `src/config/modelArchetypes/runwayImage.ts`
- Inspect/modify: `src/config/modelArchetypes/runwayAudio.ts`
- Test: `electron/catalog/runwayLoopback.integration.test.ts`
- Inspect/modify: `electron/catalog/kieSunoAudio.ts`
- Test: `electron/catalog/kieSunoAckWorker.test.ts`
- Inspect/modify: `electron/catalog/falOfficial.ts`
- Test: `electron/catalog/falLoopback.integration.test.ts`
- Test: `electron/catalog/falFaultMatrix.test.ts`

**Interfaces:**
- Consumes: official Runway, KIE, and fal contracts and shared `Mapping`/`HttpOperation` types.
- Produces: one exact mapping per supported official operation, no duplicate model rows, and provider-independent lifecycle declarations.

- [x] **Step 1: Refresh Runway's model inventory from the dated official models/OpenAPI sources.**

  The current official list includes video models `wan3`, `seedance2_5`, `grok_imagine_1_5`, `seedance2`, `seedance2_fast`, `seedance2_mini`, `hailuo3`, `aleph2`, `gen4.5`, `gen4_turbo`, `act_two`, `veo3.1`, `veo3.1_fast`, `happyhorse_1_0`, and `gemini_omni_flash`; image models `muse_image`, `grok_imagine_image_2`, `seedream5_pro`, `seedream5_lite`, `gen4_image`, `gen4_image_turbo`, `gemini_image3_pro`, `gemini_image3.1_flash`, `gpt_image_2`, and `gemini_2.5_flash`; plus `magnific_precision_upscaler_v2`, `magnific_video_upscaler_creative`, `ruby`, `gwm1_avatars`, and the audio family. Record the exact model ID, operation mode, request path, status path, result path, input slot, and official source for every selected mapping. Publish current high-value models that fit Nomi's existing media/profile contracts; keep `aleph2`, `act_two`, `gwm1_avatars`, upscalers, `ruby`, voice isolation, dubbing, and speech-to-speech explicitly `blocked` when no faithful generic ProfileKind/archetype exists, rather than coercing them into the wrong UI mode. Retain a legacy entry only when an existing project can still resolve it and the official contract remains documented.

- [x] **Step 2: Implement the Runway official upload path.**

  Use the declared `POST /v1/uploads` initialization, signed multipart upload, and returned `runway://` URI. Keep data URI support for small inputs. Do not call anonymous image hosts. Validate provider-private visibility, expiration, media type, and upload failure before model submission.

- [x] **Step 3: Verify generic Runway reference transforms.**

  The shared transform must serialize image/video/audio references into typed provider objects, enforce documented slot limits, and reject malformed or mixed keyframe requests before dispatch.

- [x] **Step 4: Add the generic `modeId` discriminator for KIE Suno mappings.**

  Use one model identity with mode mappings for music, extend, cover, and SFX. Do not create repeated model rows or a KIE-specific discriminator implementation.

- [x] **Step 5: Add KIE Suno active polling and callback ACK contract.**

  Implement `record-info` polling as the provider result path. Declare the production callback URL requirement. The Cloudflare Worker ACK endpoint must return 200 without parsing, storing, logging, or forwarding callback data and without receiving user keys. Until production deployment approval exists, callback modes remain `blocked`.

- [x] **Step 6: Verify fal's 10 logical models and 17 endpoints through one lifecycle.**

  Each endpoint must map create, queued/running status, terminal result, output extraction, managed asset materialization, and restart readback through the shared runtime. Do not add a fal-only executor.

  - [x] **Step 7: Run provider loopback and fault tests before any live request.**

  Run:

  ```bash
  pnpm run test:model-integration:fault-matrix
  pnpm exec vitest run electron/catalog/runwayLoopback.integration.test.ts electron/catalog/falLoopback.integration.test.ts electron/catalog/falFaultMatrix.test.ts electron/catalog/kieSunoAckWorker.test.ts
  ```

### Task 4: Maintain the machine-verifiable certification ledger and skills contract

**Files:**
- Modify: `docs/integration-certification/model-certification-ledger.json`
- Modify: `scripts/check-model-certification-coverage.mjs`
- Verify: `skills/model-integration/SKILL.md`
- Verify: `evals/model-integration/unified-certification.eval.json`

**Interfaces:**
- Consumes: stable mapping identity manifests and evidence produced by Tasks 2–3.
- Produces: a ledger that cannot claim coverage or live certification without matching source evidence.

- [x] **Step 1: Keep one ledger row per exact `vendorKey`, `modelKey`, `modeId`, and `mappingId`.**

- [x] **Step 2: Require official URLs, checked dates, static/loopback/failure/MCP evidence, live status, and an exact blocker when blocked.**

- [x] **Step 3: Make the coverage gate read literal mapping manifests from each curated catalog and reject unmapped or stale identities.**

- [x] **Step 4: Reconcile Runway's refreshed official inventory and any new KIE/fal mappings into the ledger without copying request bodies into it.**

- [x] **Step 5: Ensure `skills/model-integration` and its eval encode no guessed fields, cost gates, credential hygiene, production executor requirements, managed asset readback, and the four certification states.**

- [x] **Step 6: Run the static ledger gate.**

  Run:

  ```bash
  node scripts/check-model-certification-coverage.mjs
  ```

  Expected: every declared mapping identity is present exactly once and all zero-cost evidence references are complete.

### Task 5: Run the real zero-cost MCP and production-runtime journeys

**Files:**
- Verify/modify only if a failing test identifies a root cause: `electron/mcp/**`, `electron/integrationCertification/**`, `electron/runtime.ts`, `electron/tasks/**`, `electron/managedAssets/**`
- Tests: `tests/model-integration/**`, `electron/**/mcp*.test.ts`, provider loopback/fault tests from Task 3

**Interfaces:**
- Consumes: catalog contracts and certification ledger rows.
- Produces: no-spend evidence that the same MCP and production executor path can create, observe, validate, persist, restart, and read back media.

- [x] **Step 1: Run the no-repository MCP journey through spend confirmation.**

  Run:

  ```bash
  pnpm run test:model-integration:no-repo
  pnpm run test:mcp-journey
  ```

  Expected: MCP reaches immutable spend confirmation, `providerRequests = 0` for the no-cost journey, and `credentialBytesInResults = 0`.

- [x] **Step 2: Run packaged and trusted-audio journeys.**

  Run:

  ```bash
  pnpm run test:model-integration:packaged
  pnpm run test:model-integration:trusted-audio
  ```

- [x] **Step 3: Run the full fault matrix and verify fail-closed behavior.**

  Unknown submission, malformed result, missing asset, cancellation, and restart must never be reinterpreted as success.

- [x] **Step 4: Update only the affected ledger evidence after each green journey.**

  A deterministic pass changes a row to `simulated`; it never changes a row to `live-certified`.

### Task 6: Execute minimum-cost live canaries and classify every blocker honestly

**Files:**
- Modify: `docs/integration-certification/model-certification-ledger.json`
- Read-only runtime evidence: `GenerationRuntime`, `ProductionRun`, managed asset journal, fresh-process readback

**Interfaces:**
- Consumes: green Tasks 1–5, provider credentials supplied by the user, and the minimum valid request for each distinct contract shape.
- Produces: live task IDs, result-validation receipts, managed asset paths, fresh-process readback evidence, account-delta observations, or precise `blocked` rows without retry loops.

- [x] **Step 1: Build a canary matrix before making any paid call.**

  For each distinct provider/mode shape record model ID, smallest valid dimensions/duration, expected output type, expected upper-bound cost, idempotency key, and maximum attempts of one.

- [x] **Step 2: Run one minimal canary through Nomi's production executor.**

  The evidence must include provider task ID, Nomi task ID, status transition, output validation, managed asset materialization, journal commit, and fresh-process readback. A standalone curl or provider SDK call does not qualify.

- [x] **Step 3: Reconcile account deltas without inventing USD attribution.**

  Record observed provider balance changes separately from exact per-task pricing. If a provider exposes no balance, record `unknown` rather than fabricating a cost.

- [x] **Step 4: Mark each mapping once with an honest `live-certified`, `simulated`, or precise `blocked` state.**

  Authentication, account eligibility, network localization, callback deployment, missing official evidence, or unavailable model IDs are blockers. Do not blind-retry them.

- [x] **Step 5: Keep simulated mappings out of the “verified live” user-facing claim.**

### Task 7: Complete full repository verification and user-visible checks

**Files:**
- Read-only verification across the repository
- Screenshots/artifacts under ignored test output directories only

**Interfaces:**
- Consumes: the complete implementation and ledger.
- Produces: fresh, reproducible evidence for code health, Electron journeys, packaging, and user-visible behavior.

- [x] **Step 1: Run the contract gate from a clean working process.**

  ```bash
  pnpm run gates:contracts
  ```

- [x] **Step 2: Run focused and full tests.**

  ```bash
  pnpm exec vitest run electron/catalog/paramTranslate.test.ts electron/catalog/kieGeminiOmni11.test.ts electron/catalog/elevenlabs.test.ts electron/catalog/minimaxOfficial.test.ts electron/catalog/seedBuiltins.test.ts
  pnpm run test
  pnpm run test:e2e
  ```

- [x] **Step 3: Run build, package, and packaged smoke.**

  ```bash
  pnpm run build
  pnpm run dist
  pnpm run test:packaging
  node tests/ux/packaged-mcp-smoke.e2e.mjs release/mac-arm64/Nomi.app
  ```

- [x] **Step 4: Run real Electron user journeys and inspect screenshots manually.**

  Verified the existing model → provider → parameters surface, generation canvas, failure-safe controls, asset preview shell, and restart/readback. Screenshots were captured under `outputs/provider-model-visual-check/` and inspected manually; provider upload/result lifecycle was separately covered by the Runway managed canary.

- [x] **Step 5: Re-run `git diff --check`, `git status --short`, and the coverage gate after all generated outputs are removed or ignored.**

### Root-cause audit: generation succeeds but the user cannot retrieve the result

This audit is complete for the shared result path. The failure class was not a
Runway-only defect, so the repair is deliberately provider-neutral:

- [x] **Proxy route race / fake-IP rejection:** `hardenedFetch` now waits for the
  committed application route. With an HTTP/SOCKS proxy active it does not run
  local DNS pinning (which previously rejected RFC 2544 `198.18/15` answers or
  bypassed the proxy); direct routes retain the SSRF DNS check.
- [x] **Seek-required media false negative:** generated MP4/MOV bytes are
  validated from the exact Nomi-owned file artifact via `decodeMediaFile` and
  `probeMediaMetadata`, not `pipe:0`. Byte-only callers keep the bounded pipe
  decoder for formats that are stream-safe.
- [x] **Restart recovery misclassification:** a cache-rebuilt task query now
  propagates provider/network/localization errors to the renderer's free retry
  path. Only an unreconstructable receipt becomes `task_tracking_lost`.
- [x] **Split download transport:** manual download and automatic save now use
  the same bounded `hardenedFetch` route as generation localization; `nomi-local`
  reads remain internal managed-store reads.
- [x] **Same-class scan:** audited catalog localization, provider certification,
  ProductionRun/canvas recovery, preview frame extraction, auto-save, manual
  download, FFmpeg validation, and all direct `net.fetch` result consumers. The
  only remaining `contents.session.fetch` and localhost RPC fetches are
  intentionally browser/local boundaries, not provider-result paths.
- [x] **Regression evidence:** root-cause contract
  `docs/fixes/2026-08-31-generation-result-retrieval-boundary.root-cause.json`,
  181 focused assertions, the full 8,903-test suite, production Runway T2V/audio
  canaries, managed-asset journal commit, and fresh-process readback all pass.

### Task 8: Refresh `origin/main`, deliver the branch, and merge only after checks are green

**Files:**
- Scoped files from Tasks 2–7 only
- PR #241

**Interfaces:**
- Consumes: fresh verification evidence and exact task-branch diff.
- Produces: scoped commits pushed to `codex/provider-model-expansion-20260830`, PR #241 checks green, and (per the user's explicit authorization) a verified merge into `main`.

- [x] **Step 1: Fetch the latest default branch and inspect divergence without resetting or overwriting user work.**

  ```bash
  git fetch origin main
  git log --oneline --left-right HEAD...origin/main
  git diff --stat origin/main...HEAD
  ```

- [x] **Step 2: Integrate only necessary non-conflicting `origin/main` changes.**

  `origin/main` had no commits absent from this branch, so no integration or
  conflict resolution was necessary. User worktree changes were preserved.

- [x] **Step 3: Run the complete verification set again after integration.**

  `gates:contracts`, full tests, model-integration zero-cost journeys, MCP
  journey, build, dist, packaged media binary, and packaged MCP smoke all pass
  on the post-fix tree.

- [x] **Step 4: Commit only scoped files.**

  ```bash
  git add docs/integration-certification/model-certification-ledger.json \
    electron/catalog/builtinVendorSeeds.ts \
    electron/catalog/elevenlabs.ts electron/catalog/elevenlabs.test.ts \
    electron/catalog/kieGeminiOmni11.ts electron/catalog/kieGeminiOmni11.test.ts \
    electron/catalog/minimaxOfficial.ts electron/catalog/minimaxOfficial.test.ts \
    electron/catalog/paramTranslate.ts electron/catalog/paramTranslate.test.ts \
    electron/catalog/seedBuiltins.ts electron/catalog/seedBuiltins.test.ts \
    scripts/check-model-certification-coverage.mjs \
    docs/superpowers/plans/2026-08-31-provider-model-expansion-certification.md
  git commit -m "fix: close provider result retrieval boundaries"
  ```

  Commit: `17f9de6f20df3a89f10c08a4142c8abbd7602a12`.

- [x] **Step 5: Push the task branch and update PR #241.**

  ```bash
  git push origin codex/provider-model-expansion-20260830
  gh pr view 241 --json url,state,headRefName,baseRefName
  ```

  Remote head is updated after the final scoped commit; PR #241 remains the review surface until all required checks are green.

- [ ] **Step 6: Wait for required checks, merge PR #241, and verify the exact merge commit on `origin/main`.**

  Do not merge while checks are pending or failing. Fetch `origin/main` before merging; if it advanced, integrate non-destructively on the task branch and rerun the affected gates.

- [ ] **Step 7: Report branch, commit, PR URL, verification evidence, observed spend, and every mapping's final certification state.**

  The final handoff reports the 65-entry ledger, honest status vocabulary, and
  observed provider-cost evidence without exposing credentials.

## Self-review checklist

- [x] Every requirement in `docs/plan/2026-08-30-unified-model-integration-certification.md` maps to a task above.
- [x] No task contains unresolved placeholders, guessed fields, or an undefined interface.
- [x] No task promotes deterministic simulation to live certification.
- [x] Runway's broad model scope and official upload path are explicit.
- [x] KIE Suno callback approval is the only production deployment decision held for the user.
- [x] The plan preserves existing UI boundaries and the shared runtime/catalog architecture.

## Rollback

Rollback is a scoped PR revert. Catalog seed reconciliation may remove code-owned rows while preserving user-owned labels, settings, credentials, and managed assets. No rollback may reinterpret an unknown provider state as success, enable an uncertified mapping, or delete user-created mappings.
