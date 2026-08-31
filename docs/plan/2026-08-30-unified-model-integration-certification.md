# Unified Provider And Model Integration Certification

> 🚧 进行中
> Baseline: `origin/main @ 491d670a` on `codex/provider-model-expansion-20260830`
> Decision date: 2026-08-30

## Goal

Finish this provider and flagship-model expansion through one fail-closed,
evidence-backed integration process, then make that process the mandatory path
for future model work.

The unit of completion is not a provider row or a model picker entry. It is one
exact `provider x model x mode` contract whose official evidence, Nomi
declarations, deterministic protocol behavior, failure behavior, persistence,
and certification state agree. Every model added or changed by this branch is
returned to `uncertified` until it passes the gates below, including work that
was implemented before this plan was rewritten.

The product outcome remains intentionally quiet: Nomi keeps its existing
model -> provider -> parameters flow. Users gain current flagship choices,
audio/music/SFX and usable 3D assets, provider/model identity logos, an external
LocalAI connector, honest task recovery, and fewer broken integrations. This
plan does not create a new model center or redesign the parameter bar.

## Existing Contract Owners

This plan composes Nomi's existing contracts. It must not create parallel model
or runtime schemas.

| Concern | Existing owner | This plan's use |
|---|---|---|
| Model identity, modes, slots, scalar limits | `src/config/modelArchetypes` | Keep model facts and `sources/covers` here |
| Provider transport | Catalog `Model`, `Mapping`, `HttpOperation` | Declare create/query/result, auth, wire fields and output paths |
| Generated headless defaults | `scripts/gen-archetype-wire-defaults.ts` | Regenerate from archetypes; never hand-edit generated files |
| Dynamic documentation compiler | `electron/providerAdapter` | Compile and statically validate conversational integrations |
| Canonical paid certification | `electron/integrationCertification` | Own spend receipt, one submission, artifact verification and promotion |
| Task lifecycle and assets | generation runtime, ProductionRun and managed assets | Normalize state, resume safely, and materialize bounded media/GLB |
| Current-model discovery | `scripts/model-radar.ts` | Detect changes; do not infer API contracts from names |
| Conversational entry | PR #221 MCP tools and `skills/model-integration` | Orchestrate the same contracts without source or Catalog bypasses |

The certification ledger introduced by this plan stores references and gate
evidence only. It must not copy parameter enums or request bodies out of those
owners.

## Mandatory Pipeline

Every in-scope `provider x model x mode` passes these stages in order:

1. **Scope and identity**
   - Prove that the model is a current flagship, a necessary value variant, or
     a compatibility-only legacy entry at the dated decision point.
   - Keep distinct upstream contracts distinct. For example, KIE Gemini Omni
     Flash 1.1 is not APIMart Gemini Omni Flash Preview.
2. **Official evidence**
   - Read current first-party documentation or the endpoint's official
     OpenAPI. Record the exact URL and checked date through existing
     `ModelArchetype.sources` where an archetype exists.
   - Reconcile method, path, auth, all modes and media slots, required fields,
     enums/ranges/defaults, mutual exclusions, status vocabulary, output path,
     cancellation, retention and billing behavior.
   - Write `not documented` or an explicit blocker when evidence is absent.
     Never guess a field, limit, model id or fallback.
3. **Nomi declaration**
   - Reuse the existing archetype and Catalog operation vocabularies. Add a
     shared primitive only when an official contract cannot be represented.
   - Regenerate derived artifacts and prove seed reconciliation preserves user
     labels/settings while repairing code-owned transport drift.
4. **Static certification, zero provider cost**
   - Validate source provenance, schemas, template roots, same-origin paths,
     required media result mappings, mapping selection, generated artifacts,
     secret handling, and full ledger coverage.
5. **Protocol simulation, zero provider cost**
   - Drive the production executor against a deterministic loopback server.
   - Cover sync and create -> query -> optional result lifecycles, queued and
     running states, exact request serialization, output extraction,
     materialization, restart readback and idempotency.
6. **Failure matrix, zero provider cost**
   - Cover 400/401/402/403/404/422/429/5xx, timeout, malformed/truncated JSON,
     unknown statuses, missing task ids, wrong output shape/MIME/magic bytes,
     oversized media, cancellation and process restart.
   - Unknown submission never retries create without a reconcilable remote id.
7. **Conversational MCP dry run, zero provider cost**
   - Use PR #221's real MCP boundary to begin, discover, compile, select and
     reach the immutable spend-confirmation stage from official evidence.
   - The produced draft must converge on the same provider adapter validator
     and Catalog contracts as a built-in declaration.
8. **Minimal live canary, paid only as final evidence**
   - Run only after stages 1-7 are green. Use the cheapest valid parameters and
     one representative request per distinct wire/lifecycle/output shape.
   - Reuse one canary across modes only when their serialized operation shape
     is provably identical; never reuse evidence across different endpoints or
     result schemas.
   - A live run must use the production executor, bounded artifact validation,
     managed storage, journal commit and fresh-process readback. It is never a
     debugging loop.

## Certification States

- `documented`: official evidence and exact Nomi declaration are reconciled.
- `simulated`: all zero-cost static, lifecycle, failure and persistence gates pass.
- `live-certified`: a credential-backed minimal production canary and fresh-process readback pass.
- `blocked`: an exact external prerequisite is missing, such as a required
  public callback or an unconfirmed upstream model id.

Only `live-certified` may be described as verified with a real provider.
`documented + simulated` is deterministic integration evidence, not a claim
that the current account has quota or upstream access. Missing credentials do
not justify leaving deterministic work incomplete.

## In-Scope Re-Certification Inventory

The machine-readable ledger is the exact inventory. At minimum it covers:

- MiniMax official: M3 text, H3 video, Speech 2.8 HD/Turbo.
- ElevenLabs official: Eleven v3, Music v2, Sound Effects v2, Scribe v2.
- Meshy official: Meshy 7 image-to-3D with GLB materialization.
- KIE: Gemini Omni Flash 1.1 and Suno Sounds V5.5. KIE Suno V5.5 music remains
  blocked while its official contract requires a public callback URL.
- APIMart: Suno V5.5 music, Suno Sounds V5.5 and FlowMusic Lyria 3.5.
- fal: a curated current flagship set across image, video, audio/music/SFX and
  image-to-3D, with one exact OpenAPI contract per endpoint.
- LocalAI: external discovery/health/capability connector only. Text reuses the
  existing OpenAI-compatible path. Nomi does not bundle LocalAI, runtimes or
  model weights, and media execution is not claimed without a separate exact
  contract.
- Shared runtime changes required by these entries: normalized state,
  reconcile/cancel semantics, optional result stage, asynchronous audio and
  managed GLB assets.

Old APIMart/KIE models remain for project compatibility but are not silently
re-certified by this branch unless their contracts changed.

## Cost Policy

Public documentation fetches, schema validation, loopback HTTP, generated
fixtures, MCP dry runs and restart tests cost no provider credits and should be
exhausted first. The live-canary plan records:

- why the canary adds evidence not already established deterministically;
- the minimum valid request values;
- expected upper-bound cost or `unknown` when the provider does not expose it;
- the exact modes whose shared wire shape it certifies;
- an idempotency key and maximum attempt count of one.

Auth, balance, quota, account eligibility and unknown-submission failures are
never blind-retried. Without credentials, the final report leaves live state
as `not-run: no credential` and does not ask for keys in chat.

## Product Boundaries

- Preserve the current model -> provider -> parameters interaction.
- Add provider/model logos only where those selectors already exist.
- Preserve the existing aspect-ratio visual control and duration control.
- Audio, music, SFX and transcription use the existing audio node and asset
  system; do not add a second audio workspace.
- 3D reaches the usable asset layer: filter, rotating preview, download and
  restart recovery. It does not enter the 2D timeline.
- LocalAI remains an external connector; no sidecar, installer, model download,
  process supervision, hardware scheduler or packaged weights.

## Delivery Gates

1. The ledger covers every model/mapping changed from the baseline and rejects
   unreferenced additions.
2. All official-source and generated-contract checks pass.
3. Every in-scope wire shape has loopback success, failure and restart evidence.
4. PR #221 MCP completes a real no-spend journey through the production MCP server.
5. `skills/model-integration` encodes this pipeline, boundaries, cost policy,
   templates and evals; it does not embed provider-specific request bodies.
6. Contracts, focused/full tests, typecheck, build/package, and Electron user
   journeys pass on the task branch after integrating current `origin/main`.
7. Delivery uses a scoped commit, pushed task branch and pull request. No direct
   push or merge to the default branch.

## Rollback

Rollback is the scoped PR revert. Seed reconciliation may remove new code-owned
rows while preserving credentials, user-owned labels/settings and generated
assets. No migration may reinterpret an unknown provider state as success,
convert an uncertified mode into enabled, or delete user-created mappings.
