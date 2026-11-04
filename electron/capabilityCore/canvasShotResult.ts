/** 画布单镜从 Run 账本读出来的那一份结果：最新一笔作业、它的产物、交回渲染层的形状。只读，不写账本。 */
import { localAssetUrl } from "../assets/assetPaths";
import type { ProductionArtifact, ProductionJob, ProductionRun } from "../productionRun/productionRunTypes";
import type { CanvasTaskResult } from "./canvasTransportProvider";

export function latestJob(run: ProductionRun): ProductionJob | undefined {
  return [...run.jobs].sort((left, right) => right.attempt - left.attempt)[0];
}

export function readyArtifact(run: ProductionRun, job: ProductionJob): ProductionArtifact | undefined {
  return run.artifacts.find(
    (artifact) => artifact.jobId === job.jobId && ["ready", "adopted"].includes(artifact.status),
  );
}

/** 从 Run 账本复原「出片了」那一份结果（重开项目、观察者已经收完时用；与画布那台落地的是同一个本地文件）。 */
export function resultFromArtifact(
  run: ProductionRun,
  job: ProductionJob,
  artifact: ProductionArtifact,
  kind: string,
): CanvasTaskResult {
  const assetType =
    artifact.kind === "video" || artifact.kind === "audio" || artifact.kind === "model3d" ? artifact.kind : "image";
  return {
    id: job.providerTaskId ?? job.jobId,
    kind,
    status: "succeeded",
    assets: [
      {
        type: assetType,
        url: localAssetUrl(run.projectId, artifact.projectRelativePath ?? ""),
        ...(artifact.width && artifact.height ? { width: artifact.width, height: artifact.height } : {}),
      },
    ],
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
