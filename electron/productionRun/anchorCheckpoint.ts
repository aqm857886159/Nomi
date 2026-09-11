import type { ProductionGate } from "./productionRunTypes";

/**
 * P4 S4 — the anchor 亮相检查点 (plan §3.2). A FREE quality gate (not a spend gate) that pauses the
 * batch after the identity/scene anchors have generated, so the user can approve the look before any
 * video shot is paid for. The fact lives in the Run's gate list (never the renderer store), so a crash
 * or a disconnected MCP client cannot lose it; the derivation reads gate.status to release or block shots.
 *
 * The gate carries the anchor jobIds for reference (so the confirmation surface can show the anchor
 * images) but authorizes NO budget — the repository's budget-authorization branch is scoped to
 * `budget_envelope`, so an `anchor_checkpoint` decide never re-authorizes the ledger.
 *
 * ── 冻结/锚的两条轨（P4 S7 收敛注记，docs/plan/2026-08-25-p4-s7-legacy-converge.md §3.2）──
 * 「形象定了没」在本仓有两条轨，判据同源（都读 anchorBible）、语义不同层：
 *   ① 语义 `anchor_checkpoint` gate（本模块）：Run/Job 概念——锚 **job 出图后** 开 gate，用户过目
 *      全部锚（新生成+复用）→ 决议放行镜头。事实在 Run gate 列表，崩溃/断客户端不丢。语义调度器用它。
 *   ② legacy `meta.frozen` 轨（画布节点概念）：用户在锚卡点「定妆」写 node.meta.frozen；
 *      GUI dependencyWaves（`isUnfrozenVisualAnchor`）与 brand.promo driveGeneration（`readUnfrozenAnchors`
 *      经 production.check-frozen 桥）读它。判据走 anchorBible / anchorBibleKeys 镜像（equivalence 钉死）。
 * 两轨判据在 main 上已贯通（同一 anchorBible）。**S7b 收编 brand.promo driveGeneration 时，②并入①**
 * （headless 冻结门 → 语义检查点）。在此之前别把冻结判据抄第三遍（check:batch-machines 规则 4 钉死）。
 */

const GATE_PREFIX = "gate-anchor-checkpoint-";

/** The stable, per-run checkpoint gate id. One checkpoint per batch (anchors approved as a set). */
export function anchorCheckpointGateId(runId: string): string {
  return `${GATE_PREFIX}${runId}`;
}

/** Widened to plain strings so projection gates (sanitized JSON) can be tested too, not only durable gates. */
export function isAnchorCheckpointGate(gate: { gateId: string; scope: string }): boolean {
  return gate.scope === "anchor_checkpoint" && gate.gateId.startsWith(GATE_PREFIX);
}

export type BuildAnchorCheckpointGateInput = {
  runId: string;
  planHash: string;
  anchorJobIds: string[];
  now: string;
  /** How long the checkpoint stays open before it expires (default 24h — a decision, not a spend). */
  ttlMs?: number;
};

/**
 * Build the anchor checkpoint gate. Waiting until the user approves the anchor look — there is no
 * timeout that decides it for him. The title/summary are the AGENT-FACING gate labels (English, like
 * the sibling direction/contract gates — the renderer owns the user-facing card copy via i18n); they pass
 * the projection sanitizer and carry no internal terms (anchor/seal/materialize) to any surface.
 */
export function buildAnchorCheckpointGate(input: BuildAnchorCheckpointGateInput): ProductionGate {
  const ttlMs = input.ttlMs ?? 24 * 60 * 60 * 1000;
  return {
    gateId: anchorCheckpointGateId(input.runId),
    scope: "anchor_checkpoint",
    status: "waiting",
    planHash: input.planHash,
    jobIds: [...input.anchorJobIds],
    title: "Review the character look before shooting",
    summary: "Nomi generated the lead character and scene references first. Approve the look, then it generates each shot; if a reference is off, regenerate only the reference — the shots are untouched.",
    createdAt: input.now,
    expiresAt: new Date(Date.parse(input.now) + ttlMs).toISOString(),
  };
}
