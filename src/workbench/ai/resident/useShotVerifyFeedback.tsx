import React from 'react'
import { useOpenProjectId } from '../../project/useOpenProjectId'
import { isProjectExecutionContextCurrent, withProjectAction } from '../../project/projectCanvasReadSurface'
import ReconcileDeviationCard from '../../generationCanvas/components/ReconcileDeviationCard'
import {
  buildContentFixMessage,
  retryShotVerify,
  useShotVerifyStore,
} from '../../generationCanvas/agent/shotVerifyStore'
import { canStartRound } from '../../generationCanvas/agent/storyboardLoopBudget'
import type { ResidentSurface } from './residentShellDisplay'

export { retryShotVerify }

type SendRepair = (text: string) => Promise<boolean>
const inFlight = new Set<string>()

/** Admission is the commit point; the existing store remains the only feedback/budget owner. */
export async function requestShotVerifyFix(projectId: string, send: SendRepair): Promise<boolean> {
  const before = useShotVerifyStore.getState()
  // 提交修复即动作起点：签发此刻打开的项目，必须就是这张偏差卡所属的项目。
  const project = withProjectAction((issued) => issued)
  if (!projectId || !project || project.binding.projectId !== projectId || before.projectId !== projectId
    || before.status !== 'ready' || !before.deviations.length || !canStartRound(before.budget) || inFlight.has(projectId)) return false
  inFlight.add(projectId)
  try {
    if (!await send(buildContentFixMessage(before.deviations))) return false
    const current = useShotVerifyStore.getState()
    if (!isProjectExecutionContextCurrent(project) || !current.isVerifyCurrent({ projectId, requestId: before.requestId }, project.binding.projectId)
      || current.deviations !== before.deviations || !current.consumeRound()) return false
    current.markFixing()
    return true
  } catch { return false } finally { inFlight.delete(projectId) }
}

/** The approved domain card joins live findings; no transcript entry or second deviation state. */
export function useShotVerifyFeedback(surface: ResidentSurface, send: SendRepair): React.ReactNode {
  const projectId = useOpenProjectId()
  const state = React.useSyncExternalStore(useShotVerifyStore.subscribe, useShotVerifyStore.getState, useShotVerifyStore.getState)
  return React.useMemo(() => {
    if (surface !== 'generation' || !projectId || state.projectId !== projectId
      || (!state.deviations.length && !state.unverified.length)) return null
    const current = () => {
      const latest = useShotVerifyStore.getState()
      return latest.isVerifyCurrent({ projectId, requestId: state.requestId }, projectId)
        && latest.deviations === state.deviations
        && latest.unverified === state.unverified ? latest : undefined
    }
    return (
      <ReconcileDeviationCard
        deviations={state.deviations}
        unverified={state.unverified}
        exhausted={state.exhausted}
        retryingVerify={state.status === 'verifying'}
        onDismiss={() => current()?.setDeviations([], [])}
        onAcceptUnverified={(shotNodeIds) => current()?.acceptUnverifiedShots(shotNodeIds)}
        onRetryUnverified={(shotNodeIds) => {
          if (current()) void retryShotVerify(projectId, shotNodeIds)
        }}
        onAiFix={() => {
          if (current()) void requestShotVerifyFix(projectId, send)
        }}
      />
    )
  }, [projectId, send, state, surface])
}
