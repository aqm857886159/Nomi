/**
 * 画布单镜：交给主进程观察者的那一笔收尾了，摇渲染层按这一次自己的运行记录号去收（`canvas.run-settled`）。
 *
 * 为什么要有：渲染层不再等的那一笔（等满落可找回、点了停、关了窗、确认再发顶掉的旧那笔）由观察者接着查，
 * 查到的结局只写进它的 Run。画布单镜 Run 不在「Run → 画布落地」那条路上（那条只跟制作 Run），
 * 以前渲染层只有用户手点「重新取回」才拿得回来，而且只取最新那条记录——确认再发之后，旧那笔付了钱的图回不到这一镜。
 *
 * 只摇两种：出片落进了 Run，或确定失败。「只差取回」的不摇：节点上那条本来就是可找回（摇了会和放手来回打转）。
 * 摇没接住（没有窗口 / 渲染层报错）：盘上「没收尾」标记留着，打开项目时再摇；接住了才删标记。每个进程里一笔只成功摇一次。
 * 渲染层收它走和收自己等到的结局同一本账（按号进这一镜的运行记录），这里不判节点上该显示哪一张。
 */
import { blockingReason, latestJob, readyArtifacts } from "./canvasShotResult";
import { isCanvasRunId, CANVAS_RUN_PREFIX, markCanvasRunSettled } from "../productionRun/canvasShotRunIndex";
import type { GenerationAuthorizationProjectIdentity } from "../productionRun/prepareProductionGenerationAuthorization";
import type { ProductionRun } from "../productionRun/productionRunTypes";
import { jobAwaitsRetrieval } from "../shared/productionShotPhase";
import type { CanvasShotSettledNotice } from "../shared/canvas/canvasShotSettled";
import { logWarn } from "../logging/logger";

export type CanvasShotSettledBellDeps = {
  identity: (projectId: string) => { lease: GenerationAuthorizationProjectIdentity; projectRoot: string };
  notify: (notice: CanvasShotSettledNotice) => Promise<unknown>;
};

/** 有了渲染层该收的结局：出片落进了 Run，或确定失败（不是「只差取回」）。 */
function hasOutcomeToLand(run: ProductionRun | null): run is ProductionRun {
  const job = run && !blockingReason(run) ? latestJob(run) : undefined;
  return Boolean(run && job && (readyArtifacts(run, job).length > 0 || (job.status === "needs_attention" && !jobAwaitsRetrieval(job))));
}

export function createCanvasShotSettledBell(deps: CanvasShotSettledBellDeps) {
  const key = (projectId: string, runId: string) => `${projectId}\u0000${runId}`;
  /** 交给了观察者、渲染层没再拿回去的：它们一收尾就摇。 */
  const handedOff = new Set<string>();
  const ringing = new Set<string>();
  const delivered = new Set<string>();

  function ring(run: ProductionRun): void {
    const id = key(run.projectId, run.runId);
    const nodeId = run.origin.nodeId;
    if (!nodeId || ringing.has(id) || delivered.has(id)) return;
    let projectRoot: string;
    let notice: CanvasShotSettledNotice;
    try {
      const { lease, projectRoot: root } = deps.identity(run.projectId);
      projectRoot = root;
      notice = { projectId: run.projectId, immutableProjectUuid: lease.immutableProjectUuid, projectGeneration: lease.projectGeneration, nodeId, runRecordId: run.runId.slice(CANVAS_RUN_PREFIX.length) };
    } catch (error) {
      logWarn("production-run", "canvas-shot-settled-bell-skipped", { runId: run.runId }, error);
      return;
    }
    ringing.add(id);
    void deps.notify(notice).then(
      () => { delivered.add(id); markCanvasRunSettled(projectRoot, run.runId); },
      (error) => logWarn("production-run", "canvas-shot-settled-bell-unanswered", { runId: run.runId }, error),
    ).finally(() => ringing.delete(id));
  }

  return {
    handedOff(projectId: string, runId: string): void {
      handedOff.add(key(projectId, runId));
    },
    /** 渲染层自己来查了（「重新取回」）：它拿到什么自己收，这边不再摇。 */
    reclaimed(projectId: string, runId: string): void {
      handedOff.delete(key(projectId, runId));
    },
    /** 仓库每一次耐久变化（与「Run → 画布落地」同一个事件旁路）。 */
    followRunChange(run: ProductionRun): void {
      if (!isCanvasRunId(run.runId) || !handedOff.has(key(run.projectId, run.runId)) || !hasOutcomeToLand(run)) return;
      handedOff.delete(key(run.projectId, run.runId));
      ring(run);
    },
    /**
     * 盘上还挂着「没收尾」、Run 已经收尾（打开项目 / 放手时读到）：渲染层自己收尾时会先删标记，走到这里的是观察者收的那一笔
     * 或者上次没摇成的——有结局就摇，接住了才删标记；没有要收的直接删。
     */
    settledOutside(projectRoot: string, runId: string, run: ProductionRun | null): void {
      if (hasOutcomeToLand(run) && !delivered.has(key(run.projectId, run.runId))) ring(run);
      else markCanvasRunSettled(projectRoot, runId);
    },
  };
}

export type CanvasShotSettledBell = ReturnType<typeof createCanvasShotSettledBell>;
