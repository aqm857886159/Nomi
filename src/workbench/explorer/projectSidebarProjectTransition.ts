export type ProjectSidebarTransition = {
  lastProjectId: string
  collapse: boolean
}

function normalizeProjectId(projectId: string | null | undefined): string {
  return String(projectId || '').trim()
}

/**
 * Preserve the last real project id across transient loading gaps. A sidebar
 * reset belongs to a project-to-project transition, not first mount or a
 * rerender of the same project.
 */
export function observeProjectSidebarTransition(
  lastProjectId: string,
  projectId: string | null | undefined,
): ProjectSidebarTransition {
  const previous = normalizeProjectId(lastProjectId)
  const next = normalizeProjectId(projectId)
  if (!next) return { lastProjectId: previous, collapse: false }
  return { lastProjectId: next, collapse: Boolean(previous && previous !== next) }
}
