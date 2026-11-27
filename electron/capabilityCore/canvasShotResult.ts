export { latestJobForShot as latestJob } from '../shared/productionShotJobs'
import { productionJobOpenAs } from '../shared/productionJobOpenAs'
/** 画布单镜从 Run 账本读出来的那一份结果：最新一笔作业、它的产物、交回渲染层的形状。只读，不写账本。 */
import path from "node:path";
import { envelopeRefFor } from "../productionRun/productionGenerationBinding";
import { createProductionRunRuntimeEnvelope } from "../productionRun/productionRunRuntimeEnvelope";
import { localAssetUrl } from "../assets/assetPaths";
import type { ProductionArtifact, ProductionJob, ProductionRun } from "../productionRun/productionRunTypes";
import type { CanvasTaskResult } from "./canvasTransportProvider";

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

/** Online completion, observed completion and replay all read the same job. */
export function readSettledCanvasResult(projectRoot: string, run: ProductionRun, job: ProductionJob, kind: string): CanvasTaskResult | undefined {
  if (job.status !== "ready" && job.status !== "adopted") return undefined;
  const receipt = createProductionRunRuntimeEnvelope({ filePath: path.join(projectRoot, envelopeRefFor(run.runId, job.jobId)) }).read();
  if (receipt?.settledResult) return receipt.settledResult;
  const [first, ...rest] = readyArtifacts(run, job);
  return first && resultFromArtifacts(run, job, [first, ...rest], kind);
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
    const openAs = productionJobOpenAs(job.status);
    if (openAs) return openAs;
  }
  return null;
}
