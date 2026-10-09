// Node and task hosts own feedback; spend confirmations remain in the main process.
import i18n from '../../i18n'
import type { TranslationKey } from '../../i18n/translationKey'
import { notify } from '../../ui/notificationPolicy'
import { productionRunApi, type ProductionShotActionFailure, type ProductionShotActionResult } from './productionRunApi'
import { logRendererError } from '../../desktop/rendererLog'

/**
 * 返工 / 续拍没做成：**每一种原因一句人话**，说清怎么了、钱怎么样了、能做什么（2026-09-29）。
 * 以前所有失败都落进「操作没成功，请稍后再试」，前面还拼着主进程英文原话（「run status pausing is not resumable」）。
 * 这张表就是唯一的目录：穷尽，没有兜底句——主进程多一种失败而这里没写，类型检查当场过不去；
 * 一个失败说不清是哪一种，该去源头给它一个码，不在这里兜一句。
 */
export const SHOT_ACTION_FAILURE_COPY = {
  request_invalid: 'generationCommon.production.canvasLanding.actionFailure.requestInvalid',
  bridge_unavailable: 'generationCommon.production.canvasLanding.actionFailure.bridgeUnavailable',
  core_starting: 'generationCommon.production.canvasLanding.actionFailure.coreStarting',
  run_not_open: 'generationCommon.production.canvasLanding.actionFailure.runNotOpen',
  run_missing: 'generationCommon.production.canvasLanding.actionFailure.runMissing',
  run_unreadable: 'generationCommon.production.canvasLanding.actionFailure.runUnreadable',
  not_multishot: 'generationCommon.production.canvasLanding.actionFailure.notMultishot',
  project_unavailable: 'generationCommon.production.canvasLanding.actionFailure.projectUnavailable',
  confirmation_unavailable: 'generationCommon.production.canvasLanding.actionFailure.confirmationUnavailable',
  provider_unavailable: 'generationCommon.production.canvasLanding.actionFailure.providerUnavailable',
  no_prior_attempt: 'generationCommon.production.canvasLanding.actionFailure.noPriorAttempt',
  previous_attempt_unsettled: 'generationCommon.production.canvasLanding.actionFailure.previousAttemptUnsettled',
  attempt_limit: 'generationCommon.production.canvasLanding.actionFailure.attemptLimit',
  run_changed: 'generationCommon.production.canvasLanding.actionFailure.runChanged',
  approval_stale: 'generationCommon.production.canvasLanding.actionFailure.approvalStale',
  approval_expired: 'generationCommon.production.canvasLanding.actionFailure.approvalExpired',
  run_finished: 'generationCommon.production.canvasLanding.actionFailure.runFinished',
  not_stopped: 'generationCommon.production.canvasLanding.actionFailure.notStopped',
  plan_not_submitted: 'generationCommon.production.canvasLanding.actionFailure.planNotSubmitted',
  ledger_write_failed: 'generationCommon.production.canvasLanding.actionFailure.ledgerWriteFailed',
  canvas_landing_failed: 'generationCommon.production.canvasLanding.actionFailure.canvasLandingFailed',
  internal_error: 'generationCommon.production.canvasLanding.actionFailure.internalError',
} as const satisfies Record<ProductionShotActionFailure, TranslationKey>

function reportResult(result: ProductionShotActionResult, identity: string, present: (message: string) => void): ProductionShotActionResult {
  if (result.code !== 'failed') return result
  notify({ identity, reason: result.failure, level: 'inline', present, type: 'error', message: i18n.t(SHOT_ACTION_FAILURE_COPY[result.failure]) })
  return result
}

/**
 * 调不到主进程（这个窗口没有桌面桥，或主进程没注册这条通道）。主进程那一侧从不往这里抛——它把每一种失败都回成了
 * 结构化结果——所以走到这里的只有「桥不通」这一种。
 */
function bridgeUnavailable(event: 'production-rework-bridge-unavailable' | 'production-resume-bridge-unavailable', error: unknown): ProductionShotActionResult {
  logRendererError(event, error)
  return { ok: false, code: 'failed', failure: 'bridge_unavailable' }
}

/** Rework retains the existing single-shot spend confirmation. */
export async function reworkProductionShot(projectId: string, runId: string, shotId: string | undefined, present: (message: string) => void): Promise<ProductionShotActionResult> {
  present('')
  const identity = `production-rework:${projectId}:${runId}:${shotId ?? 'run'}`
  let result: ProductionShotActionResult
  try {
    result = await productionRunApi.rework(projectId, runId, shotId)
  } catch (error) {
    result = bridgeUnavailable('production-rework-bridge-unavailable', error)
  }
  return reportResult(result, identity, present)
}

/**
 * 「继续剩余」。续额度还是直接接着拍，主进程照 Run 在停下那一刻记下的原因决定——渲染层不替它选
 * （以前由这里按画布上猜出的「预算」传 budget，于是没有价格时也弹出额度 0 的续拍确认）。
 */
export async function resumeProductionBatch(projectId: string, runId: string, present: (message: string) => void): Promise<ProductionShotActionResult> {
  present('')
  const identity = `production-resume:${projectId}:${runId}`
  let result: ProductionShotActionResult
  try {
    result = await productionRunApi.resumeBatch(projectId, runId)
  } catch (error) {
    result = bridgeUnavailable('production-resume-bridge-unavailable', error)
  }
  return reportResult(result, identity, present)
}
