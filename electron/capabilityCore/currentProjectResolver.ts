import crypto from 'node:crypto'
import path from 'node:path'

import type { WorkspaceProjectRecordV2 } from '../workspace/workspaceTypes'

export type CurrentProjectResolverClient = 'claude' | 'codex' | 'cursor'

export type CurrentProjectIdentity = {
  projectId: string
  immutableProjectUuid: string
  projectGeneration: number
  canonicalRootDigest: string
  manifestDigest: string
  revocationEpoch: number
  leasePrincipal: string
  sessionId: string
  connectionNonce: string
  serverNonce: string
}

export type CurrentProjectResolverDeps = {
  getOpenProjectId: () => string
  readProject: (projectId: string) => WorkspaceProjectRecordV2 | null
  randomId?: () => string
}

export class CurrentProjectUnavailableError extends Error {
  readonly code = 'current_project_required'

  constructor(message = 'Open a project in Nomi before using the generation workspace') {
    super(message)
    this.name = 'CurrentProjectUnavailableError'
  }
}

function digest(value: unknown): string {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

export function deriveProjectIdentityDigests(record: WorkspaceProjectRecordV2): {
  canonicalRootDigest: string
  manifestDigest: string
} {
  const rootPathValue = record.lastKnownRootPath
  if (!rootPathValue) throw new CurrentProjectUnavailableError('The current project root is unavailable')
  return {
    canonicalRootDigest: digest(path.resolve(rootPathValue)),
    manifestDigest: digest({
      id: record.id,
      immutableProjectUuid: record.immutableProjectUuid,
      projectGeneration: record.projectGeneration,
      revision: record.revision,
      updatedAt: record.updatedAt,
    }),
  }
}

function requireIdentity(record: WorkspaceProjectRecordV2 | null, projectId: string): WorkspaceProjectRecordV2 {
  if (!record || record.id !== projectId || !record.immutableProjectUuid || !Number.isInteger(record.projectGeneration)
    || !record.lastKnownRootPath) {
    throw new CurrentProjectUnavailableError('The current project is unavailable or needs to be reopened')
  }
  return record
}

export function createCurrentProjectResolver(deps: CurrentProjectResolverDeps) {
  const randomId = deps.randomId ?? (() => crypto.randomUUID())

  return ({ client, clientSessionNonce }: { client: CurrentProjectResolverClient; clientSessionNonce: string }): CurrentProjectIdentity => {
    const projectId = deps.getOpenProjectId().trim()
    if (!projectId) throw new CurrentProjectUnavailableError()
    const record = requireIdentity(deps.readProject(projectId), projectId)
    const digests = deriveProjectIdentityDigests(record)
    const serverNonce = randomId()
    return {
      projectId,
      immutableProjectUuid: record.immutableProjectUuid!,
      projectGeneration: record.projectGeneration!,
      canonicalRootDigest: digests.canonicalRootDigest,
      manifestDigest: digests.manifestDigest,
      revocationEpoch: 0,
      leasePrincipal: `mcp:${client}`,
      sessionId: `mcp:${client}:${clientSessionNonce.trim()}`,
      connectionNonce: randomId(),
      serverNonce,
    }
  }
}
