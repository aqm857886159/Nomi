import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { dispatch } from './dispatcher'
import { isSemanticGenerationRoute } from './generationDispatcher'
import type { McpConnectionContext } from './mcpConnectionContext'
import { createMcpGenerationPolicy } from './mcpGenerationPolicy'
import { MCP_GENERATION_TOOL_CATALOG } from './mcpGenerationTools'
import { createMcpProtocol, type McpTransport } from './mcpProtocol'
import { MCP_TOOL_RESOLVER } from './mcpToolCatalog'
import { createProjectLeaseAuthority } from './projectLease'
import { createProjectLeaseStore } from './projectLeaseStore'
import { createProjectSessionAuthority } from './projectSessionAuthority'

const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

const connection: McpConnectionContext = Object.freeze({
  authenticatedClient: 'codex',
  principal: 'mcp:codex',
  sessionId: 'mcp-session:dispatch-1',
  connectionNonce: 'connection-dispatch-1',
})

type McpFrame = {
  result?: {
    content?: Array<{ text?: string }>
    isError?: boolean
    structuredContent?: { nomiOutcome?: Record<string, unknown> }
  }
}

async function callMcpTool(
  invoke: McpTransport['invoke'],
  name: string,
  args: Record<string, unknown>,
): Promise<McpFrame> {
  return new Promise((resolve) => {
    const protocol = createMcpProtocol({
      invoke,
      isAppOpen: () => false,
      send: (message) => resolve(message as McpFrame),
    })
    protocol.handleIncoming({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name, arguments: args },
    })
  })
}

function makeProjectSession(options: { generationEnabled?: boolean } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-project-session-dispatch-'))
  tempDirs.push(dir)
  const identity = {
    projectId: 'project-1',
    immutableProjectUuid: 'uuid-1',
    projectGeneration: 1,
    canonicalRootDigest: 'root-digest-1',
    manifestDigest: 'manifest-audit-1',
  }
  const generationPolicy = createMcpGenerationPolicy({
    env: { NOMI_MCP_GENERATION_SINGLE_SHOT_V1: options.generationEnabled ? '1' : '' },
    checkpoints: options.generationEnabled
      ? { p0Passed: true, p2Passed: true, p3Passed: true }
      : {},
  })
  const leaseAuthority = createProjectLeaseAuthority({
    macKey: 'dispatch-authority-key',
    store: createProjectLeaseStore({ filePath: path.join(dir, 'leases.json'), macKey: 'dispatch-store-key' }),
    verifyProjectIdentity: async () => ({
      projectId: identity.projectId,
      immutableProjectUuid: identity.immutableProjectUuid,
      projectGeneration: identity.projectGeneration,
      canonicalRootDigest: identity.canonicalRootDigest,
    }),
  })
  return {
    generationPolicy,
    authority: createProjectSessionAuthority({
      leaseAuthority,
      generationPolicy,
      resolveProjectSelection: async () => identity,
    }),
  }
}

describe('generic project-session route', () => {
  it('dispatches nomi_session_open before generation policy while the generation flag is off', async () => {
    const projectSession = makeProjectSession()
    const runTask = vi.fn()

    const opened = await dispatch('nomi_session_open', {
      bootstrap: { mode: 'current_project' },
    }, {
      runTask,
      makeGateway: vi.fn(),
      productionRuns: {},
      generationPolicy: projectSession.generationPolicy,
      projectSession: { authority: projectSession.authority, connection },
    } as never)

    expect(opened).toMatchObject({
      protocolVersion: 2,
      projectId: 'project-1',
      effectiveScope: expect.arrayContaining(['canvas:read', 'canvas:write', 'document:read', 'document:write']),
    })
    expect(runTask).not.toHaveBeenCalled()
    expect(isSemanticGenerationRoute('nomi_session_open')).toBe(false)
  })

  it('owns the tool catalog outside the generation-only catalog and exposes no client nonce or scope input', () => {
    expect(MCP_GENERATION_TOOL_CATALOG.map((tool) => tool.name)).not.toContain('nomi_session_open')
    const sessionTool = MCP_TOOL_RESOLVER.resolve('nomi_session_open')
    expect(sessionTool).toBeDefined()
    expect(sessionTool?.inputSchema).toEqual({
      type: 'object',
      properties: {
        projectSelectionHandle: { type: 'string' },
        bootstrap: {
          type: 'object',
          properties: { mode: { type: 'string', enum: ['current_project'] } },
          additionalProperties: false,
        },
      },
      additionalProperties: false,
    })
  })

  it('uses the cohesive project session for semantic leases and never accepts tool-supplied scope expansion', async () => {
    const projectSession = makeProjectSession({ generationEnabled: true })
    const generationContext = vi.fn(async (params: Record<string, unknown>) => params)
    const generationPlanning = vi.fn()
    const opened = await projectSession.authority.open({ bootstrap: { mode: 'current_project' } }, connection)
    const ctx = {
      runTask: vi.fn(),
      makeGateway: vi.fn(),
      productionRuns: {},
      generationPolicy: projectSession.generationPolicy,
      generationContext,
      generationPlanning,
      projectSession: { authority: projectSession.authority, connection },
    }

    await expect(dispatch('nomi_get_generation_context', {
      projectId: 'project-1',
      leaseHandle: opened.leaseHandle,
      scopeSet: ['generation:submit'],
    }, ctx as never)).resolves.toMatchObject({ projectId: 'project-1' })
    expect(generationContext).toHaveBeenCalledTimes(1)

    await expect(dispatch('nomi_start_generation', {
      projectId: 'project-1',
      leaseHandle: opened.leaseHandle,
      scopeSet: ['generation:submit'],
    }, ctx as never)).rejects.toMatchObject({ code: 'project_scope_changed' })
    expect(generationPlanning).not.toHaveBeenCalled()
  })

  it('does not own canvas.read after the verified B4 transport cutover', async () => {
    const makeGateway = vi.fn()
    await expect(dispatch('canvas.read', { projectId: 'project-1' }, {
      runTask: vi.fn(),
      makeGateway,
      productionRuns: {},
      origin: { host: 'codex' },
    } as never)).rejects.toThrow(/未知方法.*canvas\.read/i)
    expect(makeGateway).not.toHaveBeenCalled()
  })

  it('maps an unknown session-open authority failure to one fixed typed whole-wire error', async () => {
    const sentinel = 'secret-open-EACCES-/Users/private/project-leases.json'
    const projectSession = makeProjectSession()
    const authority = {
      ...projectSession.authority,
      open: vi.fn(async () => { throw new Error(sentinel) }),
    }
    const ctx = {
      runTask: vi.fn(),
      makeGateway: vi.fn(),
      productionRuns: {},
      projectSession: { authority, connection },
    }

    const frame = await callMcpTool(
      (method, params) => dispatch(method, params, ctx as never),
      'nomi_session_open',
      { bootstrap: { mode: 'current_project' } },
    )

    expect(frame.result).toMatchObject({
      isError: true,
      structuredContent: {
        nomiOutcome: {
          errorCode: 'project_session_unavailable',
          message: 'Project session is unavailable',
        },
      },
    })
    expect(JSON.stringify(frame)).not.toContain(sentinel)
  })
})
