import { synchronousSha256 } from "./synchronousSha256";

/**
 * 制作 Run 渲染层通道上的标识形状：projectId / runId / commandId / gateId / nodeId / shotId 都按它校验
 * （`electron/productionRun/productionRunIpc.ts` 的 `identifier`）。**唯一一份**——主进程校验、渲染层造命令号都从这里取。
 *
 * 为什么收成一处（2026-09-29，#921 真额度验收）：画布删镜头节点的上报命令号是渲染层手拼的
 * `detach-canvas:<runId>:<nodeIds>`，带「:」「,」，主进程这道校验一律拒（"Invalid command id"），渲染层又把错误吞了——
 * Run 里从来没记下 detach，被删的那一镜照样派发、照样扣费。规则和造号各写一份，两边就会各自漂；
 * 放在一处，造出来的号按构造就过得了校验，改规则的人也看得见谁在造号。
 */
export const PRODUCTION_RUN_IDENTIFIER_PATTERN = /^[A-Za-z0-9._-]{1,160}$/;

export function isProductionRunIdentifier(value: string): boolean {
  return PRODUCTION_RUN_IDENTIFIER_PATTERN.test(value) && value !== "." && value !== "..";
}

/**
 * 「用户把这几个占位节点从画布删掉了」那条 `plan.detach-shot-nodes` 的命令号。
 *
 * - 号认的是**这一次删除**：Run、节点集合、上报那一刻读到的 Run revision。同一次上报重发（撞 revision 冲突后
 *   `executeProductionRunCommand` 用同一个号重发、窗口重开再报一遍）仍是同一个号或落成无变化，只记一次；
 * - 同一个节点 id 被撤销删除、落地对账重新绑上之后又被删掉，是**另一次**删除：中间那次重新绑定让 revision 前进了，
 *   号就不同。以前号只看 Run + 节点集合，第二次删除和第一次一字不差，被仓库的幂等重放原样吞掉——Run 没记下
 *   detached，之后返工出来的新 attempt 照样派发、钱花在一个已删的节点上（2026-10-05，与画布认领同一类）；
 * - 号的长度固定、字符恒在校验集内：runId 与节点 id 只进摘要，不原样拼进号里——runId 自己就可以长到 160，
 *   原样拼进去会超长，而超长和非法字符在主进程那一头是同一种拒绝。
 */
export function detachShotNodesCommandId(runId: string, nodeIds: readonly string[], observedRevision: number): string {
  const digest = synchronousSha256(JSON.stringify([runId, [...new Set(nodeIds)].sort(), observedRevision])).slice(0, 32);
  return `detach-canvas.${digest}`;
}

/**
 * 画布接手一个制作镜头（`shot.claim`，by canvas）的命令号——**认的是这一镜的哪一次尝试**。
 *
 * 仓库按命令号幂等：同号的第二条命令不执行、原样返回第一次的结果。认领若只按 Run + 镜头造号，同一镜第二次被画布
 * 接手（例：画布接手 → 用户又让制作返工 → 批次停着时画布再生成）就被当成第一次的重放吞掉：新 attempt 没被标走，
 * 用户点「继续」后制作照派——同一镜付两次钱（2026-10-05 双扣路径 6）。号里带 attempt，同一次尝试的重试仍只记一次，
 * 下一次尝试必是新号。attempt 取 `currentShotAttempt`（reducer 记认领、判定口比认领用的同一个值）。
 */
export function canvasShotClaimCommandId(runId: string, shotId: string, attempt: number): string {
  const digest = synchronousSha256(JSON.stringify([runId, shotId])).slice(0, 32);
  return `shot-claim.${digest}.a${attempt}`;
}
