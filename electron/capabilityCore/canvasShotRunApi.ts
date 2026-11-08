import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { canvasProviderId, isCanvasProviderId } from "./canvasTransportProvider";
import type { createGenerationOutputMaterializer } from "./generationOutputMaterializer";
import type { PlanCandidate } from "./executionContract";
import type { GenerationProviderOutput } from "./generationRuntimeAdapter";
import type { AutomationPolicy, ProductionArtifact } from "../productionRun/productionRunTypes";
import { queuedHandOversOfClosedPresentations } from "../shared/productionGenerationPresentation";
import type { ProductionRun } from "../productionRun/productionRunTypes";
import type { CanvasConsentShot, CanvasShotRuns, CanvasShotSubmitInput, CanvasShotRequest } from "./appIntegrationCanvasShot";

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

/** 仓库每一次耐久变化（appIntegration 的事件旁路）：交给观察者的那一笔收尾了就摇渲染层去收。 */
export function followCanvasShotChange(run: ProductionRun): void {
  active?.followRunChange(run);
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

export function canvasOpenRuns(input: { projectId: string; nodeId?: string }): ReturnType<CanvasShotRuns["canvasOpenRuns"]> {
  return activeRuns().canvasOpenRuns(input);
}

/**
 * 画布那台交回来的产物已经由它自己落进项目（`localizeTaskAsset`，nomi-local://）：这里只把那份文件记进 Run，
 * 不再下载一次。不是本地地址的交给通用物化（与目录执行器同一条）。
 */
export function canvasLocalArtifactReceipt(input: {
  projectId: string;
  projectRoot: string;
  providerTaskId: string;
  output: GenerationProviderOutput;
  /** 这一单的第几份产物（从 0 起）：第一份号不变，第 k 份加 `-k`，同一单的几份各有自己的号。 */
  outputIndex: number;
}): Pick<ProductionArtifact, "artifactId" | "kind" | "contentHash" | "projectRelativePath"> | null {
  const prefix = `nomi-local://asset/${encodeURIComponent(input.projectId)}/`;
  if (!input.output.url.startsWith(prefix)) return null;
  let relative: string;
  try {
    relative = input.output.url.slice(prefix.length).split("/").map(decodeURIComponent).join("/");
  } catch {
    return null;
  }
  const root = path.resolve(input.projectRoot);
  const absolute = path.resolve(root, relative);
  if (
    !relative ||
    !absolute.startsWith(`${root}${path.sep}`) ||
    !fs.existsSync(absolute) ||
    !fs.statSync(absolute).isFile()
  )
    return null;
  relative = path.relative(root, absolute).split(path.sep).join("/");
  const contentHash = crypto.createHash("sha256").update(fs.readFileSync(absolute)).digest("hex");
  return {
    artifactId: input.outputIndex > 0
      ? `${`canvas-artifact-${input.providerTaskId}`.slice(0, 150)}-${input.outputIndex + 1}`
      : `canvas-artifact-${input.providerTaskId}`.slice(0, 160),
    kind: input.output.kind,
    contentHash,
    projectRelativePath: relative,
  };
}

/** 提交出口的「交回的产物怎么记进 Run」：画布那台的本地文件只记账（上面这个），别的交给通用物化。 */
export function canvasAwareOutputMaterializer(projectRoot: string, generic: Pick<ReturnType<typeof createGenerationOutputMaterializer>, "materialize">) {
  return async (input: { projectId: string; providerTaskId: string; output: GenerationProviderOutput; outputIndex: number; job: { provider: string } }) =>
    (isCanvasProviderId(input.job.provider) && canvasLocalArtifactReceipt({ projectId: input.projectId, projectRoot, providerTaskId: input.providerTaskId, output: input.output, outputIndex: input.outputIndex }))
    || generic.materialize({ projectId: input.projectId, providerTaskId: input.providerTaskId, output: input.output, providerId: input.job.provider });
}

/** 一个画布节点这一次生成的候选：冻进合同的就是渲染层拼好的那一份请求（`parameters = { vendor, request }`）。 */
export function canvasCandidate(
  runId: string,
  vendor: string,
  modelKey: string,
  request: CanvasShotRequest | null,
  kind: string,
  revision: number,
): PlanCandidate {
  return {
    candidateId: `${runId}-shot`,
    revision,
    moduleId: "generation.canvas",
    providerId: canvasProviderId(vendor),
    modelId: modelKey,
    mode: kind,
    prompt: request?.prompt ?? "",
    parameters: { vendor, request },
    references: [],
  };
}

export function canvasPolicy(providerId: string, modelKey: string): Partial<AutomationPolicy> {
  return {
    trustedHosts: ["canvas"],
    allowedProviders: [providerId],
    allowedModels: [modelKey],
    maxSpend: null,
    maxAttemptsPerJob: 1,
  };
}
