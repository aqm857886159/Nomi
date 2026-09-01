import type { ProjectAgentAssistantTextAnchor } from '../../../../electron/shared/projectAgentContracts'

/** Render-only UTF-16 position in one canonical Host Assistant Item. */
export type CanvasAssistantTimelineAnchor = Readonly<{
  anchorMessageId: string
  anchorTextOffset: number
}>

export function canvasAssistantTimelineAnchor(
  anchor: ProjectAgentAssistantTextAnchor | undefined,
): CanvasAssistantTimelineAnchor | undefined {
  return anchor
    ? Object.freeze({ anchorMessageId: anchor.itemId, anchorTextOffset: anchor.textOffset })
    : undefined
}

export function firstCanvasAssistantTimelineAnchor(
  calls: readonly Partial<CanvasAssistantTimelineAnchor>[],
): CanvasAssistantTimelineAnchor | undefined {
  for (const call of calls) {
    if (
      typeof call.anchorMessageId === 'string' &&
      Number.isInteger(call.anchorTextOffset) &&
      (call.anchorTextOffset as number) >= 0
    ) {
      return Object.freeze({
        anchorMessageId: call.anchorMessageId,
        anchorTextOffset: call.anchorTextOffset as number,
      })
    }
  }
  return undefined
}
