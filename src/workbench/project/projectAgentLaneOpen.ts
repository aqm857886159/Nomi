import type { ProjectBinding } from '../../../electron/shared/projectBinding'
import type { LaneDesktopResult } from '../../../electron/shared/agentLane/laneDesktopContracts'
import { LaneCommandFailure } from '../ai/lane/laneCommandFailure'

export type ProjectAgentLaneOpenDependencies = Readonly<{
  open: (binding: ProjectBinding) => Promise<LaneDesktopResult>
  recoverReceipts: (workspaceId: string) => Promise<void>
  reportFailure: (failure: LaneCommandFailure) => void
}>

/** Open the optional Agent sidecar without making project hydration depend on it. */
export async function openProjectAgentLane(
  binding: ProjectBinding,
  dependencies: ProjectAgentLaneOpenDependencies,
): Promise<boolean> {
  const opened = await dependencies.open(binding)
  if (!opened.ok) {
    dependencies.reportFailure(new LaneCommandFailure(opened.code, opened.diagnostic))
    return false
  }
  if (!opened.workspaceId) {
    dependencies.reportFailure(new LaneCommandFailure('agent_lane_closed', 'lane did not return a workspace identity'))
    return false
  }
  await dependencies.recoverReceipts(opened.workspaceId)
  return true
}
