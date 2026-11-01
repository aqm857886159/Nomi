import { queuedHandOversOfClosedPresentations } from "../shared/productionGenerationPresentation";
import type { ProductionRun } from "../productionRun/productionRunTypes";
import type { CanvasConsentShot, CanvasShotRuns, CanvasShotSubmitInput } from "./appIntegrationCanvasShot";

let active: CanvasShotRuns | null = null;

/** 能力核起停时装上 / 卸下（stop 传 null）。 */
export function installCanvasShotRuns(runs: CanvasShotRuns | null): void {
  active = runs;
}

function activeRuns(): CanvasShotRuns {
  if (!active)
    throw Object.assign(new Error("capability core is starting"), { code: "core_starting", reason: "core_starting" });
  return active;
}

/** 渲染层批量卡点了确认（受信 IPC 进来）。 */
export function consentCanvasShots(input: {
  projectId: string;
  shots: readonly CanvasConsentShot[];
  senderId: number;
}): { runIds: string[] } {
  return activeRuns().consent(input);
}

/** 渲染层「交」（受信 IPC 进来，发起的窗口就是这一下点击）。 */
export function submitCanvasShot(input: CanvasShotSubmitInput): Promise<Awaited<ReturnType<CanvasShotRuns["submit"]>>> {
  return activeRuns().submit(input);
}

/** 渲染层「查」；没有这个 Run 回 null（旧运行记录走旧路）。 */
export function pollCanvasShot(input: {
  projectId: string;
  runRecordId: string;
  senderId: number;
}): ReturnType<CanvasShotRuns["poll"]> {
  return activeRuns().poll(input);
}

export function releaseCanvasShot(input: { projectId: string; runRecordId: string }): void {
  active?.release(input);
}

/** 排队的那几镜被去掉 / 整批 ×：收回还没交的同意。 */
export function withdrawCanvasShots(input: {
  projectId: string;
  runRecordIds: readonly string[];
  by: "removed" | "user_closed" | "stopped";
}): void {
  active?.withdraw(input);
}

/** Agent 那一次出价关掉之后，交给画布且还没轮到的那几镜当场收回同意。 */
export function withdrawQueuedHandOversImpl(run: ProductionRun): void {
  if (run.origin.host === "canvas") return;
  const queued = queuedHandOversOfClosedPresentations(run.generationPlan);
  if (queued.length === 0 || !active) return;
  for (const by of ["user_closed", "user_wrote", "stopped"] as const) {
    const canvasRunIds = queued
      .filter((entry) => (entry.by === "user_wrote" || entry.by === "stopped" ? entry.by : "user_closed") === by)
      .map((entry) => entry.canvasRunId);
    if (canvasRunIds.length > 0) active.withdrawRuns({ projectId: run.projectId, canvasRunIds, by });
  }
}

export function releaseCanvasShotSender(senderId: number): void {
  active?.releaseSender(senderId);
}

export function canvasUnknownRuns(input: { projectId: string; nodeId: string }): ReturnType<CanvasShotRuns["unknownRuns"]> {
  return activeRuns().unknownRuns(input);
}
