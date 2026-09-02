# Runway Seedance 2.5 onboarding and storyboard settings

日期：2026-08-30 · 状态：📋 方案待拍板（源分支 `codex/runway-seedance25-onboarding` 实测**只含文档、
无任何代码改动**且未合并；2026-09-02 打捞入库，未开工、未评审）

## Why

Issue #237 exposed two separate problems: Nomi has no native Runway Dev transport, and a local reference image can fall through to anonymous public upload hosts. The latter is brittle and makes a provider integration look broken before the provider ever receives the request.

## Scope

- Add a curated Runway Dev vendor seed and Seedance 2.5 text-to-video/image-to-video mappings.
- Use Runway's documented `promptImage` transport with Nomi's provider-private inline data URI path for image references. This removes the anonymous-upload dependency for the first-frame/storyboard path.
- Add contract tests for URL construction, request shape, and Runway task response/status normalization.
- Publish an English configuration and usage guide, including the current one-image Runway limit in Nomi and redacted troubleshooting steps.
- Document the storyboard settings feature as the next iteration surface; this release does not promise a complete automatic storyboard generator.

## Not in scope

- No anonymous-host removal for unrelated providers. Anonymous upload remains an explicit last-resort fallback for providers that have no private transport.
- No Runway API key collection, issue reply, email, or social-media posting from this change.
- No claim that Runway's single `promptImage` field replaces the existing multi-reference Seedance modes. Those remain available through KIE/APIMart until a Runway-specific multi-reference contract is verified.

## Acceptance gates

1. Runway vendor and model are idempotently seeded without overwriting user-owned fields.
2. Text-to-video renders `model`, `prompt`, `ratio`, and `duration`; image-to-video additionally renders one `promptImage`.
3. A local image for Runway resolves to a `data:` URI and never selects `anon-chain`.
4. Create and query responses normalize to the existing task lifecycle (`queued`/`running`/`succeeded`/`failed`) and extract `output[0]`.
5. English docs state setup, supported modes, reference limits, and the storyboard-settings feedback loop honestly.
6. Existing catalog, asset-localization, typecheck, test, build, and gate checks stay green.

## Rollback

Revert the curated Runway seed, mapping, asset-ingestion declaration, tests, and docs as one commit. Existing user-configured vendors and anonymous fallback behavior are untouched.
