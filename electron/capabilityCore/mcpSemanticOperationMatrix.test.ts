import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: {
    getName: () => 'Nomi',
    getPath: (name: string) => path.join(os.tmpdir(), `nomi-mcp-semantic-matrix-${name}`),
  },
}))

import { PROJECT_ROOT_ENV, getWorkspaceRepositoryDeps } from '../runtimePaths'
import { SETTINGS_ROOT_ENV } from '../settings/settingsRoot'
import { createWorkspaceProject, readWorkspaceProject, saveWorkspaceProject } from '../workspace/workspaceRepository'
import { ensureWorkspaceProjectIdentity } from '../workspace/workspaceProjectIdentity'
import { CAPABILITY_DIR_ENV, ensureToken, signMcpClient } from './security'
import { createMcpConnectionContext } from './mcpConnectionContext'
import { createMcpGenerationPolicy } from './mcpGenerationPolicy'
import { createProductionProjectSessionRuntime } from './projectSessionRuntime'
import { createMcpProtocol, type McpTransport } from './mcpProtocol'
import { dispatch } from './dispatcher'
import { createDiskGateway } from './gateway'
import { MCP_CAPABILITY_RESOLVER } from './mcpCapabilityProjection'
import { readProjectDocument } from './documentSurface'
import * as projectRepository from '../projects/repository'

const PROJECT_ID = 'semantic-matrix-project'
const tempDirs: string[] = []
const previousEnvironment = {
  capability: process.env[CAPABILITY_DIR_ENV],
  projects: process.env[PROJECT_ROOT_ENV],
  settings: process.env[SETTINGS_ROOT_ENV],
}

type Frame = {
  id?: number | string
  method?: string
  result?: {
    isError?: boolean
    content?: Array<{ type?: string; text?: string }>
    structuredContent?: { nomiOutcome?: Record<string, unknown> } & Record<string, unknown>
  }
  error?: { code?: number; message?: string }
}

type Fault = 'timeout' | 'network'

function restoreEnvironment(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}

function outcomeCode(frame: Frame): unknown {
  return frame.result?.structuredContent?.nomiOutcome?.errorCode
}

async function makeFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-mcp-semantic-matrix-'))
  tempDirs.push(root)
  process.env[CAPABILITY_DIR_ENV] = path.join(root, 'capability')
  process.env[PROJECT_ROOT_ENV] = path.join(root, 'projects')
  process.env[SETTINGS_ROOT_ENV] = path.join(root, 'settings')

  const deps = getWorkspaceRepositoryDeps()
  const projectRoot = path.join(deps.defaultProjectsRoot, 'fixture')
  createWorkspaceProject({
    rootPath: projectRoot,
    record: {
      id: PROJECT_ID,
      name: 'MCP semantic matrix fixture',
      payload: {
        generationCanvas: {
          nodes: [
            { id: 'node-a', kind: 'text', title: 'Initial text', prompt: '原始节点' },
            { id: 'node-b', kind: 'image', title: 'Keep me', prompt: '保留节点' },
          ],
          edges: [],
          groups: [],
          selectedNodeIds: [],
        },
        workbenchDocuments: [{
          id: 'doc-1',
          version: 1,
          title: '语义操作测试文档',
          contentJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '初稿' }] }] },
          updatedAt: 1,
        }, {
          id: 'doc-2',
          version: 1,
          title: '空内容文档',
          contentJson: null,
          updatedAt: 1,
        }, {
          id: 'doc-3',
          version: 1,
          title: '非文本节点文档',
          contentJson: { type: 'unknown', content: 'not-an-array' },
          updatedAt: 1,
        }],
        activeDocumentId: 'doc-1',
      },
    },
  }, deps)

  const identity = await ensureWorkspaceProjectIdentity(projectRoot)
  const committedSelection = Object.freeze({
    projectId: identity.projectId,
    immutableProjectUuid: identity.immutableProjectUuid,
    projectGeneration: identity.projectGeneration,
    canonicalRootDigest: identity.canonicalRootDigest,
  })
  ensureToken()
  const connection = createMcpConnectionContext({
    client: 'codex',
    proof: signMcpClient('codex'),
    randomSecret: () => 'S'.repeat(43),
  })
  const generationPolicy = createMcpGenerationPolicy({ env: {} })
  const runtime = createProductionProjectSessionRuntime({
    generationPolicy,
    getOpenProjectSelection: () => committedSelection,
    isServerAllowlisted: () => false,
  })
  return { deps, connection, generationPolicy, runtime }
}

function makeClient(
  context: Parameters<typeof dispatch>[2],
  fault?: Fault,
) {
  const frames: Frame[] = []
  const waiters: Array<(frame: Frame) => void> = []
  const invoke = vi.fn(async (method: string, params: Record<string, unknown>) => {
    if (method !== 'nomi_session_open' && fault === 'timeout') {
      throw Object.assign(new Error('MCP transport timeout'), { code: 'capability_timeout' })
    }
    if (method !== 'nomi_session_open' && fault === 'network') {
      throw Object.assign(new Error('MCP provider/network boundary failed'), { code: 'capability_execution_failed' })
    }
    return dispatch(method, params, context)
  })
  const send = (frame: unknown) => {
    const message = frame as Frame
    if (message.method === 'elicitation/create') {
      protocol.handleIncoming({
        jsonrpc: '2.0',
        id: message.id,
        result: { action: 'accept', content: { confirm: true } },
      })
      return
    }
    const waiter = waiters.shift()
    if (waiter) waiter(message)
    else frames.push(message)
  }
  const protocol = createMcpProtocol({
    send,
    invoke: invoke as McpTransport['invoke'],
    isAppOpen: () => false,
  })
  async function call(id: number, name: string, args: Record<string, unknown>): Promise<Frame> {
    const response = new Promise<Frame>((resolve) => waiters.push(resolve))
    protocol.handleIncoming({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } })
    return response
  }
  async function initialize(): Promise<Frame> {
    const response = new Promise<Frame>((resolve) => waiters.push(resolve))
    protocol.handleIncoming({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-11-25',
        capabilities: { elicitation: {} },
        clientInfo: { name: 'Codex semantic matrix' },
      },
    })
    return response
  }
  return { call, frames, initialize, invoke, protocol }
}

async function openLease(client: ReturnType<typeof makeClient>): Promise<string> {
  const opened = await client.call(2, 'nomi_session_open', { bootstrap: { mode: 'current_project' } })
  if (opened.result?.isError) throw new Error(`session open failed: ${JSON.stringify(opened)}`)
  const text = opened.result?.content?.find((item) => item.type === 'text')?.text
  const payload = JSON.parse(text || '{}') as { leaseHandle?: string }
  expect(payload.leaseHandle).toEqual(expect.any(String))
  return payload.leaseHandle as string
}

describe('MCP semantic operation production-path matrix', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    restoreEnvironment(CAPABILITY_DIR_ENV, previousEnvironment.capability)
    restoreEnvironment(PROJECT_ROOT_ENV, previousEnvironment.projects)
    restoreEnvironment(SETTINGS_ROOT_ENV, previousEnvironment.settings)
    for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
  })

  it('proves document read/edit H/B/E/T/N through MCP and persisted repository state', async () => {
    const fixture = await makeFixture()
    const baseContext = {
      runTask: vi.fn(),
      makeGateway: (projectId: string) => createDiskGateway(projectId),
      productionRuns: {},
      generationPolicy: fixture.generationPolicy,
      origin: { host: 'codex' as const },
      projectSession: { authority: fixture.runtime.authority, connection: fixture.connection },
    }
    const client = makeClient(baseContext as never)
    await client.initialize()
    const leaseHandle = await openLease(client)

    // H: the MCP call reaches document.write/read and the effect survives a fresh repository read.
    const normal = await client.call(3, 'nomi_document_edit', {
      leaseHandle, projectId: PROJECT_ID, operation: 'append', content: '第二稿 😀',
    })
    expect(normal.result?.isError).not.toBe(true)
    expect(normal.result?.structuredContent).toEqual(expect.objectContaining({ applied: true, revision: expect.any(Number) }))
    const read = await client.call(4, 'nomi_document_read', { leaseHandle, projectId: PROJECT_ID, scope: 'full' })
    expect(read.result?.structuredContent).toEqual({ text: '初稿\n第二稿 😀' })
    const persisted = readWorkspaceProject(PROJECT_ID, fixture.deps)
    expect(JSON.stringify(persisted?.payload)).toContain('第二稿 😀')

    // B: empty content, a max-ish Unicode payload, and a repeated edit are explicit edits at the schema boundary.
    const empty = await client.call(5, 'nomi_document_edit', { leaseHandle, operation: 'append', content: '' })
    expect(empty.result?.isError).toBe(true)
    expect(client.invoke).toHaveBeenCalledTimes(3) // session open + edit + read; the invalid call never invokes dispatch
    const unicode = '重复😀'.repeat(2_048)
    const large = await client.call(6, 'nomi_document_edit', { leaseHandle, operation: 'append', content: unicode })
    expect(large.result?.isError).not.toBe(true)
    const repeated = await client.call(7, 'nomi_document_edit', { leaseHandle, operation: 'append', content: '重复编辑' })
    expect(repeated.result?.isError).not.toBe(true)
    const repeatedAgain = await client.call(8, 'nomi_document_edit', { leaseHandle, operation: 'append', content: '重复编辑' })
    expect(repeatedAgain.result?.isError).not.toBe(true)
    const afterRepeated = await client.call(9, 'nomi_document_read', { leaseHandle, scope: 'full' })
    expect(afterRepeated.result?.structuredContent?.text).toContain('重复编辑\n重复编辑')
    const explicitDocument = await client.call(23, 'nomi_document_read', { leaseHandle, documentId: 'doc-2', scope: 'selection' })
    expect(explicitDocument.result?.structuredContent).toEqual({ text: '' })
    const nonTextDocument = await client.call(24, 'nomi_document_read', { leaseHandle, documentId: 'doc-3', scope: 'full' })
    expect(nonTextDocument.result?.structuredContent).toEqual({ text: '' })
    const emptyAppend = await client.call(29, 'nomi_document_edit', {
      leaseHandle, documentId: 'doc-2', operation: 'append', content: '空文档追加',
    })
    expect(emptyAppend.result?.isError).not.toBe(true)
    const emptyInsert = await client.call(30, 'nomi_document_edit', {
      leaseHandle, documentId: 'doc-3', operation: 'insert', content: '空节点插入',
    })
    expect(emptyInsert.result?.isError).not.toBe(true)
    const fallbackDocument = await client.call(25, 'nomi_document_read', { leaseHandle, documentId: 'missing-document', scope: 'full' })
    expect(fallbackDocument.result?.structuredContent).toEqual(expect.objectContaining({ text: expect.any(String) }))
    const currentRecord = readWorkspaceProject(PROJECT_ID, fixture.deps)!
    saveWorkspaceProject(PROJECT_ID, {
      ...currentRecord,
      payload: { ...(currentRecord.payload as Record<string, unknown>), activeDocumentId: 42 },
    }, fixture.deps)
    const noActiveId = await client.call(31, 'nomi_document_read', { leaseHandle, scope: 'full' })
    expect(noActiveId.result?.structuredContent).toEqual(expect.objectContaining({ text: expect.any(String) }))
    const multiline = await client.call(26, 'nomi_document_edit', {
      leaseHandle, documentId: 'doc-1', operation: 'replace', content: '第一行\n\n第三行',
    })
    expect(multiline.result?.isError).not.toBe(true)
    const inserted = await client.call(28, 'nomi_document_edit', {
      leaseHandle, documentId: 'doc-1', operation: 'insert', content: '插入到开头',
    })
    expect(inserted.result?.isError).not.toBe(true)
    const originalSaveProject = projectRepository.saveProject
    const noRevisionSave = vi.spyOn(projectRepository, 'saveProject').mockImplementation((projectId: string, input: unknown) => ({
      ...originalSaveProject(projectId, input),
      revision: undefined,
    }))
    const noRevision = await client.call(32, 'nomi_document_edit', {
      leaseHandle, documentId: 'doc-1', operation: 'replace', content: 'revision fallback',
    })
    expect(noRevision.result?.structuredContent).toEqual(expect.objectContaining({ applied: true, revision: 0 }))
    noRevisionSave.mockRestore()

    // E: the published document contract has no expectedRevision field; reject stale-revision attempts instead of pretending to support them.
    const stale = await client.call(10, 'nomi_document_edit', {
      leaseHandle, operation: 'replace', content: 'stale', expectedRevision: 1,
    })
    expect(stale.result?.isError).toBe(true)
    expect(outcomeCode(stale)).toBe('capability_input_invalid')

    // T/N: only the MCP invoke boundary is faulted; no internal reducer or final state is injected.
    for (const [id, fault, expected] of [[11, 'timeout', 'capability_timeout'], [12, 'network', 'capability_execution_failed']] as const) {
      const faulty = makeClient(baseContext as never, fault)
      await faulty.initialize()
      const faultyLease = await openLease(faulty)
      const failed = await faulty.call(id, 'nomi_document_edit', { leaseHandle: faultyLease, operation: 'append', content: 'should not persist' })
      expect(failed.result?.isError).toBe(true)
      expect(outcomeCode(failed)).toBe(expected)
      faulty.protocol.dispose()
    }
    saveWorkspaceProject(PROJECT_ID, {
      ...(readWorkspaceProject(PROJECT_ID, fixture.deps) as Record<string, unknown>),
      payload: { workbenchDocuments: [], activeDocumentId: 'doc-1' },
    }, fixture.deps)
    const missingDocument = await client.call(27, 'nomi_document_read', { leaseHandle, scope: 'full' })
    expect(missingDocument.result?.isError).toBe(true)
    expect(outcomeCode(missingDocument)).toBe('document_not_found')
    saveWorkspaceProject(PROJECT_ID, {
      ...((readWorkspaceProject(PROJECT_ID, fixture.deps) as Record<string, unknown>)),
      payload: { activeDocumentId: 'doc-1' },
    }, fixture.deps)
    const missingDocumentNoArray = await client.call(33, 'nomi_document_read', { leaseHandle, scope: 'full' })
    expect(missingDocumentNoArray.result?.isError).toBe(true)
    expect(outcomeCode(missingDocumentNoArray)).toBe('document_not_found')
    expect(() => readProjectDocument('missing-project', undefined, 'full')).toThrow(/project not found/i)
    client.protocol.dispose()
  })

  it('proves destructive canvas maintenance H/B/E/T/N with human confirmation, undo, and disk evidence', async () => {
    const fixture = await makeFixture()
    const baseContext = {
      runTask: vi.fn(),
      makeGateway: (projectId: string) => createDiskGateway(projectId),
      productionRuns: {},
      generationPolicy: fixture.generationPolicy,
      origin: { host: 'codex' as const },
      projectSession: { authority: fixture.runtime.authority, connection: fixture.connection },
    }
    const client = makeClient(baseContext as never)
    await client.initialize()
    const leaseHandle = await openLease(client)

    // H: MCP elicitation confirms the exact destructive operation, then the real disk gateway deletes and restores it.
    const deleted = await client.call(13, 'nomi_canvas_maintenance', {
      leaseHandle, projectId: PROJECT_ID, operation: 'delete_canvas_nodes', nodeIds: ['node-a'], reason: '清理旧节点 😀',
    })
    expect(deleted.result?.isError).not.toBe(true)
    const deleteReceipt = deleted.result?.structuredContent as { undoToken?: string; deletedNodeIds?: string[] }
    expect(deleteReceipt.deletedNodeIds).toEqual(['node-a'])
    expect(JSON.stringify(readWorkspaceProject(PROJECT_ID, fixture.deps)?.payload)).not.toContain('node-a')
    const undone = await client.call(14, 'nomi_canvas_maintenance', {
      leaseHandle, projectId: PROJECT_ID, operation: 'undo_canvas_delete', undoToken: deleteReceipt.undoToken,
    })
    expect(undone.result?.isError).not.toBe(true)
    expect((undone.result?.structuredContent as { restoredNodeIds?: string[] }).restoredNodeIds).toEqual(['node-a'])
    expect(JSON.stringify(readWorkspaceProject(PROJECT_ID, fixture.deps)?.payload)).toContain('node-a')

    // B/E: empty and duplicate node ids fail before dispatch; an invalid undo token fails in the real dispatcher.
    const empty = await client.call(15, 'nomi_canvas_maintenance', { leaseHandle, operation: 'delete_canvas_nodes', nodeIds: [] })
    expect(empty.result?.isError).toBe(true)
    const duplicate = await client.call(16, 'nomi_canvas_maintenance', { leaseHandle, operation: 'delete_canvas_nodes', nodeIds: ['node-b', 'node-b'] })
    expect(duplicate.result?.isError).toBe(true)
    expect(client.invoke).toHaveBeenCalledTimes(3) // session open + delete + undo; B cases never invoke dispatch
    const invalidUndo = await client.call(17, 'nomi_canvas_maintenance', { leaseHandle, operation: 'undo_canvas_delete', undoToken: 'undo-stale' })
    expect(invalidUndo.result?.isError).toBe(true)
    expect(outcomeCode(invalidUndo)).toBe('capability_input_invalid')

    // The delete contract has no revision field. Keep stale-revision evidence explicit at the MCP boundary.
    const stale = await client.call(18, 'nomi_canvas_maintenance', {
      leaseHandle, operation: 'delete_canvas_nodes', nodeIds: ['node-b'], expectedRevision: 1,
    })
    expect(stale.result?.isError).toBe(true)
    expect(outcomeCode(stale)).toBe('capability_input_invalid')

    // T/N: boundary faults are typed and prove no delete occurred when transport/provider access fails.
    for (const [id, fault, expected] of [[19, 'timeout', 'capability_timeout'], [20, 'network', 'capability_execution_failed']] as const) {
      const faulty = makeClient(baseContext as never, fault)
      await faulty.initialize()
      const faultyLease = await openLease(faulty)
      const failed = await faulty.call(id, 'nomi_canvas_maintenance', { leaseHandle: faultyLease, operation: 'delete_canvas_nodes', nodeIds: ['node-b'] })
      expect(failed.result?.isError).toBe(true)
      expect(outcomeCode(failed)).toBe(expected)
      expect(JSON.stringify(readWorkspaceProject(PROJECT_ID, fixture.deps)?.payload)).toContain('node-b')
      faulty.protocol.dispose()
    }
    client.protocol.dispose()
  })

  it('records renderer-only semantic operations as blocked gaps, never as headless success', async () => {
    expect(MCP_CAPABILITY_RESOLVER.resolve('nomi_timeline_read')).toBeDefined()
    expect(MCP_CAPABILITY_RESOLVER.resolve('nomi_timeline_edit')).toBeDefined()
    expect(MCP_CAPABILITY_RESOLVER.resolve('nomi_media_query')).toBeDefined()
    expect(MCP_CAPABILITY_RESOLVER.resolve('nomi_export_job')).toBeDefined()

    const fixture = await makeFixture()
    const context = {
      runTask: vi.fn(),
      makeGateway: (projectId: string) => createDiskGateway(projectId),
      productionRuns: {},
      generationPolicy: fixture.generationPolicy,
      origin: { host: 'codex' as const },
      projectSession: { authority: fixture.runtime.authority, connection: fixture.connection },
    }
    const client = makeClient(context as never)
    await client.initialize()
    const leaseHandle = await openLease(client)
    const blockedCalls = [
      ['nomi_timeline_read', { leaseHandle, projectId: PROJECT_ID, operation: 'read' }],
      ['nomi_timeline_edit', {
        leaseHandle,
        projectId: PROJECT_ID,
        operation: 'preview',
        plan: {
          planId: 'blocked-plan',
          baseRevision: '0',
          summary: 'blocked preview',
          operations: [{ kind: 'remove', clipId: 'clip-not-present' }],
        },
      }],
      ['nomi_media_query', { leaseHandle, projectId: PROJECT_ID, operation: 'list', query: '', limit: 1 }],
      ['nomi_export_job', { leaseHandle, projectId: PROJECT_ID, operation: 'status', jobId: 'job-not-started' }],
    ] as const
    for (const [index, [name, args]] of blockedCalls.entries()) {
      const blocked = await client.call(21 + index, name, args)
      expect(blocked.result?.isError).toBe(true)
      expect(blocked.result?.content?.[0]?.text).toMatch(/未知方法|unknown/i)
    }
    client.protocol.dispose()
  })
})
