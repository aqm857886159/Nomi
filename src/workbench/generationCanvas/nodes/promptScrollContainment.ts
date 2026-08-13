/**
 * Prompt editor is nested inside the canvas viewport. The canvas listens for
 * wheel events to pan; the nested editor must consume the event even when its
 * scroll position is already at an edge.
 */
export function stopPromptWheelPropagation(event: { stopPropagation: () => void }): void {
  event.stopPropagation()
}
