# Live generation readiness evidence — 2026-09-13

The latest real cover request was blocked by `generation_surface_unavailable`. The shared bootstrap was inspected without printing or exporting any secret values.

- Settings root: isolated real-Electron profile used by the acceptance run.
- APIMart vendor: enabled.
- APIMart catalog models: 34.
- APIMart credential record: present and enabled, encrypted with `safeStorage`.
- `readCatalog()` reports `hasApiKey: false` because the isolated profile cannot decrypt the stored credential.
- `createGenerationProviderBootstrap()` returns `providers: 0` and `readiness.providerReady: false` with `missingForSubmit: ["configured_provider"]`.
- Therefore the lane correctly returns `generation_surface_unavailable` before any paid submission. No key was printed, copied, or persisted; no provider request was retried.

This is an environment credential-readiness blocker, not a prompt or canvas-state failure. The zero-cost loopback fixture remains the only generation path exercised in this branch.
