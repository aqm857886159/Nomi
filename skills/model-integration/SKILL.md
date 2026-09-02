---
name: model-integration
description: Connect HTTP models or a native ComfyUI workflow through Nomi's verified certification path.
---

# Nomi model integration

Use Nomi's integration tools to turn a vendor endpoint or a native ComfyUI workflow into a capability that remains usable after restart. The tools are the contract; do not edit Nomi source, Catalog files, or MCP configuration by hand.

## Order

1. **Official contract first.** Start with `nomi_integration` (`action: "begin"`) using only public material, and capture the official docs/OpenAPI URL for every `(vendor, model, mode)`. Every later transition is the same `nomi_integration` tool with its `action` enum (`open_credentials` / `discover` / `select` / `confirm` / `submit_workflow` / `resolve_input` / `start` / `cancel`) plus the session's `expectedRevision`. Never infer a field from a model name or a neighboring provider.
2. **Use the existing identity graph.** Reuse the matching `modelArchetype`, `Catalog Mapping`, `HttpOperation`, `integrationCertification`, `GenerationRuntime`, `ProductionRun`, and managed assets. One logical model is one catalog row; use the mapping's generic `modeId` discriminator for same-kind modes instead of vendor-specific exceptions or duplicate rows.
3. **Write the ledger before implementation.** Add a machine-checkable certification-ledger row with exact model/mode/mapping IDs, archetype path, official evidence, and one of `documented | simulated | live-certified | blocked`. A row without a precise blocker is invalid when status is `blocked`.
4. **Build a canary matrix before network.** For each exact `(vendor, model, mode)` record the official endpoint, required fields, smallest valid parameters, expected output type, upper-bound cost, idempotency key, and one-attempt limit. A model without a complete row stays `documented` or `blocked`; do not infer a cheaper/default field from a neighboring model.
5. **Static gate before network.** Run `pnpm run check:model-certification-coverage`, `pnpm run check:archetype-sources`, and the root-cause contract checker. The static gate must prove source URLs, mapping identity, generated archetype artifacts, and that no secret entered the ledger.
6. **Generic mode discrimination is mandatory.** If one logical model exposes multiple same-task modes, each mapping must carry a generic `modeId` and the request must include it whenever selection is ambiguous. An omitted discriminator must fail closed; never add a provider-specific branch or duplicate model row to hide ambiguity.
7. **Zero-cost loopback and failure matrix.** Exercise create → status/query → result against a local protocol simulator. Cover at least 401, 402/balance, 429, 5xx, timeout, malformed/truncated JSON, unknown status, missing request id, succeeded-without-output, oversized body, and media MIME/magic mismatch. A queued response without a provider request id must fail closed and never be resubmitted.
8. **Provider-owned assets.** Prefer the provider's signed/ephemeral upload API for local references (for example Runway `POST /v1/uploads` → signed multipart → `runway://` URI). Small images may use an official data URI. Anonymous public image hosts are not a debugging strategy and must never be silently retried when the provider has its own upload path.
9. **PR #221 MCP cost gate.** Run the MCP zero-cost journey through spend confirmation and verify `provider request count = 0` before any live canary. Confirmation is immutable and user-owned; an agent cannot invent a receipt or confirm spend.
10. **Live is last and must use the production path.** Only with the user's provider key/credits and explicit canary scope, run one minimal request through Nomi's `GenerationRuntime`/`ProductionRun`, validate the bounded artifact, commit the managed-asset journal, and perform a fresh-process readback. A direct curl/SDK call, provider-only output URL, or loopback pass is not live certification. If managed localization, auth, credits, callback deployment, or network policy blocks the run, keep `status=blocked` with the exact evidence; never retry blindly.
11. Poll `nomi_read` (`target: "integration"`) and report the real result. A secure key, successful discovery, staged draft, or partial batch is not completion. Only modes with `live-certified` evidence are usable in a verified-live claim; `simulated` and `blocked` must remain visibly distinct.

## Evidence and failures

- Prefer official vendor documentation and evidence returned by Nomi. Do not guess endpoint paths, auth names, parameter types, or capability kinds.
- Treat `partial` as partial. Report each unavailable model or mode with its stable reason and exactly one next action.
- Do not silently truncate candidates. Continue pagination or tell the user why a page cannot be fetched.
- Do not blindly retry auth, balance, quota, security, or unknown-submission failures. An unknown submission may only be reconciled by its remote task id.
- A contract mismatch may be repaired only within Nomi's bounded attempt limit. If repair fails, preserve the previous active revision and start a new draft.

## ComfyUI boundary

This skill covers the native ComfyUI Server routes (`/features`, `/models`, `/workflow_templates`, `/object_info`, `/upload/image`, `/prompt`, `/history`, `/view`, and `/ws`). A platform Cloud or Serverless API that does not implement those routes is an ordinary HTTP provider, not native ComfyUI.

## Safe wording

Say “securely saved, not yet verified” after credential storage. Say “configured, awaiting certification” for a draft. Say “verified and available” only after the final run state says so. Never include credentials, Authorization values, signed URLs, absolute paths, connection fingerprints, or raw provider error pages in a response.

## Certification record template

For each mapping, keep this compact record (the repository ledger is the source of truth):

```json
{
  "vendorKey": "runway",
  "modelKey": "seedance2_5",
  "archetypeId": "seedance-2.5",
  "modeId": "omni",
  "mappingId": "seed-runway-seedance2-5-omni",
  "official": [{"url": "https://…", "checkedAt": "YYYY-MM-DD"}],
  "evidence": {"static": "passed", "loopback": "passed", "failureMatrix": "passed", "mcpDryRun": "passed"},
  "live": {"status": "blocked", "blocker": "Provider key/credits unavailable"},
  "status": "simulated"
}
```

Evaluation must reject guessed fields, missing mode discriminators, anonymous-upload fallbacks when a provider upload exists, a paid call before confirmation, or a `live-certified` claim without a production receipt and fresh-process readback. See `evals/model-integration/unified-certification.eval.json`.

## Required canary record

Keep one evidence row per mapping in the ledger. The row must make the cost and the stopping rule auditable without exposing a credential:

```json
{
  "mappingId": "seed-runway-gen4-5-t2v",
  "canary": {"attempts": 1, "maxCost": "2s minimum", "providerTaskId": "redacted-in-report-only"},
  "live": {"status": "blocked", "blocker": "Exact external reason"}
}
```

Never promote a whole model from a neighboring mode's receipt. Each mode is independently `documented`, `simulated`, `live-certified`, or `blocked`.
