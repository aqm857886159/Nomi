// 「继续」这一下实际会做什么——唯一的判定（#1139 V-1139c）。
//
// 「继续」有三扇门：画布占位卡上的「继续」（resumeProductionBatch）、制作面板的「从断点继续」（渲染层 run.control）、
// 外部 Agent 的 nomi_run_control resume（dispatcher production.control）。以前只有第一扇在落地失败那一种停下里问过
// 「剩下还有没有能派的」，另两扇照样回「已继续」——Run 改成 running，一镜都不会派（V-1139c：真窗口回 resumed）。
// 现在三扇门都只问这里，各自只把结果转成自己的话；run.control 的写口（applyRunControl）也问这里，谁绕过入口都写不进去。
import type { ProductionRun } from "./productionRunTypes";
import { isStillAtProvider } from "./productionRunLifecycle";
import { shotRemovedFromCanvas, shotsAwaitingDispatch, shotTakenOverByCanvas } from "./shotLandingAdmission";
import { latestJobForShot, shotIncluded } from "../shared/productionShotJobs";

export type ResumeOutlook =
  /** 继续之后真有事做：派 `dispatching` 这几镜（其中 `notPlaced` 还没放到画布上，派之前先落），或者等已交出去的收尾 / 往下一步走。 */
  | Readonly<{ kind: "proceed"; dispatching: readonly string[]; notPlaced: readonly string[] }>
  /**
   * 继续了也一镜都不会派、也没有在等的。剩下没完成的镜各是为什么：节点被删了（`removed`）、画布已经接手直接生成
   * （`canvas`）、已经失败或要核对、得在那一镜上单独处理（`failed`）。
   */
  | Readonly<{ kind: "nothing_to_resume"; removed: readonly string[]; canvas: readonly string[]; failed: readonly string[] }>;

const FINISHED = new Set(["ready", "adopted"]);

export function resumeOutlook(run: ProductionRun): ResumeOutlook {
  const plan = run.generationPlan;
  // 不是一批已经确认过的镜头（流水线别的阶段、单镜）：「继续」由驱动接着走，这里不替它判。
  if (!plan?.shots?.length || plan.state !== "submitted") return { kind: "proceed", dispatching: [], notPlaced: [] };
  // 会派的镜只认一个定义（shotsAwaitingDispatch：开拍、继续、逐镜事实共用）。
  const dispatching = shotsAwaitingDispatch(run);
  if (dispatching.length > 0) {
    const notPlaced = dispatching.filter((shotId) => !plan.shots!.find((shot) => shot.shotId === shotId)?.nodeId);
    return { kind: "proceed", dispatching, notPlaced };
  }
  // 还有交给供应商、没结论的：继续 = 让它收完这一批（停着的批次收完会落停，继续了才会往下走）。
  if (run.jobs.some(isStillAtProvider)) return { kind: "proceed", dispatching: [], notPlaced: [] };
  const removed: string[] = [];
  const canvas: string[] = [];
  const failed: string[] = [];
  for (const shot of plan.shots.filter(shotIncluded)) {
    const job = latestJobForShot(run, shot.shotId);
    if (!job || FINISHED.has(job.status)) continue; // 没批过的归付费卡；做完的不用管
    if (shotRemovedFromCanvas(run, shot.shotId)) removed.push(shot.shotId);
    else if (shotTakenOverByCanvas(run, shot.shotId)) canvas.push(shot.shotId);
    else failed.push(shot.shotId);
  }
  // 整批都做完了（或剩下的都还没批）：继续 = 往下一步走（流水线收尾），不是空转。
  if (removed.length === 0 && canvas.length === 0 && failed.length === 0) return { kind: "proceed", dispatching: [], notPlaced: [] };
  return { kind: "nothing_to_resume", removed, canvas, failed };
}

/** 写口拒绝「继续」时抛它：带着唯一判定的结果，各入口按它说话（不是失败，是这一下什么都不会发生）。 */
export class NothingToResumeError extends Error {
  readonly code = "nothing_to_resume";
  constructor(readonly outlook: Extract<ResumeOutlook, { kind: "nothing_to_resume" }>) {
    const list = (shots: readonly string[]) => shots.join(",") || "-";
    super(`nothing_to_resume: removed=${list(outlook.removed)} canvas=${list(outlook.canvas)} failed=${list(outlook.failed)}`);
    this.name = "NothingToResumeError";
  }
}
