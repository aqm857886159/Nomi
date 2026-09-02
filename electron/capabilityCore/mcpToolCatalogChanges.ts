type CatalogChangeListener = () => void

const listeners = new Set<CatalogChangeListener>()

/** Subscribe to real MCP catalog source registrations (playbooks and capability projections). */
export function subscribeMcpToolCatalogChanges(listener: CatalogChangeListener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Notify active MCP sessions after a catalog source has registered a new definition. */
export function emitMcpToolCatalogChanged(): void {
  for (const listener of [...listeners]) listener()
}
