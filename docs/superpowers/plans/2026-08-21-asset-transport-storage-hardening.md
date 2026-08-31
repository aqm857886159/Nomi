# Asset Transport and Storage Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make local image/video storage and third-party asset transport type-safe, privacy-aware, expiry-aware, and observable so a video cannot fail because it was stored as `.bin`, sent to an image-only endpoint, or left on an expired public URL.

**Architecture:** Keep the project library as the durable source of truth. Introduce one canonical media-identity helper for local files and one upload-lease/policy layer for remote transport. Prefer the target provider's own upload API, then a configured authenticated relay/provider; keep anonymous public hosts available as a fallback, but gate the first actual use with a clear disclosure/confirmation and never use base64 JSON for video. Generation performs a local-storage and remote-lease preflight before the paid submit.

**Tech Stack:** Electron main process, TypeScript, React 18, Zustand, Vitest, Playwright/Electron walk scripts, existing `hardenedFetch` and catalog `AssetIngestion` declarations.

---

## Scope and decisions

The current code sends local references through `electron/catalog/assetLocalization.ts`. The actual current paths are:

- APIMart image upload: `https://api.apimart.ai/v1/uploads/images`, image-only, 20 MB, URL documented as valid for 72 hours.
- KIE file upload: authenticated temporary storage; stream upload is the video path. KIE's public docs describe temporary deletion/expiry and contain both 24-hour and three-day wording, so the implementation must trust a returned `expiresAt` when present and otherwise use a conservative 24-hour lease.
- Anonymous fallback: Litterbox first, then tmpfiles. The code sends files without an account; tmpfiles documents automatic deletion after 60 minutes. These hosts are public-link storage, have no Nomi-owned deletion control, and must not be an implicit path for private or long-running video work.

Recommended product decision: keep anonymous hosting available by default, but make the first actual use an explicit user decision. Before uploading, show the host class, expected lifetime, public-URL/privacy risk, and the reason it is being used. Provide `继续上传（本次）`, `以后不再提示`, and `取消`; default consent is `ask`, cancellation blocks only the current generation, and a remembered choice is stored locally per device/project. If the user has not configured KIE for video, the same preflight should explain that KIE video upload is free and is the recommended authenticated path, with a direct settings action. This preserves the frictionless default while preventing an invisible third-party upload and making the safer KIE route discoverable.

Risk decisions to preserve in implementation: APIMart's documented upload endpoint is image-only; KIE's upload service is temporary and its public documentation has conflicting 24-hour/three-day wording; tmpfiles documents a 60-minute lifetime; and Catbox's FAQ says commercial use requires prior approval. Nomi therefore treats anonymous hosts as a disclosed, consent-gated fallback and prefers the configured KIE path for video without silently making either host a hidden dependency.

## File map

Create:

- `electron/assets/assetIdentity.ts` — canonical file-header/content-type/kind/extension/size identity.
- `electron/assets/assetIdentity.test.ts` — `.mp4`, `.bin` containing MP4, WebM, image, unknown bytes.
- `electron/assets/projectAssetStore.test.ts` — canonical writes, sidecars, atomic completion, and legacy repair.
- `electron/catalog/assetTransportPolicy.ts` — upload policy, provider capability validation, remote lease validation, and safe fallback selection.
- `electron/catalog/assetTransportPolicy.test.ts` — no-video-base64, expiry, visibility, provider precedence, anonymous consent state (`ask`/one-time allow/remembered allow).
- `electron/assets/assetHealth.ts` — project root/manifest/file/readability/free-space diagnostics and repair candidates.
- `electron/assets/assetHealth.test.ts` — missing root, missing manifest, corrupt manifest, missing asset, `.bin` video, permissions.
- `tests/ux/asset-transport-storage.walk.mjs` — real Electron user journeys and screenshots.

Modify:

- `electron/assets/mediaTypes.ts` — make unknown media a first-class `unknown` result and reuse the identity helper.
- `electron/assets/projectAssetStore.ts` — canonical extension/sidecar metadata, atomic media writes, and legacy repair.
- `electron/assets/localFileImport.ts` — sniff before naming and preserve the canonical MIME/kind.
- `electron/assets/localAssetFile.ts` — return identity plus origin provider/expiry metadata; reject unreadable assets with structured errors.
- `electron/assets/assetPaths.ts` — sidecar-aware kind/content-type derivation for legacy `.bin` files.
- `electron/workspace/workspaceFileIndex.ts` — classify by sidecar/header, not extension alone.
- `electron/protocol/localProtocol.ts` — return the real media MIME for range and normal responses.
- `electron/workspace/workspaceRepository.ts`, `electron/projects/repository.ts` — expose project-path diagnostics and safe recovery.
- `electron/catalog/types.ts` — add transport visibility, supported kind, size, and lease capability fields.
- `electron/catalog/assetLocalization.ts` — use the policy layer, forbid unsafe video routes, return an upload lease, and require the consent gate before an anonymous fallback upload.
- `electron/catalog/customCallDispatch.ts`, `electron/runtime.ts` — use the same policy and preflight for mapping and custom-call paths.
- `electron/settings/automationPolicyContract.ts`, `electron/settings/automationPolicySettings.ts`, `src/workbench/settings/AiModelsSection.tsx` — persist and enforce anonymous-host consent (`ask`/`allow`/`deny`), `allowCrossVendorUrlReuse`, and `minimizeUploads` (the current toggle is rendered but not consumed by the normal canvas upload path), and expose the free KIE video-upload setup action.
- `src/workbench/generationCanvas/runner/catalogTaskActions.ts` — mark only active reference fields and strip stale local URLs from inactive metadata before IPC.
- `src/workbench/generationCanvas/model/nodeAssetDrop.ts`, `src/workbench/assets/AssetLibraryPanel.tsx`, `src/workbench/assets/assetTypes.ts` — classify `application/octet-stream` by file header when the name is an accepted media file.
- `src/workbench/observability/classifyError.ts`, `src/workbench/observability/narrate.ts`, `src/i18n/locales/generationCommon.ts`, `src/i18n/locales/settings.ts` — explain storage/transport/expiry/privacy failures and the exact next action.
- `electron/catalog/assetLocalization.test.ts`, `electron/workspace/workspaceFileIndex.test.ts`, `electron/protocol/localProtocol.test.ts`, `src/workbench/generationCanvas/model/nodeAssetDrop.test.ts` — regression coverage.

Do not modify the provider generation mappings unless a test demonstrates a separate response-shape defect; this plan is about asset storage and transport boundaries.

---

### Task 1: Lock the media identity contract

**Files:**
- Create: `electron/assets/assetIdentity.ts`
- Create: `electron/assets/assetIdentity.test.ts`
- Modify: `electron/assets/mediaTypes.ts`

- [ ] **Step 1: Write the failing tests**

```ts
it('recognizes an MP4 whose stored name is .bin', () => {
  const identity = identifyAsset('upload.bin', mp4FixtureBytes)
  expect(identity).toMatchObject({ kind: 'video', contentType: 'video/mp4', extension: '.mp4' })
})

it('does not guess unknown bytes are an image', () => {
  expect(identifyAsset('unknown.bin', Buffer.from([1, 2, 3, 4])).kind).toBe('unknown')
})
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `pnpm exec vitest run electron/assets/assetIdentity.test.ts`

Expected: FAIL because `identifyAsset` does not exist and unknown media currently falls through to image behavior.

- [ ] **Step 3: Implement the identity helper**

Use one return type for every import/list/upload caller:

```ts
export type AssetIdentity = {
  kind: 'image' | 'video' | 'audio' | 'unknown'
  contentType: string
  extension: string | null
  size: number
  detectedBy: 'extension' | 'magic' | 'declared' | 'unknown'
}
```

The order is declared MIME only when it is a supported media MIME, then known extension, then magic bytes, then `unknown/application/octet-stream`. `mediaKindFromContentType` must return `unknown` for an unknown type; callers that require image/video/audio must reject instead of silently choosing image.

- [ ] **Step 4: Run the focused test and verify it passes**

Run: `pnpm exec vitest run electron/assets/assetIdentity.test.ts electron/assets/mediaTypes.test.ts`

Expected: PASS, with existing supported extension tests unchanged.

- [ ] **Step 5: Commit**

```bash
git add electron/assets/assetIdentity.ts electron/assets/assetIdentity.test.ts electron/assets/mediaTypes.ts
git commit -m "fix: make local media identity fail closed"
```

### Task 2: Make local project storage canonical and repairable

**Files:**
- Modify: `electron/assets/projectAssetStore.ts`, `electron/assets/localFileImport.ts`, `electron/assets/localAssetFile.ts`, `electron/assets/assetPaths.ts`
- Create: `electron/assets/projectAssetStore.test.ts`
- Create: `electron/assets/assetHealth.ts`, `electron/assets/assetHealth.test.ts`
- Modify: `electron/workspace/workspaceFileIndex.ts`, `electron/protocol/localProtocol.ts`

- [ ] **Step 1: Add failing storage tests**

Cover these exact invariants:

```ts
it('stores an octet-stream MP4 with .mp4 extension and sidecar type', async () => { /* import bytes */
  expect(path.extname(written.absolutePath)).toBe('.mp4')
  expect(readMeta(written.absolutePath)).toMatchObject({ contentType: 'video/mp4', kind: 'video' })
})

it('lists a legacy .bin MP4 as a video', () => {
  expect(listWorkspaceFiles(...).items.find(x => x.name === 'clip.bin')).toMatchObject({ kind: 'video', contentType: 'video/mp4' })
})

it('serves a legacy .bin MP4 with video/mp4 for range requests', async () => {
  expect((await handleNomiLocalRequest(rangeRequest)).headers.get('Content-Type')).toBe('video/mp4')
})
```

- [ ] **Step 2: Run the tests and verify the current failures**

Run: `pnpm exec vitest run electron/assets/projectAssetStore.test.ts electron/workspace/workspaceFileIndex.test.ts electron/protocol/localProtocol.test.ts electron/assets/assetHealth.test.ts`

Expected: FAIL for unknown-extension classification and missing health diagnostics.

- [ ] **Step 3: Canonicalize all writes**

In `writeAsset`, `copyAssetFile`, `moveAssetFile`, and local import, call `identifyAsset` before selecting the destination name. Preserve the original name in sidecar metadata, but use the detected extension for the physical file. Always write `contentType`, `mediaType`, `kind`, `size`, and `detectedBy`; sidecar write failure becomes a surfaced warning, not a silent loss of type metadata. Write large media to a same-directory temporary file and atomically rename it after `fsync`/stat verification.

- [ ] **Step 4: Make all reads sidecar/header aware**

`listProjectAssets`, `workspaceFileIndex`, and `localProtocol` must use sidecar metadata first, then `identifyAsset`, and only then return `application/octet-stream`. A legacy `.bin` MP4 must be usable without manual renaming.

- [ ] **Step 5: Add a non-destructive repair operation**

`assetHealth.ts` must report `{ projectId, rootPath, manifestStatus, assetStatus, identity, readable, freeBytes }`. The repair function copies a recognized legacy file to its canonical extension, rewrites all `nomi-local://asset/<projectId>/<relativePath>` references in the project payload, saves the manifest atomically, and deletes the old file only after the new path is verified. If the manifest cannot be read, it reports a recoverable error and leaves files untouched.

- [ ] **Step 6: Run the tests and commit**

Run: `pnpm exec vitest run electron/assets/projectAssetStore.test.ts electron/assets/assetHealth.test.ts electron/workspace/workspaceFileIndex.test.ts electron/protocol/localProtocol.test.ts`

Expected: PASS, including `.bin` MP4 compatibility and incomplete-write recovery tests.

```bash
git add electron/assets electron/workspace/workspaceFileIndex.ts electron/protocol/localProtocol.ts
git commit -m "fix: make project media storage canonical and repairable"
```

### Task 3: Enforce provider upload capabilities and remote leases

**Files:**
- Create: `electron/catalog/assetTransportPolicy.ts`, `electron/catalog/assetTransportPolicy.test.ts`
- Modify: `electron/catalog/types.ts`, `electron/catalog/assetLocalization.ts`, `electron/catalog/assetLocalization.test.ts`

- [ ] **Step 1: Define the transport contract and failing tests**

Add these fields to transport declarations without changing existing provider mapping shapes:

```ts
type AssetTransportVisibility = 'provider-private' | 'public-anonymous'
type AssetUploadLease = {
  url: string
  providerKey: string
  visibility: AssetTransportVisibility
  createdAt: string
  expiresAt?: string
  contentType: string
  size: number
}
```

Tests must assert:

- video never chooses `inline-base64` or `upload-url`;
- APIMart's image upload is never selected for video;
- KIE stream is selected for APIMart video when a KIE key exists;
- anonymous chain is available by default only through the consent gate;
- an anonymous image/video route is returned after one-time consent or a remembered local allow;
- a lease that expires before the configured minimum generation window is rejected before provider submit.

- [ ] **Step 2: Implement capability validation and precedence**

Use this order:

```text
target provider's declared type-safe upload
→ configured authenticated Nomi relay
→ KIE stream (only when configured and accepted)
→ another configured authenticated provider with the same media capability
→ anonymous public chain only when explicit policy allows it
→ structured asset-transport-unavailable error
```

For video/audio, only binary multipart/stream transports are valid. A custom vendor declaration that claims `video` on `upload-url` must be rejected as unsafe rather than trusted blindly.

- [ ] **Step 3: Parse and validate expiry/visibility**

Capture provider response expiry when available. If missing, apply the provider-specific conservative upper bound. Do not store raw upload URLs in logs. Validate URL scheme, response status, content type, and size with a bounded HEAD/range probe before inserting the URL into the paid request. If the probe fails, retry upload through the next safe route instead of submitting a URL that the vendor may fetch later and fail.

- [ ] **Step 4: Apply the policy to both execution paths**

Route both `electron/runtime.ts` mapping tasks and `electron/catalog/customCallDispatch.ts` through the same policy function. Change the localization return shape to `{ value, uploaded, leases }`; keep leases in task trace metadata, never in prompts or persisted node content.

- [ ] **Step 5: Run tests and commit**

Run: `pnpm exec vitest run electron/catalog/assetTransportPolicy.test.ts electron/catalog/assetLocalization.test.ts electron/runtime.provider-adapter.test.ts`

Expected: PASS, with a red test if a video is ever routed to a base64/image-only transport.

```bash
git add electron/catalog/types.ts electron/catalog/assetTransportPolicy.ts electron/catalog/assetLocalization.ts electron/catalog/*test.ts electron/runtime.ts
git commit -m "fix: enforce safe media upload transports and leases"
```

### Task 4: Remove stale references and make the upload privacy setting real

**Files:**
- Modify: `src/workbench/generationCanvas/runner/catalogTaskActions.ts`, `electron/settings/automationPolicyContract.ts`, `electron/settings/automationPolicySettings.ts`, `src/workbench/settings/AiModelsSection.tsx`
- Modify: `electron/runtime.ts`, `electron/catalog/customCallDispatch.ts`
- Modify: `src/i18n/locales/settings.ts`, `src/i18n/locales/generationCommon.ts`

- [ ] **Step 1: Write failing request-shaping tests**

Build a node with an active reference and a stale local URL in an inactive mode field. Assert that only the active URL reaches `request.extras`, and that `minimizeUploads: true` results in exactly the active reference set as upload candidates.

- [ ] **Step 2: Mark active assets at the renderer boundary**

`buildCatalogTaskRequest` must emit an internal `activeAssetUrls` list derived from the current mode's first/last/image/video/audio slots and the current reference edges. Before spreading `node.meta`, remove `nomi-local://` values not in that allowlist; keep ordinary model parameters unchanged.

- [ ] **Step 3: Enforce the policy in main**

Read the persisted automation policy in both runtime paths. `minimizeUploads` controls the allowlist; `allowCrossVendorUrlReuse` defaults false, so a provider URL is reused directly only for the same provider that produced it. Otherwise the local bytes go through the selected safe upload route.

- [ ] **Step 4: Add user-facing disclosure**

The setting UI must show that a local reference may be sent to the target provider, an authenticated relay/provider, or an explicitly enabled public temporary host. The production summary and ordinary node error must name the actual host class and retention window without showing the full URL.

- [ ] **Step 5: Run tests and commit**

Run: `pnpm exec vitest run src/workbench/generationCanvas/runner/catalogTaskActions.test.ts electron/productionRun/productionRunService.test.ts electron/catalog/assetLocalization.test.ts`

Expected: PASS; the setting now changes normal canvas behavior, not just the rendered checkbox.

```bash
git add src/workbench/generationCanvas/runner/catalogTaskActions.ts src/workbench/settings/AiModelsSection.tsx electron/settings electron/runtime.ts electron/catalog/customCallDispatch.ts src/i18n/locales
git commit -m "fix: honor active reference and upload privacy policy"
```

### Task 5: Add project/path health checks before paid submission

**Files:**
- Modify: `electron/assets/assetHealth.ts`, `electron/workspace/workspaceRepository.ts`, `electron/projects/repository.ts`
- Modify: `src/workbench/generationCanvas/runner/generationRunController.ts`, `electron/runtime.ts`
- Modify: `src/workbench/observability/classifyError.ts`, `src/workbench/observability/narrate.ts`, `src/i18n/locales/generationCommon.ts`

- [ ] **Step 1: Write failing preflight tests**

Cover: missing project root, moved project, unreadable manifest, missing local file, unknown media bytes, insufficient free space, and no safe video upload route. Assert no spend grant is consumed and no provider create request is made.

- [ ] **Step 2: Implement `assertLocalAssetReady`**

Resolve the project ID and relative path, verify the manifest ID, read permission, file size, identity, and project free space. Return a structured diagnostic object with `stage: 'local-storage' | 'transport-policy'`, `action`, and redacted `assetName`; never include absolute paths or API keys in user-visible errors.

- [ ] **Step 3: Put the preflight before the paid guard**

Run local health and transport capability checks before `assertAndConsumeSpendGrant` and before any upload. If the only viable route is anonymous, pause at the consent gate before uploading; if KIE is not configured for video, surface the free KIE setup action before falling back. This prevents a broken local path or undisclosed third-party upload from charging the user or creating a task that cannot fetch its reference.

- [ ] **Step 4: Add repair/retry actions**

Map diagnostics to actions: `重新导入素材`, `修复项目位置`, `配置 KIE/Relay（视频上传免费）`, `继续上传（本次）`, `以后不再提示`, or `重试上传`. A retry must re-read bytes and re-evaluate identity; it must not resubmit a paid task automatically.

- [ ] **Step 5: Run tests and commit**

Run: `pnpm exec vitest run electron/assets/assetHealth.test.ts src/workbench/generationCanvas/runner/canRunGenerationNode.test.ts electron/productionRun/productionRunService.test.ts`

Expected: all local-storage failures stop before spend and provider create.

```bash
git add electron/assets/assetHealth.ts electron/workspace/workspaceRepository.ts electron/projects/repository.ts electron/runtime.ts src/workbench/generationCanvas/runner src/workbench/observability src/i18n/locales
git commit -m "fix: preflight local assets before paid generation"
```

### Task 6: Add real transport and storage end-to-end verification

**Files:**
- Create: `tests/ux/asset-transport-storage.walk.mjs`
- Modify: `tests/ux/_launchApp.mjs` only if a test hook is needed; do not add production bypasses.
- Test fixtures: `tests/fixtures/media/clip.mp4`, `tests/fixtures/media/clip-no-extension`

- [ ] **Step 1: Add a real Electron walk for canonical import**

Launch the app through the existing harness, import both an `.mp4` and a file with no extension/`application/octet-stream`, inspect the real page, and assert via the project manifest that both are `kind: video` with canonical content type. Capture a screenshot of the asset library showing both as videos.

- [ ] **Step 2: Add a real walk for APIMart video reference**

Use a deterministic mock upload/submit endpoint in the test environment. Verify that the request uses a binary video upload route, never a base64 image route, and records the transport host class and expiry in the trace. Verify that a simulated expired lease causes a re-upload/recoverable error before provider submit.

- [ ] **Step 3: Add privacy and fallback walks**

Verify the first-use anonymous prompt appears before any Litterbox/tmpfiles request, that `取消` blocks the current run without uploading, that `继续上传（本次）` permits one fallback, and that `以后不再提示` persists locally. Configure KIE in the real settings page, verify the free-video explanation and KIE stream route, then run an image/video fallback only when KIE is unavailable or declined. Verify video remains blocked when the only available anonymous URL has a TTL shorter than the generation lease.

- [ ] **Step 4: Human-check screenshots and run gates**

Run:

```bash
node tests/ux/asset-transport-storage.walk.mjs
pnpm run check:filesize
pnpm run check:tokens
pnpm run check:i18n
pnpm run lint:ci
pnpm run typecheck
pnpm run test
pnpm run build
```

Expected: the walk produces screenshots for import, blocked unsafe transport, authenticated transport, and expired lease; a reviewer visually checks that the action and host disclosure are understandable.

- [ ] **Step 5: Commit the complete hardening slice**

```bash
git add tests/ux tests/fixtures
git commit -m "test: verify local media and remote asset transport end to end"
```

---

## Acceptance criteria

- A video with missing extension or `application/octet-stream` is either correctly identified as video or explicitly rejected as unknown; it is never silently treated as an image.
- APIMart's image-only upload endpoint is never used for video.
- No video uses base64 JSON transport.
- Anonymous public hosting is opt-in, disclosed, and never selected for a video whose lease cannot cover the generation window.
- Local storage failures, permission failures, and expired remote URLs are reported before paid submission and do not consume a spend grant.
- A provider result is downloaded into the project's durable local storage immediately; the temporary provider URL is not the node's only copy.
- Existing `.bin` MP4 files remain usable and can be repaired without losing manifest references.
- The current “only send assets needed for this task” setting changes the normal canvas path and excludes stale/inactive local references.
- Unit tests, build gates, and real Electron screenshots all pass.

## Rollback

Keep the transport policy and canonical storage changes in separate commits. If a provider's live response shape breaks, revert only its capability declaration/adapter commit; do not remove the disclosure gate or restore the old “unknown means image” behavior. Legacy `.bin` files remain readable through sidecar/header detection, so disabling repair UI does not make existing projects unreadable.
