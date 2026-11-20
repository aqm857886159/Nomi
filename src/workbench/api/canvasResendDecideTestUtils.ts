// Test-only：渲染层测试没有主进程时，按主进程 `createCanvasShotResend().decideResend` 的同一条规则回判定（读的是测试自己桩出来的 canvasOpenRuns）。
// It is not imported by production code. 规则以主进程那一处为准，这里只照抄输入输出的形状，不另立判定。
import type { CanvasResendDecidePayload, CanvasResendDecision } from '../../../electron/shared/canvas/canvasResendDecide'
import { canvasOpenRuns } from './taskApi'

let minted = 0

export async function canvasResendDecideLikeMain(input: CanvasResendDecidePayload): Promise<CanvasResendDecision> {
  const open = input.nodeId ? (await canvasOpenRuns({ projectId: input.projectId, nodeId: input.nodeId })) ?? [] : []
  if (input.initiator !== 'user') return open.length ? { action: 'refuse', code: 'node_generation_in_flight' } : { action: 'send' }
  if (!input.resend && open.length === 0) return { action: 'send' }
  const release = open.flatMap(entry => entry.reason === 'needs_reconcile' && entry.jobId ? [{ runId: entry.runId, jobId: entry.jobId }] : [])
  if (input.production?.jobId && !release.some(entry => entry.jobId === input.production?.jobId)) release.push({ runId: input.production.runId, jobId: input.production.jobId })
  minted += 1
  return { action: 'ask', decisionId: `test-decision-${minted}`, resultUnknown: release.length > 0 || input.resultUnknown === true, release, open }
}
