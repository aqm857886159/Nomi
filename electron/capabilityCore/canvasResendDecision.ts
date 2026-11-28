// 「失败后再发一次」的决定号：主进程按卡打开那一刻没收尾的那几笔铸一个号，号里绑死具体是哪几笔。
//
// 以前渲染层在人点了确认之后再读一遍没收尾的，把读到的全部报回来当许可（acknowledgedOpenRuns）——
// 卡开着时同一节点新冒出的一笔也被这一次确认一起放行了。现在许可只有主进程发的号：
// 放行旧单（`covers`）只认号里列出的那几笔；提交（`take`）只放行号里那几笔仍在路上的，多出来的一笔照旧拒。
// 号只在主进程内存里：过期、用过、发起的窗口没了都作废；渲染层拿不到号以外的任何许可。
import crypto from "node:crypto";

import type { ProductionRun } from "../productionRun/productionRunTypes";
import type { CanvasOpenRunEntry, CanvasResendDecidePayload, CanvasResendDecision } from "../shared/canvas/canvasResendDecide";
import { deriveProductionShotState, productionJobOpenAs, productionShotIdForNode } from "../shared/productionShotPhase";

export type CanvasResendDecideInput = CanvasResendDecidePayload & { senderId: number };
export type { CanvasOpenRunEntry };

type ResendDecisionScope = { projectId: string; nodeId?: string; senderId: number };

type ResendDecision = ResendDecisionScope & {
  decisionId: string;
  /** 卡打开那一刻这个节点还在路上的画布 Run → 它最新那一笔作业号（换了一笔就不算同一件事）。 */
  inFlight: ReadonlyMap<string, string | undefined>;
  /** 结果未知、人确认后可以放行的那几笔（画布 Run 或制作 Run 里的那一笔）。 */
  release: ReadonlyArray<{ runId: string; jobId: string }>;
  /** Only a user-requested resend may authorize another completed derived order. */
  completedRunId?: string;
  expiresAt: number;
  usedBy?: string;
};

const DECISION_TTL_MS = 30 * 60 * 1000;

export function createResendDecisions(now: () => number = Date.now) {
  const decisions = new Map<string, ResendDecision>();

  function live(decisionId: string | undefined, scope: Pick<ResendDecisionScope, "projectId" | "senderId">): ResendDecision | undefined {
    const decision = decisionId ? decisions.get(decisionId) : undefined;
    if (!decision) return undefined;
    if (decision.expiresAt <= now()) { decisions.delete(decision.decisionId); return undefined; }
    if (decision.projectId !== scope.projectId || decision.senderId !== scope.senderId) return undefined;
    return decision;
  }

  return {
    mint(scope: ResendDecisionScope, open: { inFlight: ReadonlyMap<string, string | undefined>; release: ReadonlyArray<{ runId: string; jobId: string }>; completedRunId?: string }): ResendDecision {
      for (const [id, decision] of decisions) if (decision.expiresAt <= now()) decisions.delete(id);
      const decision: ResendDecision = { ...scope, decisionId: crypto.randomUUID(), inFlight: new Map(open.inFlight), release: [...open.release], completedRunId: open.completedRunId, expiresAt: now() + DECISION_TTL_MS };
      decisions.set(decision.decisionId, decision);
      return decision;
    },
    /** 放行这一笔结果未知的作业：只有号里列出的才算问过人。 */
    covers(decisionId: string | undefined, target: Pick<ResendDecisionScope, "projectId" | "senderId"> & { runId: string; jobId: string }): boolean {
      const decision = live(decisionId, target);
      return Boolean(decision && !decision.usedBy && decision.release.some(entry => entry.runId === target.runId && entry.jobId === target.jobId));
    },
    /** 提交第一次带着号来就把号用掉（同一个运行记录号的重放仍认它）；节点对不上的号不算数、也不用掉。 */
    take(decisionId: string | undefined, target: ResendDecisionScope & { nodeId: string; runRecordId: string }, completedRunId?: string): ResendDecision | undefined {
      const decision = live(decisionId, target);
      if (!decision || decision.nodeId !== target.nodeId || (completedRunId && decision.completedRunId !== completedRunId)) return undefined;
      if (decision.usedBy && decision.usedBy !== target.runRecordId) return undefined;
      decision.usedBy = target.runRecordId;
      return decision;
    },
    dropSender(senderId: number): void {
      for (const [id, decision] of decisions) if (decision.senderId === senderId) decisions.delete(id);
    },
  };
}

type ResendDecisions = ReturnType<typeof createResendDecisions>;

/**
 * 画布单镜主人（`appIntegrationCanvasShot.ts` 的 `createCanvasShotRuns`）的重发判定与提交准入，只此一处。
 * `openRuns` 是准入同一份占用读法；`repository` 读制作 Run（结果未知的那一笔在哪个作业）。
 */
export function createCanvasShotResend(
  openRuns: (input: { projectId: string; nodeId?: string }) => CanvasOpenRunEntry[],
  repository: () => { read(projectId: string, runId: string): ProductionRun | null },
) {
  const decisions = createResendDecisions();

  // The submit refusal opens the existing renderer confirmation flow. Bind that card to
  // the completed order that prompted it, even if another derived order finishes meanwhile.
  const completedPrompts = new Map<string, { runId: string; senderId: number }>();
  const promptKey = (scope: ResendDecisionScope) => JSON.stringify([scope.senderId, scope.projectId, scope.nodeId]);
  /** 制作 Run 里那一笔结果未知的作业（按节点找那一镜，或任务中心点名的那一笔）；不是结果未知就没有。 */
  function unknownProductionJob(projectId: string, nodeId: string | undefined, production: CanvasResendDecideInput["production"]): { runId: string; jobId: string } | null {
    const runId = production?.runId?.trim();
    const run = runId ? repository().read(projectId, runId) : null;
    if (!runId || !run) return null;
    const job = production?.jobId
      ? run.jobs.find(candidate => candidate.jobId === production.jobId)
      : nodeId ? deriveProductionShotState(run, productionShotIdForNode(run, nodeId))?.job : undefined;
    return job && productionJobOpenAs(job.status) === "needs_reconcile" ? { runId, jobId: job.jobId } : null;
  }

  return {
    /**
     * 「失败后再发一次要不要问」的**唯一判定**（经主人的 `resend.decideResend` 进来）。人发起、说了要重发或者节点上还有没收尾的 → 问；
     * 号绑死此刻那几笔。不是人发起的遇到没收尾的 → 拒；其余照常发（走普通花钱卡）。
     */
    decideResend(input: CanvasResendDecideInput): CanvasResendDecision {
      const open = input.nodeId ? openRuns({ projectId: input.projectId, nodeId: input.nodeId }) : [];
      if (input.initiator !== "user") return open.length ? { action: "refuse", code: "node_generation_in_flight" } : { action: "send" };
      if (!input.resend && open.length === 0) return { action: "send" };
      const release = open.flatMap(entry => entry.reason === "needs_reconcile" && entry.jobId ? [{ runId: entry.runId, jobId: entry.jobId }] : []);
      const production = unknownProductionJob(input.projectId, input.nodeId, input.production);
      if (production && !release.some(entry => entry.runId === production.runId && entry.jobId === production.jobId)) release.push(production);
      const completedRunId = input.resend ? completedPrompts.get(promptKey(input))?.runId : undefined;
      completedPrompts.delete(promptKey(input));
      const decision = decisions.mint(
        { projectId: input.projectId, ...(input.nodeId ? { nodeId: input.nodeId } : {}), senderId: input.senderId },
        { inFlight: new Map(open.filter(entry => entry.reason === "in_flight").map(entry => [entry.runId, entry.jobId])), release, completedRunId },
      );
      return { action: "ask", decisionId: decision.decisionId, resultUnknown: release.length > 0 || input.resultUnknown === true, release, open };
    },
    /**
     * 提交准入：`open` 是这个节点上别的没收尾的（主人刚读的），回挡住这一次提交的第一笔（没有就放行）。
     * 只有受信窗口里人点的单镜提交（`trusted`）认决定号；批量卡上的同意、交给画布的那一镜永远不放行别人的在途。
     * 号里记的是卡打开那一刻的那一笔：同一个 Run 换了一笔作业不算；那一刻还没有作业号的，认这个 Run。
     */
    firstBlocked(open: CanvasOpenRunEntry[], input: ResendDecisionScope & { nodeId: string; runRecordId: string; resendDecisionId?: string }, trusted: boolean): CanvasOpenRunEntry | undefined {
      const decision = open.length && trusted ? decisions.take(input.resendDecisionId, input) : undefined;
      const covered = (entry: CanvasOpenRunEntry) => {
        if (!decision?.inFlight.has(entry.runId)) return false;
        const decided = decision.inFlight.get(entry.runId);
        return decided === undefined || decided === entry.jobId;
      };
      return open.find(entry => entry.reason === "needs_reconcile" || !covered(entry));
    },
    confirmsCompleted(input: ResendDecisionScope & { nodeId: string; runRecordId: string; resendDecisionId?: string }, previous: ProductionRun): boolean {
      if (decisions.take(input.resendDecisionId, input, previous.runId)) return true;
      completedPrompts.set(promptKey(input), { runId: previous.runId, senderId: input.senderId });
      return false;
    },
    /** 放行结果未知的那一笔之前核对：只有决定号里列出的才放（渲染层多报一笔就拒）。 */
    covers: decisions.covers,
    dropSender(senderId: number) {
      decisions.dropSender(senderId);
      for (const [key, prompt] of completedPrompts) if (prompt.senderId === senderId) completedPrompts.delete(key);
    },
  };
}

/** 放行结果未知那一笔的受信入口（制作 Run 命令通道）问的就是这一处；能力核没起来时一律不放。 */
let active: Pick<ResendDecisions, "covers"> | null = null;
export function installResendDecisions(decisions: Pick<ResendDecisions, "covers"> | null): void {
  active = decisions;
}
export function resendDecisionCovers(...args: Parameters<ResendDecisions["covers"]>): boolean {
  return active?.covers(...args) ?? false;
}
