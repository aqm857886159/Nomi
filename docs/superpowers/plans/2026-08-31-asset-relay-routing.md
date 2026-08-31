# Asset Relay Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make local image, video, and audio uploads reliable for desktop users by routing through provider-native upload APIs first, a user-configured Relay second, the bounded Nomi public Relay third, and anonymous hosting last.

**Status:** ✅ Implementation and Cloudflare publication delivered; the no-token production canary remains blocked by the current network path timing out to `workers.dev`.

状态：✅ 实现与 Cloudflare 发布已完成；无 Token 线上 canary 受当前到 `workers.dev` 的网络连接超时阻断。

**Architecture:** Keep upload selection in the existing shared asset resolver. Provider adapters declare their upload contract; the resolver applies one media-aware order and preserves explicit public-hosting consent. The Nomi Relay is a Cloudflare Worker backed by R2 with public rate limiting, storage/size/budget stops, and TTL cleanup; custom Relay credentials are persisted only in Electron main-process secure storage.

**Tech Stack:** Electron, React 18, TypeScript, Zustand, Vitest, Node test runner, Cloudflare Workers, R2, Wrangler.

**Spec:** `docs/plan/2026-08-31-asset-upload-routing.md`

## Global Constraints

- Normal users configure provider credentials only; the built-in Nomi public Relay requires no URL, token, or account.
- Nomi public Relay is fallback-only, supports image/video/audio, expires objects after 24 hours, and stops at configured size, storage, budget, or public-rate limits.
- Custom Relay is an advanced setting; its token never enters renderer state and is encrypted with Electron `safeStorage`.
- Upload candidates must be media-compatible and must fail over in the declared order; authentication, size, and invalid-parameter failures are not blindly retried.
- R2 secrets stay in Worker secrets/variables and are never committed or shipped to the desktop client.
- Validate with root-cause contracts, focused tests, contracts, typecheck, lint, build, and a live no-token Worker upload/readback/delete canary.

---

### Task 1: Establish the shared upload contract and route order

**Files:**
- Modify: `electron/catalog/assetLocalization.ts`
- Modify: `electron/catalog/assetLocalization.test.ts`
- Modify: `electron/catalog/assetRelayRuntimeConfig.ts`
- Modify: `docs/fixes/2026-08-31-asset-upload-capability-routing.root-cause.json`

**Interfaces:**
- `resolveAssetIngestionCandidates(...)` remains the single caller-facing resolver.
- `nomiAssetRelayCandidateFromEnvironment()` returns only an explicitly configured custom/environment Relay.
- `nomiPublicAssetRelayCandidate()` returns the built-in public fallback candidate.

- [x] Add regression tests proving provider-native candidates precede custom Relay, Nomi public Relay, and anonymous hosting, while incompatible media candidates are filtered.
- [x] Run `pnpm exec vitest run electron/catalog/assetLocalization.test.ts` and confirm the route assertions pass.
- [x] Implement the runtime configuration split so the built-in public URL is not confused with a secret-bearing custom Relay.
- [x] Record the recurring failure class and shared boundaries in the schema-v3 root-cause contract.

### Task 2: Add secure custom Relay settings to the desktop app

**Files:**
- Create: `electron/settings/assetRelaySettings.ts`
- Create: `electron/settings/assetRelaySettingsIpc.ts`
- Modify: `electron/settings/registerSettingsIpc.ts`
- Modify: `electron/preload.ts`
- Modify: `src/desktop/settingsBridge.ts`
- Modify: `src/workbench/settings/AiModelsSection.tsx`
- Modify: `src/i18n/locales/settings.ts`
- Modify: `src/workbench/settings/settingsDialogStructure.test.ts`

**Interfaces:**
- Main process persists `{ enabled, endpoint, token }` in `asset-relay.json`; only the token ciphertext is written.
- Renderer receives `{ enabled, endpoint, hasToken }` through `nomi:settings:asset-relay-get`.
- Renderer saves through `nomi:settings:asset-relay-set` with an optional token and clear operation.

- [x] Add the settings UI under the existing AI/data-upload section with endpoint, optional token, save, clear, and fallback-only copy.
- [x] Enforce HTTPS or localhost endpoints and reject invalid endpoints before persistence.
- [x] Encrypt tokens with `safeStorage`, hydrate the shared runtime config at app startup, and avoid returning token plaintext over IPC.
- [x] Run focused settings structure tests and typecheck.

### Task 3: Make the public Worker bounded and observable

**Files:**
- Modify: `workers/nomi-asset-relay/src/index.mjs`
- Modify: `workers/nomi-asset-relay/wrangler.toml`
- Modify: `workers/nomi-asset-relay/README.md`
- Modify: `tests/asset-relay/worker.node-test.mjs`

**Interfaces:**
- `POST /v1/assets` accepts private Bearer requests and, when enabled, public multipart requests.
- Public requests are limited by the `PUBLIC_UPLOAD_LIMITER` binding and the same media/size/storage/budget guards as private requests.
- `GET /v1/usage` remains private and is the operator usage/cost view.

- [x] Add a public upload test and a rate-limit rejection test before changing the Worker gate.
- [x] Enable public mode in the Worker config, bind the public rate limiter, and keep private usage protected.
- [x] Fail closed if usage or public-rate-limit enforcement is unavailable.
- [x] Run `node --test tests/asset-relay/worker.node-test.mjs`.

### Task 4: Document product behavior and operational limits

**Files:**
- Modify: `docs/ARCHITECTURE-NOW.md`
- Modify: `docs/plan/2026-08-31-asset-upload-routing.md`
- Modify: `workers/nomi-asset-relay/README.md`

- [x] Document the user-visible route order and the fact that normal users do not configure Relay environment variables.
- [x] Document 24-hour TTL, single-file limit, total storage cap, budget stop, rate limit, and Cloudflare billing as the cost source of truth.
- [x] Record the live public Worker version and the exact reason the no-token canary remains unverified.

### Task 5: Verify, publish, and hand off

**Files:**
- No additional production files; update the plan and root-cause evidence with exact results.

- [x] Run `pnpm run check:root-cause-contracts` and `git diff --check`.
- [x] Run focused unit tests, Worker tests, typecheck, and lint.
- [x] Deploy the Worker with the public flag and rate limiter using authenticated Wrangler.
- [ ] Perform an unauthenticated multipart upload, retrieve the returned URL, verify bytes, and delete the canary object.
- [ ] Run the full risk-selected contracts/build checks, commit only scoped files, push the task branch, and wait for PR checks.
- [ ] Report branch, commit, PR, live Worker result, limits, and any remaining external risk without exposing secrets.
