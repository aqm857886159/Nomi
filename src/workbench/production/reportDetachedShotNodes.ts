import type { DesktopProductionRunBridge } from '../../desktop/productionRunBridgeTypes'
import { detachShotNodesCommandId } from '../../../electron/shared/productionRunCommandId'
import { executeProductionRunCommand } from './productionRunCommands'

/** 这一步要的两个口：读 Run、发命令——就是桌面桥的那两个（生产里是 productionRunApi；测试里接到真的 IPC 处理器上）。 */
export type DetachReportApi = Pick<DesktopProductionRunBridge, 'read' | 'command'>

/**
 * 用户把属于某个制作 Run 的占位节点从画布删掉了 → 让 Run 记下 detached：还没派出去的那一镜就此不再派、不扣钱；
 * 已经派出去的照常跑完，结果不落画布（撤销事实优先）。
 *
 * 两件事都交给唯一的 owner，不在这里另写一份：
 * - 命令号由中立层的 `detachShotNodesCommandId` 造——和主进程 IPC 的校验同一个模块，造出来的号按构造就过得去；
 * - 发命令走渲染层唯一的制作命令口 `executeProductionRunCommand`——调度器正在写同一个 Run 时撞上 revision 冲突，
 *   它按最新 revision 重发一次（删节点的那一刻往往正是调度器在连写派发记录的时候）。
 *
 * 失败照实抛给调用方：上报没落到 Run 就意味着被删的那一镜可能照样派发、照样扣费，调用方必须留痕并告诉用户，不许吞。
 */
export async function reportDetachedShotNodes(
  projectId: string,
  runId: string,
  nodeIds: readonly string[],
  api: DetachReportApi,
): Promise<'detached' | 'not-applicable'> {
  const run = await api.read(projectId, runId)
  // Run 已经不在，或计划已是真终态（`cancelled`）：落地投影本来就不认它，没有要记的。
  if (!run || run.generationPlan?.state === 'cancelled') return 'not-applicable'
  await executeProductionRunCommand(projectId, runId, {
    commandId: detachShotNodesCommandId(runId, nodeIds, run.revision),
    expectedRevision: run.revision,
    type: 'plan.detach-shot-nodes',
    payload: { nodeIds: [...nodeIds] },
    issuedAt: new Date().toISOString(),
  }, { read: api.read, execute: api.command })
  return 'detached'
}
