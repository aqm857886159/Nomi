import { describe, expect, it, vi } from 'vitest'

import type { McpConnectionContext } from './mcpConnectionContext'
import {
  ProjectSelectionUnavailableError,
  createProjectSelectionResolver,
  type CurrentProjectSelection,
} from './currentProjectResolver'

const connection: McpConnectionContext = Object.freeze({
  authenticatedClient: 'codex',
  principal: 'mcp:codex',
  sessionId: 'mcp-session:selection-1',
  connectionNonce: 'connection-selection-1',
})

const identity = {
  projectId: 'project-1',
  immutableProjectUuid: '02b6f485-1238-4ab7-a0f4-5c84be59cd3c',
  projectGeneration: 3,
  canonicalRootPath: '/real/projects/short-film-a',
  canonicalRootDigest: 'root-digest-1',
}

const record = {
  id: 'project-1',
  name: '短片 A',
  version: 2 as const,
  createdAt: 1,
  updatedAt: 2,
  savedAt: 2,
  revision: 7,
  immutableProjectUuid: identity.immutableProjectUuid,
  projectGeneration: 3,
  lastKnownRootPath: '/stale/path-that-is-not-authority',
  payload: {},
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((yes) => {
    resolve = yes
  })
  return { promise, resolve }
}

function makeResolver(options: {
  openProjectId?: string
  openProjectSelection?: null | {
    projectId: string
    immutableProjectUuid: string
    projectGeneration: number
    canonicalRootDigest: string
  }
  allowlisted?: boolean
} = {}) {
  const resolveProjectRoot = vi.fn((projectId: string) => (
    projectId === 'project-1' ? '/real/projects/short-film-a' : null
  ))
  const ensureProjectIdentity = vi.fn(async () => identity)
  const readProject = vi.fn(() => record)
  const isServerAllowlisted = vi.fn(() => options.allowlisted === true)
  const openProjectSelection = options.openProjectSelection === null
    ? null
    : options.openProjectSelection ?? {
      projectId: options.openProjectId ?? identity.projectId,
      immutableProjectUuid: identity.immutableProjectUuid,
      projectGeneration: identity.projectGeneration,
      canonicalRootDigest: identity.canonicalRootDigest,
    }
  return {
    resolveProjectRoot,
    ensureProjectIdentity,
    readProject,
    isServerAllowlisted,
    resolver: createProjectSelectionResolver({
      getOpenProjectSelection: () => openProjectSelection,
      resolveProjectRoot,
      ensureProjectIdentity,
      readProject,
      isServerAllowlisted,
    }),
  }
}

describe('project selection resolver', () => {
  it('authorizes current_project only from the main-process binding and fresh real-root identity', async () => {
    const { resolver, resolveProjectRoot, ensureProjectIdentity } = makeResolver()

    const result = await resolver({ source: 'current_project', connection, projectHint: undefined })

    expect(resolveProjectRoot).toHaveBeenCalledWith('project-1')
    expect(ensureProjectIdentity).toHaveBeenCalledWith('/real/projects/short-film-a')
    expect(result).toMatchObject({
      projectId: 'project-1',
      immutableProjectUuid: identity.immutableProjectUuid,
      projectGeneration: 3,
      canonicalRootDigest: 'root-digest-1',
      revocationEpoch: 0,
    })
    expect(result.manifestDigest).toMatch(/^[a-f0-9]{64}$/)
    expect(result).not.toHaveProperty('leasePrincipal')
    expect(result).not.toHaveProperty('sessionId')
    expect(result).not.toHaveProperty('connectionNonce')
  })

  it('authorizes a just-created project by its server-owned source, independent of the GUI binding', async () => {
    const { resolver } = makeResolver({ openProjectSelection: null })

    await expect(resolver({ source: 'created_project', connection, projectHint: 'project-1' }))
      .resolves.toMatchObject({ projectId: 'project-1' })
  })

  it('does not treat project existence as authorization for a non-current project', async () => {
    const { resolver, ensureProjectIdentity } = makeResolver({ openProjectSelection: null })

    await expect(resolver({ source: 'server_allowlist', connection, projectHint: 'project-1' }))
      .rejects.toThrow(ProjectSelectionUnavailableError)
    expect(ensureProjectIdentity).not.toHaveBeenCalled()
  })

  it('accepts an existing project only through an explicit server allowlist policy', async () => {
    const { resolver, isServerAllowlisted } = makeResolver({ openProjectSelection: null, allowlisted: true })

    await expect(resolver({ source: 'server_allowlist', connection, projectHint: 'project-1' }))
      .resolves.toMatchObject({ projectId: 'project-1' })
    expect(isServerAllowlisted).toHaveBeenCalledWith('project-1', connection)
  })

  it('fails closed before identity verification when no authorized target is present', async () => {
    const { resolver, ensureProjectIdentity } = makeResolver({ openProjectSelection: null })

    await expect(resolver({ source: 'current_project', connection, projectHint: undefined }))
      .rejects.toThrow(ProjectSelectionUnavailableError)
    await expect(resolver({ source: 'created_project', connection, projectHint: undefined }))
      .rejects.toThrow(ProjectSelectionUnavailableError)
    expect(ensureProjectIdentity).not.toHaveBeenCalled()
  })

  it('rejects a same-id replacement whose fresh UUID, generation, or root no longer matches the committed surface', async () => {
    const committed = {
      projectId: identity.projectId,
      immutableProjectUuid: identity.immutableProjectUuid,
      projectGeneration: identity.projectGeneration,
      canonicalRootDigest: identity.canonicalRootDigest,
    }
    const variants = [
      { immutableProjectUuid: '00000000-0000-4000-8000-000000000099' },
      { projectGeneration: identity.projectGeneration + 1 },
      { canonicalRootDigest: 'replacement-root' },
    ]

    for (const replacement of variants) {
      const test = makeResolver({ openProjectSelection: committed })
      test.ensureProjectIdentity.mockResolvedValueOnce({ ...identity, ...replacement })
      await expect(test.resolver({ source: 'current_project', connection, projectHint: undefined }))
        .rejects.toMatchObject({ code: 'project_binding_stale' })
    }
  })

  it('rejects a current_project selection if Surface suspends while identity verification is pending', async () => {
    let current: CurrentProjectSelection | null = {
      projectId: identity.projectId,
      immutableProjectUuid: identity.immutableProjectUuid,
      projectGeneration: identity.projectGeneration,
      canonicalRootDigest: identity.canonicalRootDigest,
    }
    const gate = deferred<typeof identity>()
    const resolver = createProjectSelectionResolver({
      getOpenProjectSelection: () => current,
      resolveProjectRoot: () => identity.canonicalRootPath,
      ensureProjectIdentity: () => gate.promise,
      readProject: () => record,
      isServerAllowlisted: () => false,
    })
    const resolving = resolver({ source: 'current_project', connection, projectHint: undefined })
    current = null
    gate.resolve(identity)

    await expect(resolving).rejects.toMatchObject({ code: 'project_binding_stale' })
  })

  it('rejects an identical same-project Surface reload while identity verification is pending', async () => {
    const committed: CurrentProjectSelection = Object.freeze({
      projectId: identity.projectId,
      immutableProjectUuid: identity.immutableProjectUuid,
      projectGeneration: identity.projectGeneration,
      canonicalRootDigest: identity.canonicalRootDigest,
    })
    let current: CurrentProjectSelection | null = committed
    const gate = deferred<typeof identity>()
    const resolver = createProjectSelectionResolver({
      getOpenProjectSelection: () => current,
      resolveProjectRoot: () => identity.canonicalRootPath,
      ensureProjectIdentity: () => gate.promise,
      readProject: () => record,
      isServerAllowlisted: () => false,
    })
    const resolving = resolver({ source: 'current_project', connection, projectHint: undefined })
    current = Object.freeze({ ...committed })
    gate.resolve(identity)

    await expect(resolving).rejects.toMatchObject({ code: 'project_binding_stale' })
  })
})
