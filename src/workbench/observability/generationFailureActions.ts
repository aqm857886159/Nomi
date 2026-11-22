import { isProductionRunRecord } from '../../../electron/shared/productionShotPhase'
import { decideGenerationFailure, failureActionsFor } from '../../../electron/shared/generationFailure'
import { projectGenerationFailure, uiFailureLocale } from './classifyError'
import { narrateFailureText } from './narrate'

export type FailureRun = Readonly<{ id?: string; taskId?: string; productionRunId?: string }>

/** The three production pages read the same task provenance and retry decision. */
export function generationFailureActions(message: string, run?: FailureRun) {
  const decision = decideGenerationFailure({ message, locale: uiFailureLocale() })
  const report = projectGenerationFailure(decision)
  // 任务来源（有没有可再查的任务、是不是制作 Run）是输入事实；用哪一版动作 / 说明由共享判定处决定。
  const actions = failureActionsFor(decision, { taskId: run?.taskId, productionRunId: run?.productionRunId, isProductionRecord: isProductionRunRecord({ id: run?.id }) })
  return {
    ...report,
    hint: actions.hintKey ? narrateFailureText({ key: actions.hintKey }) : report.hint,
    primary: actions.primary,
    secondary: actions.secondary,
    canRetry: actions.canRetry,
  }
}
