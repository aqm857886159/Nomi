// 测试用：「先落节点、再发请求」之后，派发之前这一镜必须真的落在画布上（Run 里有节点绑定）。
// 夹具不伪造准入：落地走与生产同一条 `plan.bind-shot-nodes` 命令，准入由真的 `admitShotsForDispatch` 发——
// 提交出口照样按耐久 Run 复核，所以这里绕不过任何一道闸，只是替渲染层把节点「落」了。
import type { ProductionRunRepository } from "./productionRunRepository";
import { admitShotsForDispatch, type LandedShotAdmission, type LandShotsOnCanvas } from "./shotLandingAdmission";

type Repository = Pick<ProductionRunRepository, "read" | "execute">;

/** 把这个 Run 还没绑节点的镜（单镜 = 候选 id）绑到 `node-<shotId>` 上，与渲染层落地之后主进程写回的同一条命令。 */
export function bindLandedNodes(repository: Repository, projectId: string, runId: string, issuedAt = "2026-10-08T00:00:00.000Z"): void {
  const run = repository.read(projectId, runId);
  const plan = run?.generationPlan;
  if (!run || !plan) throw new Error(`fixture: no generation plan on ${runId}`);
  const bindings = plan.shots && plan.shots.length > 0
    ? plan.shots.filter((shot) => !shot.nodeId).map((shot) => ({ shotId: shot.shotId, nodeId: `node-${shot.shotId}` }))
    : plan.nodeId ? [] : [{ shotId: plan.candidate.candidateId, nodeId: `node-${plan.candidate.candidateId}` }];
  if (bindings.length === 0) return;
  repository.execute(projectId, runId, {
    commandId: `fixture-land:${runId}:${run.revision}`, expectedRevision: run.revision,
    type: "plan.bind-shot-nodes", payload: { bindings }, issuedAt,
  });
}

/** 一个总能落下来的落地器（调度器 / 单镜开拍口的 `landShots`）。 */
export function landingThatBinds(repository: Repository): LandShotsOnCanvas {
  return async (projectId, runId) => bindLandedNodes(repository, projectId, runId);
}

/** 落下这一镜并拿到真的准入（单镜省略 shotId）。 */
export async function landedAdmission(repository: Repository, projectId: string, runId: string, shotId?: string): Promise<LandedShotAdmission> {
  const outcome = await admitShotsForDispatch({ repository, land: landingThatBinds(repository), projectId, runId, shotIds: [shotId] });
  const admission = [...outcome.admitted.values()][0];
  if (!admission) throw new Error(`fixture: ${shotId ?? "single shot"} of ${runId} did not land`);
  return admission;
}
