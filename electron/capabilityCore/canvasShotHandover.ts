import crypto from "node:crypto";

import { logWarn } from "../logging/logger";
import type { MainProcessDecision } from "./approvalReceipt";
import { ContractCompilationError } from "./executionContract";
import {
  currentPresentation,
  handOverOfCanvasRun,
  IN_APP_AGENT_POLICY_SURFACE,
  latestHandOver,
} from "../shared/productionGenerationPresentation";
import type { CanvasShotGesture } from "./appIntegrationCanvasShot";
import type {
  GenerationHandOverFailure,
  GenerationHandOverSettlement,
  ProductionJob,
  ProductionRun,
  RunCommand,
} from "../productionRun/productionRunTypes";
import { currentShotAttempt, jobEndedAfterProviderAnswer, jobEndedBeforeAcceptance } from "../shared/productionShotJobs";
import { canvasShotClaimCommandId } from "../shared/productionRunCommandId";
import { decideShotClaim } from "../shared/decideShotClaim";
import type { CanvasConsentShot } from "./appIntegrationCanvasShot";

export type CanvasHandOverLink = { runId: string; shotId: string };

export type ConsentEnd =
  | Readonly<{ outcome: "withdrawn"; by: "removed" | "user_closed" | "user_wrote" | "stopped" }>
  | Readonly<{ outcome: "not_sent"; failure?: GenerationHandOverFailure }>;

const NOMI_CODE = /^[a-z][a-z0-9_]{2,63}$/;

const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

function coded(message: string, code: string, reason: string): Error {
  return Object.assign(new Error(message), { code, reason });
}

/** 这个画布单镜 Run 是替哪个制作 Run 的哪一镜交的（建同意时记在来历里）。 */
export function handOverLinkOf(run: ProductionRun | null | undefined): CanvasHandOverLink | undefined {
  const link = run?.origin.handOverOf;
  return link && text(link.runId) && text(link.shotId)
    ? { runId: text(link.runId), shotId: text(link.shotId) }
    : undefined;
}

/** 节点绑着的制作镜头（Agent 起草落到画布上的那一镜）：请求里带着它。 */
export function boundShotOf(extras: Record<string, unknown> | undefined): CanvasHandOverLink | undefined {
  const runId = text(extras?.productionRunId);
  const shotId = text(extras?.productionShotId);
  return runId && shotId ? { runId, shotId } : undefined;
}

/**
 * 交出去的那一镜为什么没发出去（Nomi 自己的语义码，不是供应商原话）：参数 / 提示词 / 参考被拒的去节点里改（供应商当场明确拒绝、
 * 合同编译口拒了某个参数、3D-BOX 预演没就绪），别的可以再试一次。
 */
export function handOverFailureOf(error: unknown, job?: ProductionJob): GenerationHandOverFailure {
  if (job?.errorCode === "provider_rejected") return { kind: "parameter_rejected", code: "provider_rejected" };
  if (error instanceof ContractCompilationError && error.rejection) {
    return {
      kind: "parameter_rejected",
      code: NOMI_CODE.test(error.rejection.code) ? error.rejection.code : "parameter_rejected",
    };
  }
  const raw =
    error && typeof error === "object" && typeof (error as { code?: unknown }).code === "string"
      ? (error as { code: string }).code
      : job?.errorCode;
  const reason = error && typeof error === "object" ? (error as { reason?: unknown }).reason : undefined;
  if (raw === "production_shot_claimed" && reason === "needs_reconcile")
    return { kind: "not_sent", code: "node_needs_reconcile" };
  if (raw === "production_shot_claimed" && reason === "in_flight")
    return { kind: "not_sent", code: "node_generation_in_flight" };
  const code = raw && NOMI_CODE.test(raw) ? raw : "not_sent";
  return { kind: code === "director_preview_blocked" ? "parameter_rejected" : "not_sent", code };
}

type ExecuteOn = (
  projectId: string,
  runId: string,
  build: (current: ProductionRun) => Omit<RunCommand, "expectedRevision"> | null,
) => void;

export function claimBoundProductionShot(input: {
  projectId: string;
  bound: CanvasHandOverLink | undefined;
  canvasRunId: string;
  executeOn: ExecuteOn;
  now: () => string;
}): void {
  const { projectId, bound, canvasRunId, executeOn, now } = input;
  if (!projectId || !bound) return;
  executeOn(projectId, bound.runId, (current) => {
    const decision = decideShotClaim(current, bound.shotId, "canvas", { canvasRunId });
    if (!decision.granted)
      throw coded(`production_shot_claimed: ${decision.reason}`, "production_shot_claimed", decision.reason);
    if (decision.holder !== "canvas" || decision.reason === "canvas_claimed") return null;
    return {
      commandId: canvasShotClaimCommandId(
        bound.runId,
        bound.shotId,
        currentShotAttempt(current, bound.shotId),
        canvasRunId,
      ),
      type: "shot.claim",
      payload: { shotId: bound.shotId, by: "canvas", canvasRunId },
      issuedAt: now(),
    };
  });
}

export function recordHandOverBindings(input: {
  projectId: string;
  shots: readonly CanvasConsentShot[];
  runIds: readonly string[];
  executeOn: ExecuteOn;
  now: () => string;
}): void {
  const { projectId, shots, runIds, executeOn, now } = input;
  const byRun = new Map<string, Array<{ shotId: string; canvasRunId: string; nodeId: string }>>();
  shots.forEach((shot, index) => {
    if (!shot.production) return;
    const productionRunId = text(shot.production.runId);
    byRun.set(productionRunId, [
      ...(byRun.get(productionRunId) ?? []),
      { shotId: text(shot.production.shotId), canvasRunId: runIds[index], nodeId: shot.nodeId },
    ]);
  });
  for (const [productionRunId, bindings] of byRun) {
    let found = false;
    executeOn(projectId, productionRunId, () => {
      found = true;
      return {
        commandId: `canvas-handover-bind:${crypto.createHash("sha256").update(JSON.stringify(bindings)).digest("hex").slice(0, 32)}`,
        type: "generation.handover.bind",
        payload: { bindings },
        issuedAt: now(),
      };
    });
    if (!found)
      throw coded(`canvas_handover_missing: ${productionRunId}`, "canvas_handover_missing", "handover_missing");
  }
}

export function writeBackHandOver(input: {
  projectId: string;
  link: CanvasHandOverLink | undefined;
  canvasRunId: string;
  settlement: Omit<GenerationHandOverSettlement, "at">;
  executeOn: ExecuteOn;
  now: () => string;
}): void {
  const { projectId, link, canvasRunId, settlement, executeOn, now } = input;
  if (!link) return;
  try {
    executeOn(projectId, link.runId, (current) => {
      const handOver = handOverOfCanvasRun(current.generationPlan, canvasRunId)?.handOver;
      if (!handOver || handOver.shotId !== link.shotId || handOver.settled) return null;
      return {
        commandId: `canvas-handover-settle:${canvasRunId}`,
        type: "generation.handover.settle",
        payload: { shotId: link.shotId, canvasRunId, ...settlement },
        issuedAt: now(),
      };
    });
  } catch (error) {
    logWarn("production-run", "canvas-handover-settle-failed", { runId: canvasRunId }, error);
  }
}

export function settleFromRun(input: {
  projectId: string;
  link: CanvasHandOverLink | undefined;
  canvasRunId: string;
  error: unknown;
  readRun: (projectId: string, runId: string) => ProductionRun | null;
  writeBack: (input: {
    projectId: string;
    link: CanvasHandOverLink | undefined;
    canvasRunId: string;
    settlement: Omit<GenerationHandOverSettlement, "at">;
    now: () => string;
  }) => void;
  now: () => string;
}): void {
  const { projectId, link, canvasRunId, error, readRun, writeBack, now } = input;
  if (!link) return;
  const run = readRun(projectId, canvasRunId);
  const job = run ? [...run.jobs].sort((left, right) => right.attempt - left.attempt)[0] : undefined;
  writeBack({
    projectId,
    link,
    canvasRunId,
    // 确定结束在受理之前 = 没交到；确定结束在供应商答复之后（答了、本机没落下）= 交到了；其余拿不出证据 = 结果未知。
    settlement:
      !job || jobEndedBeforeAcceptance(job)
        ? { outcome: "not_sent", failure: handOverFailureOf(error, job) }
        : jobEndedAfterProviderAnswer(job)
          ? { outcome: "accepted" }
          : { outcome: "unknown" },
    now,
  });
}

export function decisionFor(input: {
  projectId: string;
  link: CanvasHandOverLink | undefined;
  canvasRunId: string;
  gesture: CanvasShotGesture;
  readRun: (projectId: string, runId: string) => ProductionRun | null;
}): MainProcessDecision {
  const { projectId, link, canvasRunId, gesture, readRun } = input;
  if (!link) return { kind: "gesture", ...gesture };
  const presentation = currentPresentation(readRun(projectId, link.runId)?.generationPlan);
  const handOver = latestHandOver(presentation, link.shotId);
  if (!presentation || !handOver || handOver.canvasRunId !== canvasRunId || handOver.settled) {
    throw coded(`canvas_handover_missing: ${canvasRunId}`, "canvas_handover_missing", "handover_missing");
  }
  if (handOver.by === "gesture") return { kind: "gesture", ...gesture };
  if (presentation.policySnapshot?.mode !== "direct") {
    throw coded(`generation_policy_not_direct: ${canvasRunId}`, "generation_policy_not_direct", "policy_not_direct");
  }
  return { kind: "policy", policyMode: "project", policySurface: IN_APP_AGENT_POLICY_SURFACE };
}
