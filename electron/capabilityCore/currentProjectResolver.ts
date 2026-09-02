import crypto from 'node:crypto'

import type { WorkspaceProjectIdentity } from '../workspace/workspaceProjectIdentity'
import type { WorkspaceProjectRecordV2 } from '../workspace/workspaceTypes'
import type { McpConnectionContext } from './mcpConnectionContext'
import type { ProjectSelectionResolver } from './projectSessionAuthority'

export type CurrentProjectSelection = Readonly<{
  projectId: string
  immutableProjectUuid: string
  projectGeneration: number
  canonicalRootDigest: string
}>

export type ProjectSelectionResolverDeps = Readonly<{
  /** Exact frozen registry object for the committed Surface lifecycle; never clone it. */
  getOpenProjectSelection: () => CurrentProjectSelection | null
  resolveProjectRoot: (projectId: string) => string | null
  ensureProjectIdentity: (actualRootPath: string) => Promise<WorkspaceProjectIdentity>
  readProject: (projectId: string) => WorkspaceProjectRecordV2 | null
  isServerAllowlisted: (projectId: string, connection: McpConnectionContext) => boolean
}>

export class ProjectSelectionUnavailableError extends Error {
  constructor(
    message = 'The current MCP connection is not authorized to select that project',
    readonly code: 'project_selection_denied' | 'project_binding_stale' = 'project_selection_denied',
  ) {
    super(message)
    this.name = 'ProjectSelectionUnavailableError'
  }
}

function digest(value: unknown): string {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function requiredHint(value: string | undefined): string {
  const projectId = value?.trim() ?? ''
  if (!projectId) throw new ProjectSelectionUnavailableError('An authorized project hint is required')
  return projectId
}

function authorizedProject(
  request: Parameters<ProjectSelectionResolver>[0],
  deps: ProjectSelectionResolverDeps,
): Readonly<{
  projectId: string
  committedSelection?: CurrentProjectSelection
}> {
  if (request.source === 'current_project') {
    const committedSelection = deps.getOpenProjectSelection()
    const projectId = committedSelection?.projectId.trim() ?? ''
    if (!projectId || !committedSelection) {
      throw new ProjectSelectionUnavailableError('Open a project in Nomi before using current_project')
    }
    return { projectId, committedSelection }
  }

  const projectId = requiredHint(request.projectHint)
  if (request.source === 'server_allowlist'
    && !deps.isServerAllowlisted(projectId, request.connection)) {
    throw new ProjectSelectionUnavailableError()
  }
  // `created_project` is reachable only from the server-owned project.create
  // result path, which issues a handle immediately on this same connection.
  return { projectId }
}

function matchesCommittedSelection(
  identity: WorkspaceProjectIdentity,
  selection: CurrentProjectSelection,
): boolean {
  return identity.projectId === selection.projectId
    && identity.immutableProjectUuid === selection.immutableProjectUuid
    && identity.projectGeneration === selection.projectGeneration
    && identity.canonicalRootDigest === selection.canonicalRootDigest
}

/**
 * Resolve only server-authorized project-selection sources. Project existence
 * alone is deliberately insufficient; identity verification happens only
 * after the source policy has selected a project id.
 */
export function createProjectSelectionResolver(deps: ProjectSelectionResolverDeps): ProjectSelectionResolver {
  return async (request) => {
    const { projectId, committedSelection } = authorizedProject(request, deps)
    const actualRootPath = deps.resolveProjectRoot(projectId)
    if (!actualRootPath) throw new ProjectSelectionUnavailableError('The authorized project root is unavailable')
    const identity = await deps.ensureProjectIdentity(actualRootPath)
    if (identity.projectId !== projectId) {
      throw new ProjectSelectionUnavailableError('The authorized project root belongs to another project')
    }
    if (committedSelection) {
      // The registry returns one frozen selection object per Surface lifecycle.
      // Identity equality alone cannot distinguish a same-project reload, so
      // require that exact lifecycle object to still be current after await.
      if (deps.getOpenProjectSelection() !== committedSelection
        || !matchesCommittedSelection(identity, committedSelection)) {
        throw new ProjectSelectionUnavailableError(
          'The open project Surface changed while project identity was being verified',
          'project_binding_stale',
        )
      }
    }
    const record = deps.readProject(projectId)
    if (!record || record.id !== projectId) {
      throw new ProjectSelectionUnavailableError('The authorized project manifest is unavailable')
    }
    return Object.freeze({
      projectId,
      immutableProjectUuid: identity.immutableProjectUuid,
      projectGeneration: identity.projectGeneration,
      canonicalRootDigest: identity.canonicalRootDigest,
      // Audit-only evidence captured when the selection is issued. Leases do
      // not compare it on ordinary reads, so revision/updatedAt changes live.
      manifestDigest: digest({
        projectId,
        immutableProjectUuid: identity.immutableProjectUuid,
        projectGeneration: identity.projectGeneration,
        canonicalRootDigest: identity.canonicalRootDigest,
        revision: record.revision,
        updatedAt: record.updatedAt,
      }),
      revocationEpoch: 0,
    })
  }
}
