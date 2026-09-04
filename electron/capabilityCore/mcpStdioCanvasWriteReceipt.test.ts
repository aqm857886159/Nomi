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

import { createNamedProject, addProjectNodes } from './core'
import { createDiskGateway } from './gateway'
import { createMcpGenerationPolicy } from './mcpGenerationPolicy'
import { createMcpConnectionContext } from './mcpConnectionContext'
import { createMcpProtocol } from './mcpProtocol'
import { createProjectSessionRuntime, createVerifiedProjectSessionBinding } from './projectSessionRuntime'
import { MCP_CAPABILITY_RESOLVER } from './mcpCapabilityProjection'
import { createMcpStdioDirectInvoker } from './mcpStdioServer'
import { dispatchAndEnrich } from './mcpResultEnrichLive'
import { createProjectAgentProposalReceiptService, projectAgentProposalReceiptPath } from '../projectAgentHost/projectAgentProposalReceiptStore'
import { CANVAS_WRITE_MAX_PROMPT_CHARS } from '../shared/agentCapabilities/canvasWrite'
import { ensureWorkspaceProjectIdentity } from '../workspace/workspaceProjectIdentity'
import { getWorkspaceRepositoryDeps } from '../runtimePaths'
import { readWorkspaceProject, resolveWorkspaceProjectDir } from '../workspace/workspaceRepository'
import { CAPABILITY_DIR_ENV, ensureToken, signMcpClient } from './security'

const roots: string[] = []
const previousProjectsRoot = process.env.NOMI_PROJECTS_DIR
const previousSettingsRoot = process.env.NOMI_SETTINGS_DIR
const previousCapabilityRoot = process.env[CAPABILITY_DIR_ENV]

afterEach(() => {
  if (previousProjectsRoot === undefined) delete process.env.NOMI_PROJECTS_DIR
  else process.env.NOMI_PROJECTS_DIR = previousProjectsRoot
  if (previousSettingsRoot === undefined) delete process.env.NOMI_SETTINGS_DIR
  else process.env.NOMI_SETTINGS_DIR = previousSettingsRoot
  if (previousCapabilityRoot === undefined) delete process.env[CAPABILITY_DIR_ENV]
  else process.env[CAPABILITY_DIR_ENV] = previousCapabilityRoot
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

async function makeRealCanvasWriteHarness() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-mcp-stdio-canvas-write-'))
  roots.push(root)
  const projectsRoot = path.join(root, 'projects')
  const settingsRoot = path.join(root, 'settings')
  fs.mkdirSync(projectsRoot, { recursive: true })
  fs.mkdirSync(settingsRoot, { recursive: true })
  process.env.NOMI_PROJECTS_DIR = projectsRoot
  process.env.NOMI_SETTINGS_DIR = settingsRoot
  process.env[CAPABILITY_DIR_ENV] = path.join(root, 'capability')
  ensureToken()

  const project = createNamedProject('canvas receipt')
  const projectRoot = resolveWorkspaceProjectDir(project.id, getWorkspaceRepositoryDeps())
  if (!projectRoot) throw new Error('test project root unavailable')
  const node = (await addProjectNodes(createDiskGateway(project.id), [{ kind: 'image', title: 'Shot 1', prompt: 'before' }])).ids[0]
  const identity = await ensureWorkspaceProjectIdentity(projectRoot)
  const connection = createMcpConnectionContext({ client: 'codex', proof: signMcpClient('codex')! })
  const generationPolicy = createMcpGenerationPolicy({ env: {} })
  const runtime = createProjectSessionRuntime({
    generationPolicy,
    leaseFilePath: path.join(root, 'leases.json'),
    leaseMacKey: 'canvas-write-lease-key',
    leaseStoreMacKey: 'canvas-write-lease-store-key',
    getOpenProjectSelection: () => null,
    resolveProjectRoot: (projectId) => projectId === project.id ? projectRoot : null,
    ensureProjectIdentity: (actualRootPath) => ensureWorkspaceProjectIdentity(actualRootPath),
    readProject: (projectId) => readWorkspaceProject(projectId, getWorkspaceRepositoryDeps()),
    isServerAllowlisted: () => false,
  })
  const binding = createVerifiedProjectSessionBinding(runtime, connection)
  const selection = await runtime.authority.issueProjectSelection('created_project', project.id, connection)
  const opened = await runtime.authority.open({ projectSelectionHandle: selection.token }, connection)
  const service = createProjectAgentProposalReceiptService({
    projectRoot,
    binding: {
      projectId: identity.projectId,
      immutableProjectUuid: identity.immutableProjectUuid,
      projectGeneration: identity.projectGeneration,
    },
  })
  const invoke = createMcpStdioDirectInvoker({ proposalReceiptFor: () => service }, {
    executor: {} as never,
  })
  const tool = MCP_CAPABILITY_RESOLVER.resolve('nomi_canvas_edit')
  if (!tool) throw new Error('nomi_canvas_edit resolver entry unavailable')
  const buildParams = (prompt: string) => tool.build({
    leaseHandle: opened.leaseHandle,
    projectId: project.id,
    operation: 'set_node_prompt',
    nodeId: node,
    prompt,
  })
  return { project, projectRoot, node, service, binding, opened, invoke, tool, buildParams }
}

async function readPrompt(projectId: string, nodeId: string): Promise<string | undefined> {
  const snapshot = await createDiskGateway(projectId).readDoc()
  return snapshot.nodes.find((candidate) => candidate.id === nodeId)?.prompt
}

describe('MCP stdio direct canvas.write durable receipt boundary', () => {
  it('uses JSON-RPC id as durable identity: same params replay and different params conflict', async () => {
    const harness = await makeRealCanvasWriteHarness()
    const frames: unknown[] = []
    const protocol = createMcpProtocol({
      send: (frame) => frames.push(frame),
      isAppOpen: () => false,
      invoke: (method, params, options) => harness.invoke(method, params, harness.binding, options),
    })
    const requestId = 'json-rpc-canvas-17'
    const request = (prompt: string) => ({
      jsonrpc: '2.0',
      id: requestId,
      method: 'tools/call',
      params: {
        name: 'nomi_canvas_edit',
        arguments: harness.buildParams(prompt),
      },
    })
    const responseFor = async (prompt: string) => {
      const before = frames.length
      protocol.handleIncoming(request(prompt))
      await vi.waitFor(() => expect(frames.length).toBeGreaterThan(before))
      return frames.at(-1) as { id?: string; result?: { isError?: boolean; structuredContent?: unknown } }
    }

    const first = await responseFor('protocol replay')
    const replay = await responseFor('protocol replay')
    expect(first).toEqual(replay)
    expect(await readPrompt(harness.project.id, harness.node)).toBe('protocol replay')

    const conflict = await responseFor('different parameters')
    expect(conflict).toMatchObject({ id: requestId, result: { isError: true } })
    expect(await readPrompt(harness.project.id, harness.node)).toBe('protocol replay')
    protocol.dispose()
  })

  it('persists a receipt for a real catalog-resolved canvas.write after the disk effect', async () => {
    const harness = await makeRealCanvasWriteHarness()
    const params = harness.buildParams('after')

    const result = await harness.invoke(harness.tool.method, params, harness.binding, undefined) as {
      applied: boolean
      proposalId: string
    }

    expect(result).toMatchObject({ applied: true, operation: 'set_node_prompt' })
    expect(fs.existsSync(projectAgentProposalReceiptPath(harness.projectRoot))).toBe(true)
    expect(harness.service.read()).toMatchObject({
      lifecycle: 'committed',
      proposalId: result.proposalId,
      proposal: { stepLabels: ['canvas.write:set_node_prompt'] },
    })
  })

  it('keeps the real disk effect and committed receipt across a service restart', async () => {
    const harness = await makeRealCanvasWriteHarness()
    const result = await harness.invoke(harness.tool.method, harness.buildParams('survives restart'), harness.binding, { requestId: 'restart-1' }) as { proposalId: string }

    const restartedService = createProjectAgentProposalReceiptService({
      projectRoot: harness.projectRoot,
      binding: harness.service.binding,
    })
    expect(await readPrompt(harness.project.id, harness.node)).toBe('survives restart')
    expect(restartedService.read()).toMatchObject({ lifecycle: 'committed', proposalId: result.proposalId })
  })

  it('marks a real canvas effect unknown when cancellation arrives after disk apply', async () => {
    const harness = await makeRealCanvasWriteHarness()
    const controller = new AbortController()
    const lateAbortInvoker = createMcpStdioDirectInvoker(
      { proposalReceiptFor: () => harness.service },
      { executor: {} as never },
      async (method, params, context) => {
        const result = await dispatchAndEnrich(method, params, context)
        controller.abort(new Error('late canvas cancel'))
        return result
      },
    )

    await expect(lateAbortInvoker(
      harness.tool.method,
      harness.buildParams('effect landed before cancellation'),
      harness.binding,
      { requestId: 'late-canvas-cancel', signal: controller.signal },
    )).rejects.toThrow('late canvas cancel')
    expect(await readPrompt(harness.project.id, harness.node)).toBe('effect landed before cancellation')
    expect(harness.service.read()).toMatchObject({ lifecycle: 'effect_unknown' })
  })

  it('does not apply a duplicate request id twice and keeps its original receipt', async () => {
    const harness = await makeRealCanvasWriteHarness()
    const requestId = 'duplicate-request-1'
    await harness.invoke(harness.tool.method, harness.buildParams('first write'), harness.binding, { requestId })
    const before = harness.service.read()
    await expect(harness.invoke(harness.tool.method, harness.buildParams('second write'), harness.binding, { requestId })).rejects.toThrow(/operation conflicts|revision_conflict/)

    expect(await readPrompt(harness.project.id, harness.node)).toBe('first write')
    expect(harness.service.read()).toEqual(before)
  })

  it('accepts an empty canvas and the maximum schema payload without bypassing the real path', async () => {
    const emptyHarness = await makeRealCanvasWriteHarness()
    expect(() => emptyHarness.buildParams('')).toThrow()
    expect(await readPrompt(emptyHarness.project.id, emptyHarness.node)).toBe('before')
    expect(emptyHarness.service.read()).toBeNull()

    const largeHarness = await makeRealCanvasWriteHarness()
    const payload = 'x'.repeat(CANVAS_WRITE_MAX_PROMPT_CHARS)
    const result = await largeHarness.invoke(largeHarness.tool.method, largeHarness.buildParams(payload), largeHarness.binding, { requestId: 'large-prompt' }) as { applied: boolean }
    expect(result.applied).toBe(true)
    expect(await readPrompt(largeHarness.project.id, largeHarness.node)).toBe(payload)
    expect(largeHarness.service.read()).toMatchObject({ lifecycle: 'committed' })
  })

  it('records a failed receipt and leaves the project unchanged when the disk effect fails', async () => {
    const harness = await makeRealCanvasWriteHarness()
    const projectJson = path.join(harness.projectRoot, '.nomi', 'project.json')
    const failAfterLeaseInvoker = createMcpStdioDirectInvoker({
      proposalReceiptFor: () => {
        fs.renameSync(projectJson, `${projectJson}.missing`)
        return harness.service
      },
    }, { executor: {} as never })

    await expect(failAfterLeaseInvoker(harness.tool.method, harness.buildParams('must not land'), harness.binding, { requestId: 'disk-failure' })).rejects.toThrow()
    expect(fs.existsSync(projectJson)).toBe(false)
    expect(harness.service.read()).toMatchObject({ lifecycle: 'undone', proposal: { stepLabels: ['canvas.write:set_node_prompt'] } })
  })

  it('records partial when the second real canvas apply fails after nodes were persisted', async () => {
    const harness = await makeRealCanvasWriteHarness()
    const projectJson = path.join(harness.projectRoot, '.nomi', 'project.json')
    const realProjectJson = fs.realpathSync(projectJson)
    let projectRenames = 0
    const originalRename = fs.renameSync
    const rename = vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
      if (typeof to === 'string' && to === realProjectJson && ++projectRenames === 2) {
        throw new Error('second_canvas_apply_failed')
      }
      return originalRename(from, to)
    })

    try {
      const params = harness.tool.build({
        leaseHandle: harness.opened.leaseHandle,
        projectId: harness.project.id,
        operation: 'create_canvas_nodes',
        summary: 'Create two nodes before connecting them',
        nodes: [
          { clientId: 'first', kind: 'image', title: 'First', prompt: 'first prompt' },
          { clientId: 'second', kind: 'image', title: 'Second', prompt: 'second prompt' },
        ],
        edges: [{ sourceClientId: 'first', targetClientId: 'second', mode: 'reference' }],
      })

      await expect(harness.invoke(harness.tool.method, params, harness.binding, { requestId: 'partial-canvas-write' }))
        .rejects.toThrow('second_canvas_apply_failed')
      const snapshot = await createDiskGateway(harness.project.id).readDoc()
      expect(snapshot.nodes.map((node) => node.title)).toEqual(['Shot 1', 'First', 'Second'])
      expect(snapshot.edges).toEqual([])
      expect(harness.service.read()).toMatchObject({ lifecycle: 'partial' })
    } finally {
      rename.mockRestore()
    }
  })

  it('does not prepare or write after interruption has already cancelled the request', async () => {
    const harness = await makeRealCanvasWriteHarness()
    const controller = new AbortController()
    controller.abort(new Error('user stopped'))

    await expect(harness.invoke(harness.tool.method, harness.buildParams('late write'), harness.binding, { requestId: 'cancelled-before-effect', signal: controller.signal })).rejects.toThrow('user stopped')
    expect(await readPrompt(harness.project.id, harness.node)).toBe('before')
    expect(harness.service.read()).toBeNull()
  })

  it('rejects an invalid project-session lease before opening the receipt boundary', async () => {
    const harness = await makeRealCanvasWriteHarness()
    const params = { ...harness.buildParams('unauthorized'), leaseHandle: 'invalid-lease' }

    await expect(harness.invoke(harness.tool.method, params, harness.binding, { requestId: 'invalid-lease' })).rejects.toThrow()
    expect(await readPrompt(harness.project.id, harness.node)).toBe('before')
    expect(harness.service.read()).toBeNull()
  })
})
