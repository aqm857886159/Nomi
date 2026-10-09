// A4 run 控制（plan 2026-08-11-mcp-conversation-native-p0）：pause/resume/cancel 单一收口，
// MCP（dispatcher production.control）与渲染端（run.control 白名单）走同一条路径。
// 从 productionRunService 抽出成独立层（R9 ≤800 行 + 控制语义独立可测；状态机合法性仍由
// productionRunState 的 transitionRun 在 repository.execute 内兜底）。

import type { ProductionRunRepository } from './productionRunRepository'
import type { ProductionRun, RunCommand, RunCommandResult } from './productionRunTypes'
import { renewDispatchConsent } from './productionDispatchConsentEdits'
import { NothingToResumeError, resumeOutlook } from './resumeOutlook'

// 已提交给供应商的任务**无法撤回、钱已花出**——暂停/取消都只能让它们跑完收尾（结果保留不浪费），能守住的边界是
// 「不再提交新任务」。pausing → paused 那一步不在这里、也不在任何驱动里：它是生命周期 owner
// （productionRunLifecycle.settleRunLifecycle）挂在仓库写入口上的收尾，最后一件活收尾的那条写入顺带落下。

/** 这次控制在 Run 当前的状态下不允许（人话留给 Agent 转述；画布按类型认出它，不读这句话）。 */
export class ProductionRunControlRefusedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ProductionRunControlRefusedError'
  }
}

/**
 * 应用一次控制命令。幂等近似：已在目标态 → 原样返回不写事件（对话里连说两次「停」不该炸）；
 * 非法操作抛人话错误（错误契约 A6 会带给 agent 转述）。
 */
export function applyRunControl(
  repository: Pick<ProductionRunRepository, 'execute'>,
  projectId: string,
  runId: string,
  current: ProductionRun,
  runCommand: RunCommand,
): RunCommandResult {
  const action = typeof runCommand.payload.action === 'string' ? runCommand.payload.action : ''
  const actionLabel = action === 'pause' ? '暂停' : action === 'resume' ? '继续' : '取消'
  const illegal = () => new ProductionRunControlRefusedError(`无法${actionLabel}：制作当前状态是 ${current.status}，不允许这个操作`)
  if (action === 'pause') {
    if (['pausing', 'paused'].includes(current.status)) return { run: current, events: [] }
    if (current.status !== 'running') throw illegal()
    // 手上没有交给供应商的活，同一次写入就落到 paused（生命周期收尾）；有则停在 pausing，最后一件收尾时再落。
    return repository.execute(projectId, runId, { ...runCommand, type: 'run.status', payload: { status: 'pausing', reason: 'user_paused' } })
  }
  if (action === 'resume') {
    // 这一下继续实际会不会做事，只问唯一判定（resumeOutlook）：一镜都不会派、也没有在等的 → 不写、不说「已继续」，
    // 抛出带结果的拒绝，各入口按它说真话（#1139 V-1139c：以前这里照样改成 running、回「已继续」）。
    const outlook = resumeOutlook(current)
    if (outlook.kind === 'nothing_to_resume') throw new NothingToResumeError(outlook)
    // 用户在 Nomi 窗口里点的「继续」（受信边界盖了真人手势章）同时续上批过、还没发出去的那几镜的同意
    // （付费卡① 第 13 条）。MCP 宿主 / Agent 的 resume 没有这个章，不续：没人点，同意就不该被延长。
    const renew = (run: ProductionRun) => (runCommand.humanGesture === true
      ? renewDispatchConsent(repository, projectId, runId, run, 'resume', runCommand.issuedAt)
      : undefined)
    if (current.status === 'running') return renew(current) ?? { run: current, events: [] }
    // 急停后在跑的那一镜还没回来（pausing）也能接着拍：用户改主意了，不必等它收尾（2026-09-29：以前这里报
    // 「run status pausing is not resumable」，而画布上的「继续剩余」正摆在他面前）。
    if (!['pausing', 'paused', 'needs_attention'].includes(current.status)) throw illegal()
    const resumed = repository.execute(projectId, runId, { ...runCommand, type: 'run.status', payload: { status: 'running' } })
    const renewed = renew(resumed.run)
    return renewed ? { run: renewed.run, events: [...resumed.events, ...renewed.events] } : resumed
  }
  if (action === 'cancel') {
    if (current.status === 'cancelled') return { run: current, events: [] }
    if (current.status === 'completed') throw illegal()
    return repository.execute(projectId, runId, { ...runCommand, type: 'run.status', payload: { status: 'cancelled', reason: 'user_cancelled' } })
  }
  throw new Error('Invalid production control action')
}
