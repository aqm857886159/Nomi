// P4 S6 — 返工/续拍的渲染层动作收口（一功能一个家，P1）。占位节点的重试/续拍钮、失败镜 NodeErrorReport 的
// onRetry 都走这里，不各自拼一遍 IPC + toast。结构化结果 code → t() 人话反馈（禁拼串穿透 i18n 门）。
import i18n from '../../i18n'
import { toast } from '../../ui/toast'
import { productionRunApi, type ProductionActionResult } from './productionRunApi'

type ToastKind = 'success' | 'error' | 'info' | 'warning'

/** 结构化结果 code → (人话文案 key, toast 类型)。unavailable/failed/run_not_open/not_multishot 都归「用不了」桶。 */
function feedbackFor(result: ProductionActionResult): { messageKey: string; kind: ToastKind } {
  switch (result.code) {
    case 'reworked':
      return { messageKey: 'generationCommon.production.canvasLanding.rework.reworked', kind: 'success' }
    case 'resumed':
      return { messageKey: 'generationCommon.production.canvasLanding.rework.resumed', kind: 'success' }
    case 'rework_declined':
      return { messageKey: 'generationCommon.production.canvasLanding.rework.reworkDeclined', kind: 'info' }
    case 'resume_declined':
      return { messageKey: 'generationCommon.production.canvasLanding.rework.resumeDeclined', kind: 'info' }
    case 'no_prior_attempt':
      return { messageKey: 'generationCommon.production.canvasLanding.rework.noPriorAttempt', kind: 'warning' }
    case 'unavailable':
      return { messageKey: 'generationCommon.production.canvasLanding.rework.unavailable', kind: 'warning' }
    case 'run_not_open':
    case 'not_multishot':
    case 'failed':
    default:
      return { messageKey: 'generationCommon.production.canvasLanding.rework.failed', kind: 'error' }
  }
}

function reportResult(result: ProductionActionResult): ProductionActionResult {
  const { messageKey, kind } = feedbackFor(result)
  toast(i18n.t(messageKey), kind)
  return result
}

/**
 * 返工一镜：同 Run 新 Job + 单镜确认 + 派发（主进程编排，见 appIntegration.reworkProductionShot）。
 * 弹卡确认发生在主进程侧（Nomi 自有确认漏斗，防注入）；这里只发起 + 按结果 toast。
 */
export async function reworkProductionShot(projectId: string, runId: string, shotId?: string): Promise<ProductionActionResult> {
  try {
    const result = await productionRunApi.rework(projectId, runId, shotId)
    return reportResult(result)
  } catch (error) {
    console.error('[nomi:production] rework failed', error)
    return reportResult({ ok: false, code: 'failed', message: error instanceof Error ? error.message : String(error) })
  }
}

/** 续拍已停批次：manual=急停继续 / budget=提额续拍（主进程转回 running 后重踢 scheduler）。 */
export async function resumeProductionBatch(projectId: string, runId: string, reason: 'budget' | 'manual'): Promise<ProductionActionResult> {
  try {
    const result = await productionRunApi.resumeBatch(projectId, runId, reason)
    return reportResult(result)
  } catch (error) {
    console.error('[nomi:production] resume failed', error)
    return reportResult({ ok: false, code: 'failed', message: error instanceof Error ? error.message : String(error) })
  }
}
