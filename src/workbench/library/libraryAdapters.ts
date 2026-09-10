import type { LocalProjectSummary } from './localProjectStore'
import { matchesLibraryQuery } from './libraryDiscovery'

export function filterProjectLibraryItems(projects: readonly LocalProjectSummary[], query: string): LocalProjectSummary[] {
  return projects.filter((project) => matchesLibraryQuery({
    title: project.name,
    // Search only user-facing identity/source labels; never index absolute
    // filesystem paths into the renderer discovery surface.
    keywords: [project.source ?? ''],
  }, query))
}
