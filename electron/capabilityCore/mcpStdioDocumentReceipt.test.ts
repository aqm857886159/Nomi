import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getName: () => 'Nomi',
    getPath: (name: string) => name === 'documents' ? os.tmpdir() : os.tmpdir(),
    getAppPath: () => process.cwd(),
    getLocale: () => 'en',
    dock: { hide: vi.fn() },
  },
  nativeImage: {},
  safeStorage: { setUsePlainTextEncryption: vi.fn() },
  session: { defaultSession: {} },
  BrowserWindow: { getAllWindows: () => [] },
  Notification: class {},
}))

vi.mock('./canvasReadTransportAdapters', () => ({
  createMcpCanvasReadTransportAdapter: () => ({
    tryExecute: async () => ({ handled: false }),
  }),
}))

import { createProjectAgentProposalReceiptService, projectAgentProposalReceiptPath } from '../projectAgentHost/projectAgentProposalReceiptStore'
import type { WorkspaceProjectIdentity } from '../workspace/workspaceProjectIdentity'
import { createDefaultMcpProposalReceiptResolver, createMcpStdioDirectInvoker } from './mcpStdioServer'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

function makeService() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-mcp-stdio-document-receipt-'))
  roots.push(root)
  fs.mkdirSync(path.join(root, '.nomi'), { recursive: true })
  const binding = {
    projectId: 'project-stdio-document',
    immutableProjectUuid: '33333333-3333-4333-8333-333333333333',
    projectGeneration: 1,
  } as const
  return {
    root,
    binding,
    service: createProjectAgentProposalReceiptService({ projectRoot: root, binding }),
  }
}

const session = {
  connection: { authenticatedClient: 'codex' },
} as never
const canvasReadExecutionRuntime = { executor: { execute: vi.fn() } } as never

describe('MCP stdio direct document receipt boundary', () => {
  it('resolves the default headless receipt service only after the project root and identity are real', async () => {
    const { root, service } = makeService()
    const ensureProjectIdentity = vi.fn(async (): Promise<WorkspaceProjectIdentity> => ({
      projectId: service.binding.projectId,
      immutableProjectUuid: service.binding.immutableProjectUuid,
      projectGeneration: service.binding.projectGeneration,
      canonicalRootPath: root,
      canonicalRootDigest: 'canonical-root-digest',
    }))
    const createReceiptService = vi.fn(() => service)
    const resolve = createDefaultMcpProposalReceiptResolver({
      resolveProjectRoot: (projectId) => projectId === 'missing-project' ? null : root,
      ensureProjectIdentity,
      createReceiptService,
    })

    await expect(resolve('missing-project')).resolves.toBeUndefined()
    await expect(resolve('project-stdio-document')).resolves.toBe(service)
    expect(ensureProjectIdentity).toHaveBeenCalledWith(root)
    expect(createReceiptService).toHaveBeenCalledWith({
      projectRoot: root,
      binding: service.binding,
    })
  })

  it('routes a real headless document.write through the same durable prepare/commit helper', async () => {
    const { root, service } = makeService()
    const dispatch = vi.fn(async () => ({ applied: true, revision: 2, contentHash: 'stdio-hash' }))
    const proposalReceiptFor = vi.fn(() => service)
    const invokeDirect = createMcpStdioDirectInvoker(
      { proposalReceiptFor },
      canvasReadExecutionRuntime,
      dispatch as never,
    )

    const first = await invokeDirect(
      'document.write',
      { projectId: 'project-stdio-document', operation: 'append', content: 'headless content' },
      session,
      { documentConfirmed: true, requestId: 'stdio-document-replay-1' },
    )
    expect(first).toMatchObject({ applied: true })

    await expect(invokeDirect(
      'document.write',
      { projectId: 'project-stdio-document', operation: 'append', content: 'headless content' },
      session,
      { documentConfirmed: true, requestId: 'stdio-document-replay-1' },
    )).resolves.toEqual(first)

    await expect(invokeDirect(
      'document.write',
      { projectId: 'project-stdio-document', operation: 'append', content: 'different content' },
      session,
      { documentConfirmed: true, requestId: 'stdio-document-replay-1' },
    )).rejects.toThrow(/conflicts|conflict/)

    expect(dispatch).toHaveBeenCalledOnce()
    expect(proposalReceiptFor).toHaveBeenCalledWith('project-stdio-document')
    expect(fs.existsSync(projectAgentProposalReceiptPath(root))).toBe(true)
    expect(service.read()).toMatchObject({ revision: 2, lifecycle: 'committed' })
  })

  it('passes cancellation through the direct document receipt boundary after a real effect', async () => {
    const { service } = makeService()
    const controller = new AbortController()
    const dispatch = vi.fn(async () => {
      controller.abort(new Error('late direct document cancel'))
      return { applied: true, revision: 2, contentHash: 'stdio-hash' }
    })
    const invokeDirect = createMcpStdioDirectInvoker(
      { proposalReceiptFor: () => service },
      canvasReadExecutionRuntime,
      dispatch as never,
    )

    await expect(invokeDirect(
      'document.write',
      { projectId: service.binding.projectId, operation: 'append', content: 'effect before cancellation' },
      session,
      { documentConfirmed: true, requestId: 'stdio-document-late-cancel-1', signal: controller.signal },
    )).rejects.toThrow('late direct document cancel')
    expect(service.read()).toMatchObject({ lifecycle: 'effect_unknown' })
  })

  it('fails closed before dispatch when headless document confirmation is absent', async () => {
    const { service } = makeService()
    const dispatch = vi.fn(async () => ({ applied: true }))
    const invokeDirect = createMcpStdioDirectInvoker(
      { proposalReceiptFor: () => service },
      canvasReadExecutionRuntime,
      dispatch as never,
    )

    await expect(invokeDirect('document.write', { projectId: service.binding.projectId }, session, undefined))
      .rejects.toThrow('human_approval_required')
    expect(dispatch).not.toHaveBeenCalled()
    expect(service.read()).toBeNull()
  })

  it('fails closed when the headless receipt authority is unavailable', async () => {
    const dispatch = vi.fn(async () => ({ applied: true }))
    const invokeDirect = createMcpStdioDirectInvoker(
      { proposalReceiptFor: () => undefined },
      canvasReadExecutionRuntime,
      dispatch as never,
    )

    await expect(invokeDirect(
      'document.write',
      { projectId: 'missing-project', operation: 'append', content: 'must not write' },
      session,
      { documentConfirmed: true },
    )).rejects.toThrow('durable_document_receipt_unavailable')
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('uses safe empty-project/write fallbacks and leaves other direct methods on the normal dispatch path', async () => {
    const { service } = makeService()
    const dispatch = vi.fn(async () => ({ applied: true }))
    const invokeDirect = createMcpStdioDirectInvoker(
      { proposalReceiptFor: (projectId) => projectId === '' ? service : undefined },
      canvasReadExecutionRuntime,
      dispatch as never,
    )

    await expect(invokeDirect(
      'document.write',
      { content: 'fallback operation' },
      session,
      { documentConfirmed: true },
    )).resolves.toMatchObject({ applied: true })
    await expect(invokeDirect('timeline.read', {}, session, undefined)).resolves.toMatchObject({ applied: true })

    expect(dispatch).toHaveBeenCalledTimes(2)
    expect(service.read()).toMatchObject({
      lifecycle: 'committed',
      proposal: { stepLabels: ['document.write:write'] },
    })
  })
})
