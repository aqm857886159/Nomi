import { describe, expect, it, vi } from 'vitest'

import { createCurrentProjectResolver, CurrentProjectUnavailableError } from './currentProjectResolver'

const record = {
  id: 'project-1',
  name: '短片 A',
  version: 2 as const,
  createdAt: 1,
  updatedAt: 2,
  savedAt: 2,
  revision: 7,
  immutableProjectUuid: 'immutable-project-uuid-1',
  projectGeneration: 3,
  lastKnownRootPath: '/projects/short-film-a',
  payload: {},
}

describe('current project resolver', () => {
  it('derives the current project identity from main-process state, not request fields', () => {
    const readProject = vi.fn(() => record)
    const resolver = createCurrentProjectResolver({
      getOpenProjectId: () => 'project-1',
      readProject,
      randomId: (() => {
        let index = 0
        return () => `server-id-${++index}`
      })(),
    })

    const result = resolver({ client: 'codex', clientSessionNonce: 'client-session-1' })

    expect(readProject).toHaveBeenCalledWith('project-1')
    expect(result).toMatchObject({
      projectId: 'project-1',
      immutableProjectUuid: 'immutable-project-uuid-1',
      projectGeneration: 3,
      leasePrincipal: 'mcp:codex',
      sessionId: 'mcp:codex:client-session-1',
      serverNonce: 'server-id-1',
      connectionNonce: 'server-id-2',
    })
    expect(result.canonicalRootDigest).toMatch(/^[a-f0-9]{64}$/)
    expect(result.manifestDigest).toMatch(/^[a-f0-9]{64}$/)
  })

  it('fails closed when no project is open or the manifest has no immutable identity', () => {
    const resolver = createCurrentProjectResolver({
      getOpenProjectId: () => '',
      readProject: vi.fn(() => record),
    })
    expect(() => resolver({ client: 'claude', clientSessionNonce: 'session' }))
      .toThrow(CurrentProjectUnavailableError)

    const missingIdentity = createCurrentProjectResolver({
      getOpenProjectId: () => 'project-1',
      readProject: vi.fn(() => ({ ...record, immutableProjectUuid: undefined })),
    })
    expect(() => missingIdentity({ client: 'claude', clientSessionNonce: 'session' }))
      .toThrow(CurrentProjectUnavailableError)
  })
})
