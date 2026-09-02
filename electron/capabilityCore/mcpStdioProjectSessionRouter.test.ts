import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { dispatch } from './dispatcher'
import { createHeadlessCanvasReadExecutionRuntime } from './canvasReadExecutionRuntime'
import { createMcpCanvasReadTransportAdapter } from './canvasReadTransportAdapters'
import {
  bindMcpConnectionContext,
  createMcpConnectionContext,
  getMcpConnectionAttestation,
  type McpConnectionContext,
} from './mcpConnectionContext'
import { createMcpGenerationPolicy } from './mcpGenerationPolicy'
import {
  createProjectSessionRuntime,
  createVerifiedProjectSessionBinding,
} from './projectSessionRuntime'
import {
  createMcpStdioProjectSessionRouter,
  type ProjectSessionBinding,
} from './mcpStdioProjectSessionRouter'
import { CAPABILITY_DIR_ENV, ensureToken, signMcpClient } from './security'

const tempDirs: string[] = []

afterEach(() => {
  delete process.env[CAPABILITY_DIR_ENV]
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe('MCP stdio project-session router', () => {
  it('wires production direct canvas reads to the headless executor before legacy dispatch', () => {
    const source = fs.readFileSync(new URL('./mcpStdioServer.ts', import.meta.url), 'utf8')
    expect(source).toContain('const canvasReadExecutionRuntime = createHeadlessCanvasReadExecutionRuntime()')
    expect(source).toContain('createMcpCanvasReadTransportAdapter({')
    expect(source).toContain('executor: canvasReadExecutionRuntime.executor')
    expect(source).toContain('.tryExecute(routedMethod, routedParams')
  })

  it('keeps one secret-derived transport connection across both RPC→direct and direct→RPC route flips', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-stdio-route-flip-'))
    tempDirs.push(dir)
    process.env[CAPABILITY_DIR_ENV] = path.join(dir, 'capability')
    ensureToken()
    const proof = signMcpClient('codex')!
    const secret = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
    const stdioConnection = createMcpConnectionContext({
      client: 'codex',
      proof,
      randomSecret: () => secret,
    })
    const guiConnection = bindMcpConnectionContext({
      client: 'codex',
      proof,
      connectionAttestation: getMcpConnectionAttestation(stdioConnection),
    })
    expect(guiConnection).toEqual(stdioConnection)
    expect(guiConnection).not.toBe(stdioConnection)
    const identity = {
      projectId: 'project-1',
      immutableProjectUuid: 'project-uuid-1',
      projectGeneration: 1,
      canonicalRootPath: '/real/project-1',
      canonicalRootDigest: 'root-digest-1',
    }
    const record = {
      id: identity.projectId,
      name: 'Project 1',
      version: 2,
      createdAt: 1,
      updatedAt: 1,
      savedAt: 1,
      revision: 1,
      immutableProjectUuid: identity.immutableProjectUuid,
      projectGeneration: identity.projectGeneration,
      payload: {},
    }
    const generationPolicy = createMcpGenerationPolicy({ env: {} })
    const runtime = () => createProjectSessionRuntime({
      generationPolicy,
      leaseFilePath: path.join(dir, 'project-leases-v2'),
      leaseMacKey: 'route-flip-lease-key',
      leaseStoreMacKey: 'route-flip-store-key',
      getOpenProjectSelection: () => null,
      resolveProjectRoot: (projectId) => projectId === identity.projectId ? identity.canonicalRootPath : null,
      ensureProjectIdentity: async () => identity,
      readProject: (projectId) => projectId === identity.projectId ? record as never : null,
      isServerAllowlisted: () => false,
    })
    const stdioRuntime = runtime()
    const guiRuntime = runtime()
    const stdioSession = createVerifiedProjectSessionBinding(stdioRuntime, stdioConnection)
    const guiSession = createVerifiedProjectSessionBinding(guiRuntime, guiConnection)
    const gateway = { readDoc: vi.fn(async () => ({ nodes: [], edges: [], groups: [], selectedNodeIds: [] })) }
    const canvasReadExecutionRuntime = createHeadlessCanvasReadExecutionRuntime({
      resolveProjectIdentity: async () => identity,
      readCanvas: () => ({ nodes: [], edges: [], groups: [], selectedNodeIds: [] }),
    })
    const baseContext = {
      runTask: vi.fn(),
      makeGateway: vi.fn(() => gateway),
      productionRuns: {},
      generationPolicy,
      origin: { host: 'codex' as const },
    }
    let guiIsLive = true
    const viaRpc = vi.fn(async (_instance, method: string, params: Record<string, unknown>, routedConnection: McpConnectionContext) => {
      expect(routedConnection).toBe(stdioConnection)
      const canvasRead = await createMcpCanvasReadTransportAdapter({
        projectSession: guiSession,
        executor: canvasReadExecutionRuntime.executor,
      }).tryExecute(method, params)
      if (canvasRead.handled) return canvasRead.result
      return dispatch(method, params, { ...baseContext, projectSession: guiSession } as never)
    })
    const direct = vi.fn(async (method: string, params: Record<string, unknown>, routedSession: ProjectSessionBinding) => {
      expect(routedSession).toBe(stdioSession)
      const canvasRead = await createMcpCanvasReadTransportAdapter({
        projectSession: routedSession,
        executor: canvasReadExecutionRuntime.executor,
      }).tryExecute(method, params)
      if (canvasRead.handled) return canvasRead.result
      return dispatch(method, params, { ...baseContext, projectSession: routedSession } as never)
    })
    const invoke = createMcpStdioProjectSessionRouter({
      projectSession: stdioSession,
      readLiveInstance: () => guiIsLive ? { port: 1 } : null,
      invokeViaRpc: viaRpc,
      invokeDirect: direct,
    })

    const rpcSelection = await guiRuntime.authority.issueProjectSelection('created_project', 'project-1', guiConnection)
    const rpcOpened = await invoke('nomi_session_open', {
      projectSelectionHandle: rpcSelection.token,
    }) as { leaseHandle: string }
    const rpcLeaseClaims = JSON.parse(Buffer.from(rpcOpened.leaseHandle, 'base64url').toString('utf8')) as Record<string, unknown>
    expect(JSON.stringify(rpcSelection)).not.toContain(secret)
    expect(rpcLeaseClaims).not.toHaveProperty('connectionAttestation')
    expect(JSON.stringify(rpcLeaseClaims)).not.toContain(secret)
    guiIsLive = false
    const directRead = await invoke('canvas.read', {
      leaseHandle: rpcOpened.leaseHandle,
      projectId: 'project-1',
    })

    const directSelection = await stdioRuntime.authority.issueProjectSelection(
      'created_project',
      'project-1',
      stdioConnection,
    )
    const directOpened = await invoke('nomi_session_open', {
      projectSelectionHandle: directSelection.token,
    }) as { leaseHandle: string }
    const directLeaseClaims = JSON.parse(Buffer.from(directOpened.leaseHandle, 'base64url').toString('utf8')) as Record<string, unknown>
    expect(JSON.stringify(directSelection)).not.toContain(secret)
    expect(directLeaseClaims).not.toHaveProperty('connectionAttestation')
    expect(JSON.stringify(directLeaseClaims)).not.toContain(secret)
    guiIsLive = true
    const rpcRead = await invoke('canvas.read', {
      leaseHandle: directOpened.leaseHandle,
      projectId: 'project-1',
    })

    expect(directRead).toEqual({ nodes: [], edges: [], groups: [], selectedNodeIds: [] })
    expect(rpcRead).toEqual({ nodes: [], edges: [], groups: [], selectedNodeIds: [] })
    expect(viaRpc).toHaveBeenCalledTimes(2)
    expect(direct).toHaveBeenCalledTimes(2)
  })
})
