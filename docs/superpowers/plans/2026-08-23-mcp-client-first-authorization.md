# MCP 客户端优先授权实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. This plan is a UX/security slice under the existing 2026-08-22 canonical plans; it does not create a second Runtime, Run, Asset, or approval owner.

**Goal:** 把外部 AI 软件调用 Nomi 的可见授权动作收敛为一次：已登记且可验证的 MCP 客户端在本软件内确认；不具备可验证确认能力时，Nomi GUI 用同一 challenge 兜底，且两条路径都不会二次确认。

**User value:** 用户不需要理解 handle、lease、receipt、hash，也不需要在两个窗口重复点击；连接后可以直接读当前项目、提出计划，第一次真正生成时只确认一次项目、模型和成本，之后同一任务的查看/恢复不再打断。

**Canonical references:**

- Design: `docs/superpowers/specs/2026-08-23-mcp-client-first-authorization-design.md`
- Chinese route: `docs/superpowers/plans/2026-08-22-nomi-unified-editor-runtime.md`
- Vertical slice: `docs/superpowers/plans/2026-08-22-mcp-ai-generation-vertical-slice.md`
- Focused audit: `docs/audit/2026-08-23-mcp-client-authorization-friction-audit.md`

## Scope

Included:

- client-first attested confirmation when MCP elicitation is available;
- silent read-only session lease for the connected current project;
- one combined generation challenge that upgrades scope and issues the receipt;
- one shared challenge across client elicitation and Nomi GUI fallback;
- session lease reuse and explicit re-confirmation boundaries;
- user-oriented `nextAction` projections and zero-credit journey tests.

Deferred:

- provider/model adapter and real spend;
- permanent trust, blanket project access, or raw boolean authorization;
- automatic Timeline/Canvas mutation;
- client-specific UI code or per-client parallel authorization implementations.

## Execution order

### Task 1: Normalize the authorization state machine

**Modify:** `electron/capabilityCore/projectLease.ts`, `electron/capabilityCore/projectLeaseStore.ts`, `electron/capabilityCore/approvalReceipt.ts`, `electron/capabilityCore/dispatcher.ts`, `electron/capabilityCore/mcpProtocol.ts`.

- Add a server-owned bootstrap path for an already registered client to resolve the current project identity; reject body `projectId`, path and guessed handle.
- Allow a read-only `ProjectLeaseV1` to be issued from the verified connection/current-project resolver without a second project authorization prompt.
- Add a combined generation challenge projection containing project name, shot summary, resolved model, reference count, cost scope and expiry.
- On one verified accept, atomically upgrade the lease scope and mint/consume one `HumanApprovalReceiptV1`; keep the existing signed-handle path for GUI/pre-bootstrapped clients.
- Keep raw `confirm`, `approved`, `spendConfirmed` and `planConfirmed` outside the new semantic authority boundary.

**Tests first:** bootstrap never trusts body project identity; read-only open has no provider/spend side effect; one accept yields one lease upgrade and one receipt; replay returns the original result; stale project/price/scope fails closed.

### Task 2: Make both confirmation surfaces one challenge

**Modify:** `electron/capabilityCore/mcpProtocol.ts`, `electron/capabilityCore/rpcServer.ts`, `electron/capabilityCore/mcpStdioServer.ts`, `electron/capabilityCore/host.ts`, renderer/preload bridge seam selected by the existing capability handler.

- If the connection is registered and attested, send the challenge through MCP `elicitation/create`; the main process verifies the signed response and continues without opening Nomi.
- If the client only declares elicitation but cannot prove the registered channel, return `human_approval_required` with a project-scoped handoff; the GUI answers the same challenge and the original request resumes.
- Ensure GUI fallback does not trigger a second client prompt and does not create a second challenge/nonce.
- Preserve structured `code`, `phase`, `capability` and `nextAction` for machines; render a single human action phrase.

**Tests first:** client path one click/no GUI; GUI path one click/no client re-prompt; decline/cancel/timeout no receipt; disconnect before accept re-shows the same unexpired challenge; all transport surfaces preserve next action.

### Task 3: Reuse lease for the boring steps

**Modify:** `electron/capabilityCore/dispatcher.ts`, `electron/capabilityCore/mcpToolExposure.ts`, `electron/productionRun/productionRunService.ts`, `electron/productionRun/productionRunIntentLog.ts`.

- Reuse the session lease for context/read, plan preview, progress, cancel and reconcile.
- Define the only re-confirm boundaries: project/immutable generation change, lease expiry/revocation, scope expansion, provider/account/model/price/cost change, or new sealed contract.
- Keep `submission_unknown` reconcile-only; do not present “retry generation” as an automatic next action.
- Record confirmation source and reuse reason in the Run audit projection without leaking secrets or adding a second state owner.

**Tests first:** reconnect/duplicate/read/poll/cancel/reconcile do not increase confirmation count; each listed boundary increases it exactly once; accepted provider with lost task ID never submits again.

### Task 4: Remove duplicate user-facing language

**Modify:** existing i18n keys used by `ConnectAssistantCard`, MCP outcome renderers and the Nomi handoff surface; no new parallel settings page.

- Keep the connection card for “接入 / 状态 / 撤销”；不要在卡片里加入每次生成的授权按钮。
- Use one plain-language label for the operation: “允许 Nomi 在当前项目使用模型 X，最多花费 Y，生成这一镜吗？”
- Map machine next actions to four user actions only: `在客户端确认`、`在 Nomi 确认`、`重新选择项目`、`等待对账`。
- Do not expose lease/receipt/hash/nonce/providerTaskId in the main path.

**Tests first:** i18n key parity, no raw protocol terms in the user projection, old legacy route wording remains compatible until its migration gate.

### Task 5: Zero-credit real-user journey gate

**Add/modify:** `tests/ux/` journey harness and `docs/audit/2026-08-23-mcp-client-authorization-friction-audit.md` evidence section.

- Run one registered-client journey and one GUI-fallback journey with a fake provider.
- Capture screenshots at connection, one confirmation, waiting/reconnect and `submission_unknown` reconciliation.
- Record visible click count, provider calls, spend calls, receipt count, challenge count and submit count.
- Do not enter real provider/P3 spend until both journeys satisfy the invariants in the design spec.

## Acceptance gates

1. Client-first path: one visible accept, no Nomi second click, exactly one receipt and zero pre-confirm provider calls.
2. GUI fallback: one visible Nomi accept, no client second prompt, same challenge ID/nonce and same receipt semantics.
3. Read/reconnect path: no new prompt for the same lease/contract; project/scope/price/contract changes prompt once.
4. Failure safety: reject/cancel/timeout/foreign/stale/deep-link replay produce no spend/provider/materialization side effect.
5. Recovery safety: `submission_unknown` offers reconcile only; raw boolean/transport proof cannot mint authority.
6. Simplicity: a real user can complete the happy path without reading protocol docs or entering internal IDs.
7. Documentation and code remain single-owner: no second authorization store, client-specific fork, or mandatory GUI step for attested clients.

## Current implementation checkpoint (2026-08-23)

- Tasks 1–4 are implemented on the P0 branch: current-project bootstrap, read-only lease reuse, one shared client/GUI challenge, main-process receipt issuance, simple `nextAction` copy, and duplicate-challenge dedupe.
- Zero-credit evidence is green: focused authorization suites (107 tests), full MCP stdio journey (45 assertions), production GUI/recovery journey (55 assertions), and the two-leg spend confirmation walk (22 assertions). The latter verifies one GUI click for clients without elicitation and one client-side prompt with no second GUI card when elicitation is available.
- A standard MCP `confirm:true` is intentionally not treated as a receipt. Until a client supplies a challenge-bound attestation that the main process can verify, it uses the same GUI fallback. This preserves the one-click UX without creating a forged approval path.
- The next stop is therefore not another settings or confirmation screen: it is the product/architecture decision about a real client attestation extension (if client-side confirmation is required for named clients) and, separately, the real provider/P3 submission adapter.

## Rollback

The change is behind the existing generation feature flag and only changes the semantic P0/P3 path. If a client registry or bootstrap resolver is unavailable, return the existing typed `human_approval_required`/`not_ready` response and keep legacy routes unchanged. Do not silently fall back to raw booleans or the legacy provider driver.
