/**
 * LLM clientId -> real canvas node id registry.
 *
 * Kept in a tiny module so session cleanup and conversation swapping do not
 * import the full canvas tool executor (which pulls optional 3D planning code).
 */
const clientIdRegistry = new Map<string, string>()

export function registerCanvasToolClientId(clientId: string, nodeId: string): void {
  if (!clientId || !nodeId) return
  clientIdRegistry.set(clientId, nodeId)
}

export function resetClientIdRegistry(): void {
  clientIdRegistry.clear()
}

export function resolveCanvasToolNodeId(id: string): string {
  return clientIdRegistry.get(id) ?? id
}
