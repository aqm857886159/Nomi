// 单镜制作 Run 的开拍口（GUI 的 appIntegration 与无界面的 mcpStdioServer 共用这一个）。
//
// 以前两处各自直接 `submission.start`，GUI 那一处还是「先交、后落」（先交给供应商，再 best-effort 落画布）。
// 现在与多镜同一条规矩、同一个准入点：先经 `admitShotsForDispatch` 把这一镜落到画布上，落下了才交；
// 落不下来就不交，Run 停在 `landing_failed`（再调一次本函数 = 重落再交）。
import type { GenerationSubmissionResult, ProductionGenerationSubmission } from "./productionGenerationSubmission";
import type { ProductionRunRepository } from "./productionRunRepository";
import { admitShotsForDispatch, liftLandingFailure, recordLandingFailure, type LandingFailure, type LandShotsOnCanvas } from "./shotLandingAdmission";
import { landingFailureNotice } from "./landingFailureCopy";

export type SingleShotLandingFailed = Readonly<{
  operationId: string;
  runId: string;
  nextAction: "canvas_landing_failed";
  landingFailure: LandingFailure;
  /** 回给 Agent 的那句话（用户在 Agent 那边读到的就是它）。 */
  notice: string;
}>;

export async function startSingleShotProduction(input: Readonly<{
  repository: Pick<ProductionRunRepository, "read" | "execute">;
  submission: Pick<ProductionGenerationSubmission, "start" | "observeAccepted">;
  landShots: LandShotsOnCanvas;
  projectId: string;
  runId: string;
  now: () => string;
  locale?: "zh-CN" | "en";
}>): Promise<GenerationSubmissionResult | SingleShotLandingFailed> {
  const { repository, projectId, runId, now } = input;
  // 已经交出去、供应商受理过的那一次：只观察（不收准入、不落地、不再交）。节点后来被删了也照样把结果收回来。
  const accepted = input.submission.observeAccepted({ projectId, operationId: runId });
  if (accepted) return accepted;
  const outcome = await admitShotsForDispatch({ repository, land: input.landShots, projectId, runId, shotIds: [undefined] });
  const admission = [...outcome.admitted.values()][0];
  if (!admission) {
    recordLandingFailure(repository, projectId, runId, now);
    const landingFailure = outcome.landingFailure ?? { code: "canvas_landing_failed", projectId };
    return { operationId: runId, runId, nextAction: "canvas_landing_failed", landingFailure, notice: landingFailureNotice(input.locale ?? "zh-CN", landingFailure) };
  }
  // 上一次落地失败停着的，这一次落下了：先解除那次停下，再交（别的停下原因不碰，交给提交出口与认领判）。
  liftLandingFailure(repository, projectId, runId, now);
  return input.submission.start({ projectId, operationId: runId, admission });
}
