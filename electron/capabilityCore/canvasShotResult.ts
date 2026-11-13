import { productionJobPhase } from '../shared/productionShotPhase'
/** 画布单镜从 Run 账本读出来的那一份结果：最新一笔作业、它的产物、交回渲染层的形状。只读，不写账本。 */
import { localAssetUrl } from "../assets/assetPaths";
import type { ProductionArtifact, ProductionJob, ProductionRun } from "../productionRun/productionRunTypes";
import type { CanvasTaskResult } from "./canvasTransportProvider";

export function latestJob(run: ProductionRun): ProductionJob | undefined {
  return [...run.jobs].sort((left, right) => right.attempt - left.attempt)[0];
}

/** 这笔作业账上的全部产物（一次出几张就几张，按落账顺序 = 上游交回的顺序）。 */
export function readyArtifacts(run: ProductionRun, job: ProductionJob): ProductionArtifact[] {
  return run.artifacts.filter(
    (artifact) => artifact.jobId === job.jobId && ["ready", "adopted"].includes(artifact.status),
  );
}

/**
 * 从 Run 账本复原「出片了」那一份结果（重开项目、观察者已经收完时用；与画布那台落地的是同一批本地文件）。
 * 这笔作业的每一份产物都在里面——渲染层按同一个口径把它们各落成一个版本。
 */
export function resultFromArtifacts(
  run: ProductionRun,
  job: ProductionJob,
  artifacts: readonly [ProductionArtifact, ...ProductionArtifact[]],
  kind: string,
): CanvasTaskResult {
  return {
    id: job.providerTaskId ?? job.jobId,
    kind,
    status: "succeeded",
    assets: artifacts.map((artifact) => ({
      type: artifact.kind === "video" || artifact.kind === "audio" || artifact.kind === "model3d" ? artifact.kind : "image",
      url: localAssetUrl(run.projectId, artifact.projectRelativePath ?? ""),
      ...(artifact.width && artifact.height ? { width: artifact.width, height: artifact.height } : {}),
    })),
    raw: {},
  };
}

export function failedResult(job: ProductionJob, kind: string): CanvasTaskResult {
  return {
    id: job.providerTaskId ?? job.jobId,
    kind,
    status: "failed",
    assets: [],
    raw: {},
    error: job.errorMessage || job.errorCode || "generation failed",
  };
}

/** 同节点还有一笔没收尾：在路上的说「还在生成」，可能已扣钱、结果不明的说「先去核对」。 */
export function blockingReason(run: ProductionRun | null): "in_flight" | "needs_reconcile" | null {
  if (!run) return null;
  for (const job of run.jobs) {
    if (job.status === "submission_unknown" || job.status === "reconciling") return "needs_reconcile";
    if (job.status === "submit_intent_persisted" || productionJobPhase(job.status) === "generating") return "in_flight";
  }
  return null;
}
