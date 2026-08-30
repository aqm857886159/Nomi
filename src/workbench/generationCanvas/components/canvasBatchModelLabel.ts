import type { CanvasGenerationExecutionGroup } from './canvasProductionScope'

export type CanvasBulkModelLabelKey =
  | `generationCommon.production.modelGroup.${CanvasGenerationExecutionGroup['executionKind']}`
  | `generationCommon.production.modeModelGroup.${CanvasGenerationExecutionGroup['requiredMode']}`

export function resolveCanvasBulkModelLabelKey(
  group: CanvasGenerationExecutionGroup,
  peerGroups: readonly CanvasGenerationExecutionGroup[],
): CanvasBulkModelLabelKey {
  const sameKindHasAnotherMode = peerGroups.some(
    (peer) => peer.executionKind === group.executionKind && peer.requiredMode !== group.requiredMode,
  )
  return sameKindHasAnotherMode
    ? `generationCommon.production.modeModelGroup.${group.requiredMode}`
    : `generationCommon.production.modelGroup.${group.executionKind}`
}
