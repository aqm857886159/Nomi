import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { CANVAS_READ_CAPABILITY } from '../shared/agentCapabilities/canvasRead'
import { CANVAS_WRITE_CAPABILITY } from '../shared/agentCapabilities/canvasWrite'
import { DOCUMENT_READ_CAPABILITY } from '../shared/agentCapabilities/documentRead'
import { DOCUMENT_WRITE_CAPABILITY } from '../shared/agentCapabilities/documentWrite'
import type { McpConnectionContext } from './mcpConnectionContext'
import { createMcpGenerationPolicy } from './mcpGenerationPolicy'
import { createProjectLeaseAuthority } from './projectLease'
import { createProjectLeaseStore } from './projectLeaseStore'
import {
  ProjectSessionRequestError,
  createProjectSessionAuthority,
  type ProjectSelectionResolver,
} from './projectSessionAuthority'

const tempDirs: string[] = []

const connection: McpConnectionContext = Object.freeze({
  authenticatedClient: 'codex',
  principal: 'mcp:codex',
  sessionId: 'mcp-session:session-1',
  connectionNonce: 'connection-1',
})

const foreignConnection: McpConnectionContext = Object.freeze({
  authenticatedClient: 'codex',
  principal: 'mcp:codex',
  sessionId: 'mcp-session:session-2',
  connectionNonce: 'connection-2',
})

const identity = {
  projectId: 'project-1',
  immutableProjectUuid: 'uuid-1',
  projectGeneration: 3,
  canonicalRootDigest: 'root-digest-1',
  manifestDigest: 'manifest-audit-1',
}

function makeSession(options: { generationEnabled?: boolean } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-project-session-'))
  tempDirs.push(dir)
  const verifyProjectIdentity = vi.fn(async () => ({
    projectId: identity.projectId,
    immutableProjectUuid: identity.immutableProjectUuid,
    projectGeneration: identity.projectGeneration,
    canonicalRootDigest: identity.canonicalRootDigest,
  }))
  const leaseAuthority = createProjectLeaseAuthority({
    macKey: 'session-authority-key',
    keyId: 'session-authority-v2',
    store: createProjectLeaseStore({
      filePath: path.join(dir, 'leases.json'),
      macKey: 'session-store-key',
      now: () => '2026-08-23T00:00:00.000Z',
    }),
    verifyProjectIdentity,
    now: () => '2026-08-23T00:00:00.000Z',
    randomId: (() => {
      let index = 0
      return () => `session-id-${++index}`
    })(),
  })
  const resolveProjectSelection: ProjectSelectionResolver = vi.fn(async (request) => {
    if (request.source === 'current_project') return identity
    if (request.projectHint === identity.projectId) return identity
    throw new Error('selection denied')
  })
  const generationPolicy = createMcpGenerationPolicy({
    env: { NOMI_MCP_GENERATION_SINGLE_SHOT_V1: options.generationEnabled ? '1' : '' },
    checkpoints: options.generationEnabled
      ? { p0Passed: true, p2Passed: true, p3Passed: true }
      : {},
  })
  return {
    leaseAuthority,
    resolveProjectSelection,
    session: createProjectSessionAuthority({
      leaseAuthority,
      resolveProjectSelection,
      generationPolicy,
    }),
  }
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe('ProjectSessionAuthority', () => {
  it('opens a canvas-read-only session while the generation rollout flag is off', async () => {
    const { session, resolveProjectSelection } = makeSession()

    const opened = await session.open({ bootstrap: { mode: 'current_project' } }, connection)

    expect(opened).toMatchObject({
      protocolVersion: 2,
      projectId: 'project-1',
      sessionId: connection.sessionId,
      effectiveScope: expect.arrayContaining([
        CANVAS_READ_CAPABILITY.requiredScope,
        CANVAS_WRITE_CAPABILITY.requiredScope,
        DOCUMENT_READ_CAPABILITY.requiredScope,
        DOCUMENT_WRITE_CAPABILITY.requiredScope,
      ]),
    })
    await expect(session.verifyLease(opened.leaseHandle, {
      connection,
      scope: CANVAS_READ_CAPABILITY.requiredScope,
      projectHint: 'project-1',
    })).resolves.toMatchObject({ projectId: 'project-1' })
    await expect(session.verifyLease(opened.leaseHandle, {
      connection,
      scope: 'generation:submit',
    })).rejects.toThrow(/scope/i)
    expect(resolveProjectSelection).toHaveBeenCalledWith({
      source: 'current_project',
      connection,
      projectHint: undefined,
    })
  })

  it('adds only server-derived non-submit generation scopes when rollout is enabled', async () => {
    const { session } = makeSession({ generationEnabled: true })

    const opened = await session.open({ bootstrap: { mode: 'current_project' } }, connection)

    expect(opened.effectiveScope).toEqual(expect.arrayContaining([
      CANVAS_READ_CAPABILITY.requiredScope,
      'context:read',
      'generation:create',
      'generation:plan',
      'generation:preview',
      'generation:read',
      'generation:events',
      'generation:gate',
      'generation:control',
      'generation:reconcile',
    ]))
    expect(opened.effectiveScope).not.toContain('generation:submit')
  })

  it('rejects session, principal, nonce, path, project, and scope fields supplied as tool arguments', async () => {
    const { session, resolveProjectSelection } = makeSession()
    const forged = [
      { bootstrap: { mode: 'current_project', clientSessionNonce: 'client-picked' } },
      { bootstrap: { mode: 'current_project', connectionNonce: 'client-picked' } },
      { bootstrap: { mode: 'current_project', sessionId: 'client-picked' } },
      { bootstrap: { mode: 'current_project', principal: 'mcp:claude' } },
      { bootstrap: { mode: 'current_project', scopeSet: ['generation:submit'] } },
      { bootstrap: { mode: 'current_project' }, projectId: 'foreign-project' },
      { bootstrap: { mode: 'current_project' }, path: '/tmp/foreign-project' },
    ]

    for (const request of forged) {
      await expect(session.open(request, connection)).rejects.toThrow(ProjectSessionRequestError)
    }
    expect(resolveProjectSelection).not.toHaveBeenCalled()
  })

  it('issues created-project selection handles that are valid only on the issuing connection', async () => {
    const { session, resolveProjectSelection } = makeSession()
    const selection = await session.issueProjectSelection('created_project', 'project-1', connection)

    expect(resolveProjectSelection).toHaveBeenCalledWith({
      source: 'created_project',
      connection,
      projectHint: 'project-1',
    })
    await expect(session.open({ projectSelectionHandle: selection.token }, foreignConnection))
      .rejects.toThrow(/connection/i)

    const opened = await session.open({ projectSelectionHandle: selection.token }, connection)
    expect(opened).toMatchObject({
      projectId: 'project-1',
      sessionId: connection.sessionId,
      effectiveScope: expect.arrayContaining([
        CANVAS_READ_CAPABILITY.requiredScope,
        CANVAS_WRITE_CAPABILITY.requiredScope,
        DOCUMENT_READ_CAPABILITY.requiredScope,
        DOCUMENT_WRITE_CAPABILITY.requiredScope,
      ]),
    })
    expect(resolveProjectSelection).toHaveBeenCalledTimes(1)
  })
})
