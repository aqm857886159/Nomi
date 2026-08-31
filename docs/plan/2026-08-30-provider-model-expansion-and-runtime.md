# Flagship Provider Expansion And Runtime Plan

> ⛔ 已废弃（已由统一认证计划接管）
> 替代文档：`docs/plan/2026-08-30-unified-model-integration-certification.md`
> Baseline: `origin/main @ 491d670a` on `codex/provider-model-expansion-20260830`
> Decision date: 2026-08-30
>
> Superseded by `docs/plan/2026-08-30-unified-model-integration-certification.md`.
> This file preserves the earlier implementation outline only; its scope and
> completion criteria are no longer authoritative.

## Goal

Add only current flagship models needed by Nomi, especially audio and 3D, while extending the existing generation control plane so cloud and local executors share honest status, recovery, cancellation, and materialization semantics.

This plan advances the architecture handoff in `docs/handoff/2026-08-30-local-model-agent-runtime-architecture-handoff.md` without implementing in its obsolete PR #221 worktree.

The integrated product and interaction design is `docs/superpowers/specs/2026-08-30-unified-model-runtime-experience-design.md`. It treats PR #188 and PR #221 as shipped foundations and covers settings, model routing, creation, task recovery, audio assets, and the 3D usable layer rather than limiting this work to catalog records.

## Baseline

- Built-in catalog suppliers: 12.
- Built-in catalog models: 92; mappings: 136.
- Modalities: image 38, video 34, text 15, audio 2, model3d 3.
- Target after this plan: 15 suppliers, 106 models, and 151 mappings; image 38, video 36, text 16, audio 12, model3d 4.
- Volcengine already exists in both catalog and text-provider surfaces; do not duplicate it.
- APIMart and KIE already carry broad media catalogs, including H3 aggregator mappings.
- The shared provider interface declares optional reconcile/cancel, but production does not execute reconcile or cancel.
- All catalog audio tasks currently enter the synchronous TTS/transcription runner, so asynchronous music mappings cannot work.
- Shared generation materialization excludes `model3d`, despite GLB already being a first-class asset elsewhere in Nomi.

## Curated Scope

| Provider | Flagship models | Why now |
|---|---|---|
| MiniMax official | `MiniMax-M3`, `MiniMax-H3`, `speech-2.8-hd`, `speech-2.8-turbo` | Official text/video/speech route; M3 replaces obsolete M1; H3 exercises multimodal video lifecycle |
| ElevenLabs official | `eleven_v3`, `music_v2`, `scribe_v2`, `eleven_text_to_sound_v2` | One current official provider closes speech, music, transcription, and SFX gaps |
| Meshy official | `meshy-7` image-to-3D | One-stage official image-to-3D contract returns a GLB and does not require RunningHub's Enterprise-Shared credential |
| KIE | `google/gemini-omni-flash-1-1`, Suno `V5_5` music and sounds | Adds the current versioned Gemini Omni contract plus flagship asynchronous music/SFX to an existing supplier |
| APIMart | Suno `v5.5` music and sounds; `flowmusic` with `version=lyria-3.5` | Adds current asynchronous music/SFX routes to an existing supplier |

APIMart's `gemini-omni-flash-preview` is not the same contract as KIE's versioned 1.1 model: it currently documents a narrower 720p Preview API. It remains research evidence, not a flagship catalog addition, until APIMart publishes a 1.1 contract.

Not included: old model generations; APIMart Gemini Omni Preview; MiniMax Music 3.0 (closed to new API users on 2026-08-20); Meshy two-stage text-to-3D; fal and broader Replicate media expansion; unverified Hi3D 3.0 API ids; every uncovered radar URL. fal and Hugging Face remain follow-up platform work because every curated media endpoint still needs its own request/result contract and paid certification.

## Implementation Rounds

### Round 1: Shared Contracts

1. Normalize provider task state to `queued/running/succeeded/failed/cancelled/unknown`; preserve raw provider status only as diagnostic evidence.
2. Make reconcile return `found/not_found/indeterminate`; an unknown submit never automatically resubmits.
3. Expose provider cancel through the runtime and ProductionGenerationSubmission. Keep `detached` owned by Nomi, not the provider.
4. Add `model3d` to generation outputs and ProductionArtifact; materialize only validated GLB in this round.
5. Route audio by lifecycle/operation shape: synchronous binary/JSON/multipart stays in the audio executor, async mappings enter create/poll/materialize.
6. Repair APIMart radar index delegation with cycle and empty-index protection.

### Round 2: Flagship Providers And Aggregator Models

1. Add MiniMax official text preset and catalog vendor. Implement M3, H3, and Speech 2.8 using official field names and limits.
2. Add ElevenLabs vendor, model archetypes, binary response descriptors, and declaration-driven multipart transcription.
3. Add Meshy official image-to-3D with a single create/poll/validated-GLB contract; do not add its two-stage text-to-3D workflow.
4. Keep the existing Replicate element-decomposition route unchanged; broader Replicate and fal catalogs remain a separate certification round.
5. Add KIE Gemini Omni 1.1 as its own multimodal video contract; do not alias it to APIMart Preview.
6. Add KIE and APIMart Suno V5.5 music/SFX plus APIMart Lyria 3.5 through async audio query/result mappings.
7. Update generated archetype/catalog artifacts through repository generators, not manual drift.

### Round 3: Local Runtime Discovery

1. Add a shared external-runtime descriptor with origin, auth scope, health, version, advertised capabilities, evidence source, and certification state.
2. Implement LocalAI external probes for `/.well-known/localai.json`, `/readyz`, `/v1/models/capabilities`, then `/v1/models` fallback. Older versions may use `/version`; `/system` is an administrator route in authenticated LocalAI 4.9 and is not a normal-user connection criterion.
3. Keep LocalAI text on existing OpenAI-compatible Pi/AI SDK paths.
4. Do not add LocalAI media execution until its exact target-version create/query/result/cancel contracts pass a separate adapter certification.

### Round 4: Existing Surface Compatibility

1. Keep the current settings navigation and provider-first model picker unchanged; new suppliers and models enter through existing Catalog projection.
2. Connect LocalAI probing to the existing OpenAI-compatible onboarding/certification path instead of adding a LocalAI-specific settings experience.
3. Run music, sound, speech, and transcription through the existing audio node and declaration-driven controls; do not introduce a new audio workspace.
4. Extend the existing asset library to `model3d` and reuse the current GLB viewer/download surfaces; keep 3D out of the 2D timeline.
5. Feed normalized reconcile/cancel states into the existing task center without changing its navigation or layout model.

## Migration And Rollback

- Built-in seeding remains insert/reconcile and preserves user-owned labels, enabled state, and unrelated metadata.
- New vendors do not alter existing APIMart, KIE, Replicate, RunningHub, or Volcengine credentials.
- Retire nothing unless the replacement is contract-compatible and old seeded ids have an exact migration list.
- Rollback is the scoped PR revert. New catalog rows can disappear without deleting credentials or generated user assets.
- Runtime state additions must parse old envelopes/jobs conservatively; missing normalized state becomes `unknown`, never success.

## Verification

- Red/green contract tests for status, reconcile, cancel, async audio, delegated radar indexes, and GLB validation.
- Loopback integration fixtures for every new HTTP request and response shape.
- Provider seed/archetype tests proving exact ids, fields, limits, and idempotent reconciliation.
- Real credential-backed certification only when a credential exists; otherwise report configured but unverified.
- Electron journeys: add/select each provider, select each new modality, submit only behind the spend confirmation path, materialize into the canvas/assets, restart and reconcile.
- Final gate: `pnpm run test:system:full`, plus packaging/desktop checks required by the repository.

## Non-Goals

- Managed LocalAI sidecar, downloads, process supervision, hardware scheduling, or bundled model weights.
- AI SDK Harness migration or replacement of Pi.
- A second task ledger, asset store, or provider-specific model center.
- A redesign of model settings, provider selection, canvas node pages, or task-center interaction.
- Rewriting mature direct ComfyUI support.
- fal/Replicate broad media catalogs, Meshy two-stage text-to-3D, texture bundles, and alternative 3D formats in ProductionRun.

## Source Of Truth

The dated evidence and exact protocol comparison live in `docs/research/2026-08-30-flagship-provider-model-decision.md`. Current implementation facts remain owned by `docs/ARCHITECTURE-NOW.md` and must be updated in the same PR when the runtime changes.
