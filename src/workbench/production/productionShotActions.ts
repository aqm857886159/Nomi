// Node and task hosts own feedback; spend confirmations remain in the main process.
import i18n from '../../i18n'
import { notify } from '../../ui/notificationPolicy'
import { productionRunApi, type ProductionActionResult } from './productionRunApi'
import { logRendererError } from '../../desktop/rendererLog'

function reportResult(result: ProductionActionResult, identity: string, present: (message: string) => void): ProductionActionResult {
  if (result.ok || result.code === 'rework_declined' || result.code === 'resume_declined') return result
  const guidance = result.code === 'no_prior_attempt'
    ? i18n.t('generationCommon.production.canvasLanding.rework.noPriorAttempt')
    : result.code === 'unavailable'
      ? i18n.t('generationCommon.production.canvasLanding.rework.unavailable')
      : i18n.t('generationCommon.production.canvasLanding.rework.failed')
  notify({
    identity, reason: result.code, level: 'inline', present, type: 'error',
    message: result.message?.trim() ? `${result.message} · ${guidance}` : guidance,
  })
  return result
}

/** Rework retains the existing single-shot spend confirmation. */
export async function reworkProductionShot(projectId: string, runId: string, shotId: string | undefined, present: (message: string) => void): Promise<ProductionActionResult> {
  present('')
  const identity = `production-rework:${projectId}:${runId}:${shotId ?? 'run'}`
  try {
    return reportResult(await productionRunApi.rework(projectId, runId, shotId), identity, present)
  } catch (error) {
    logRendererError('production-rework-failed', error)
    return reportResult({ ok: false, code: 'failed', message: error instanceof Error ? error.message : String(error) }, identity, present)
  }
}

/** Resume retains the existing budget/manual confirmation and scheduling. */
export async function resumeProductionBatch(projectId: string, runId: string, reason: 'budget' | 'manual', present: (message: string) => void): Promise<ProductionActionResult> {
  present('')
  const identity = `production-resume:${projectId}:${runId}`
  try {
    return reportResult(await productionRunApi.resumeBatch(projectId, runId, reason), identity, present)
  } catch (error) {
    logRendererError('production-resume-failed', error)
    return reportResult({ ok: false, code: 'failed', message: error instanceof Error ? error.message : String(error) }, identity, present)
  }
}
