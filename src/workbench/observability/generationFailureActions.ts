import { isProductionRunRecord } from '../../../electron/shared/productionShotPhase'
import { classifyGenerationError } from './classifyError'
import { narrateGenerationErrorWithoutTask } from './narrate'

export type FailureRun = Readonly<{ id?: string; taskId?: string; productionRunId?: string }>

/** The three production pages read the same task provenance and retry decision. */
export function generationFailureActions(message: string, run?: FailureRun) {
  const report = classifyGenerationError(message)
  const withoutTask = !run?.taskId?.trim() && !isProductionRunRecord({ id: run?.id })
    ? narrateGenerationErrorWithoutTask(report.kind) : null
  const primary = withoutTask?.primary ?? report.primary
  const secondary = withoutTask ? withoutTask.secondary : report.secondary
  return {
    ...report,
    hint: withoutTask?.hint ?? report.hint,
    primary: primary === 'view-task' && run?.taskId?.trim() && !run.productionRunId ? 'open-recoverable' as const : primary,
    secondary,
    canRetry: primary === 'retry' || secondary === 'retry',
  }
}
