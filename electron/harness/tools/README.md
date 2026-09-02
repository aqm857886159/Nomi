# Agent tool projection

`agentToolCatalog.ts` is the only model-facing entry point for Pi tool projections.

- `canvasDescriptors.ts`, `documentDescriptors.ts`, and `productionRunDescriptors.ts` own legacy domain schemas; semantic model tools are declared in `modelToolSurfaceManifest.ts`.
- `agentToolCatalog.ts` composes those descriptors in stable order and exposes the runtime projection used by `agentChatPolicy`.
- Canonical capability contracts and authorization stay in `electron/shared/agentCapabilities/`.
- Execution adapters stay in `electron/capabilityCore/`; the Project Agent Host only orchestrates, approves, and records refs.

When adding a tool, update its domain descriptor and canonical capability contract first, then add it to the catalog test. Do not hand-copy a second descriptor into the Host or renderer.
