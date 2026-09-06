import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CANVAS_READ_CAPABILITY } from '../../../../electron/shared/agentCapabilities/canvasRead'
import type { GenerationCanvasNode, GenerationCanvasSnapshot } from '../model/generationCanvasTypes'
import { captureCanvasReadResult } from './canvasReadResultSeal'

const deps = vi.hoisted(() => ({
  run: vi.fn(),
  catalog: vi.fn(),
  captureSurface: vi.fn(),
}))
vi.mock('../../ai/workbenchAgentRunner', () => ({ runWorkbenchAgent: deps.run, workbenchSessionKey: () => 'wrong-current-url-key' }))
vi.mock('./availableModels', () => ({ listAvailableModelsForAgent: deps.catalog, formatAvailableModelsForPrompt: () => 'models' }))
vi.mock('../../project/projectCanvasReadSurface', () => ({
  captureCurrentProjectCanvasReadSurfaceBinding: deps.captureSurface,
}))
vi.mock('./applyCanvasToolCall', () => ({ applyCanvasToolCall: vi.fn() }))
vi.mock('./gate', () => ({ evaluateGate: () => ({ outcome: 'allow' }) }))
vi.mock('./lockGateContext', () => ({ buildLockGateContext: () => ({}) }))
import { buildStaticAgentSystemPrompt, sendGenerationCanvasAgentMessage } from './generationCanvasAgentClient'

const snapshot: GenerationCanvasSnapshot = { nodes: [], edges: [], groups: [] }
const node = (id: string): GenerationCanvasNode => ({ id, kind: 'image', title: id, position: { x: 0, y: 0 } })
const surfaceBinding = (projectId: string) => Object.freeze({
  version: 1 as const,
  bindingId: `binding-${projectId}`,
  binding: Object.freeze({ projectId, immutableProjectUuid: `uuid-${projectId}`, projectGeneration: 1 }),
  webContentsId: 1,
  processId: 2,
  frameRoutingId: 3,
  origin: 'file://',
  surfaceInstanceId: 'surface-generation',
  portRevision: 4,
  nonce: `nonce-${projectId}`,
})
const inputFor = (mode: 'agent' | 'chat' | 'refine') => ({
  message: 'request', snapshot, selectedNodes: [node('launch-selection')], mode,
  projectId: 'project-A',
  capability: `canvas-${mode}` as 'canvas-agent' | 'canvas-chat' | 'canvas-refine',
  canWrite: () => true,
})

beforeEach(() => {
  vi.clearAllMocks()
  deps.catalog.mockResolvedValue([])
  deps.run.mockResolvedValue({ text: 'answer', status: 'finished' })
  deps.captureSurface.mockReturnValue(surfaceBinding('project-A'))
})

describe('canvas business request ownership', () => {
  it('keeps Preview timeline instructions separate from generation canvas instructions', () => {
    const timelinePrompt = buildStaticAgentSystemPrompt('agent', 'timeline')
    const generationPrompt = buildStaticAgentSystemPrompt('agent')
    expect(timelinePrompt).toContain('预览·时间线')
    expect(timelinePrompt).toContain('批准后才写入或导出')
    expect(generationPrompt).toContain('生成画布')
    expect(generationPrompt).not.toContain('预览·时间线')
  })

  // The Host owns a thread's conversation history; a renderer request never carries one.
  it.each(['agent', 'chat', 'refine'] as const)('%s uses explicit capability and never authors history', async (mode) => {
    const input = inputFor(mode)
    await sendGenerationCanvasAgentMessage(input)
    expect(deps.run).toHaveBeenCalledWith(expect.objectContaining({
      capability: `canvas-${mode}`, projectId: 'project-A',
      selectedNodeIds: ['launch-selection'],
    }))
    expect(deps.run.mock.calls[0][0]).not.toHaveProperty('history')
  })

  it('captures binding, mode and exact selected IDs before catalog preflight', async () => {
    let release!: () => void
    deps.catalog.mockImplementationOnce(() => new Promise((resolve) => { release = () => resolve([]) }))
    const input = inputFor('refine')
    const result = sendGenerationCanvasAgentMessage(input)
    input.projectId = 'project-B'
    input.mode = 'agent'
    input.selectedNodes.splice(0, 1, node('later-selection'))
    release()
    await result
    expect(deps.run).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'project-A', capability: 'canvas-refine', selectedNodeIds: ['launch-selection'],
    }))
  })

  it('captures the exact project Surface beside the turn snapshot before catalog can yield to another project', async () => {
    let release!: () => void
    deps.catalog.mockImplementationOnce(() => new Promise((resolve) => { release = () => resolve([]) }))
    const bindingA = surfaceBinding('project-A')
    deps.captureSurface.mockReturnValue(bindingA)

    const pending = sendGenerationCanvasAgentMessage(inputFor('agent'))
    expect(deps.captureSurface).toHaveBeenCalledOnce()
    deps.captureSurface.mockReturnValue(surfaceBinding('project-B'))
    release()
    await pending

    expect(deps.run).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'project-A',
      surfaceBinding: bindingA,
    }))
  })

  it('threads the already main-sealed production handle without recapturing a later live Surface', async () => {
    let release!: () => void
    deps.catalog.mockImplementationOnce(() => new Promise((resolve) => { release = () => resolve([]) }))
    const handleA = Object.freeze({ version: 1 as const, handleId: 'captured-a', nonce: 'captured-a-nonce' })
    const launchSnapshot = captureCanvasReadResult({
      nodes: [{ ...node('node-a'), title: 'Captured A' }],
      edges: [],
      groups: [],
      selectedNodeIds: [],
    })

    const pending = sendGenerationCanvasAgentMessage({
      ...inputFor('agent'),
      capability: 'storyboard',
      snapshot: launchSnapshot,
      capturedCanvasReadSnapshot: handleA,
    })

    expect(deps.captureSurface).not.toHaveBeenCalled()
    deps.captureSurface.mockReturnValue(surfaceBinding('project-B'))
    release()
    await pending

    expect(deps.run).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'project-A',
      capturedCanvasReadSnapshot: handleA,
    }))
    expect(deps.run.mock.calls[0]![0]).not.toHaveProperty('surfaceBinding')
  })

  it('uses the exact pre-normalized production snapshot for both prompt and captured admission', async () => {
    const handleA = Object.freeze({ version: 1 as const, handleId: 'captured-a', nonce: 'captured-a-nonce' })
    const canonical = captureCanvasReadResult({
      nodes: [{
        ...node('node-a'),
        title: 'Captured A',
        result: {
          id: 'result-a',
          type: 'image' as const,
          url: 'https://secret.invalid/result.png',
          createdAt: 1,
        },
      }],
      edges: [],
      groups: [],
      selectedNodeIds: [],
    })
    let promptSnapshot: unknown

    await sendGenerationCanvasAgentMessage({
      ...inputFor('agent'),
      capability: 'storyboard',
      snapshot: canonical,
      selectedNodes: [],
      capturedCanvasReadSnapshot: handleA,
      buildPrompt: ({ snapshot }) => {
        promptSnapshot = snapshot
        return 'production prompt'
      },
    })

    expect(promptSnapshot).toBe(canonical)
    expect(promptSnapshot).toMatchObject({
      nodes: [{ hasResult: true, currentResultId: 'result-a', resultIds: ['result-a'] }],
    })
    expect(deps.run).toHaveBeenCalledWith(expect.objectContaining({
      prompt: 'production prompt',
      selectedNodeIds: [],
      capturedCanvasReadSnapshot: handleA,
    }))
  })

  it('rejects a structural production snapshot that was not issued by the canonical projector', async () => {
    const handleA = Object.freeze({ version: 1 as const, handleId: 'captured-a', nonce: 'captured-a-nonce' })
    const structuralCopy = structuredClone(captureCanvasReadResult({
      nodes: [], edges: [], groups: [], selectedNodeIds: [],
    }))

    await expect(sendGenerationCanvasAgentMessage({
      ...inputFor('agent'),
      capability: 'storyboard',
      snapshot: structuralCopy,
      selectedNodes: [],
      capturedCanvasReadSnapshot: handleA,
    })).rejects.toMatchObject({ code: 'canvas_target_stale' })
    expect(deps.catalog).not.toHaveBeenCalled()
    expect(deps.run).not.toHaveBeenCalled()
  })

  it('projects and deeply freezes the launch canvas before the first catalog await', async () => {
    let release!: () => void
    deps.catalog.mockImplementationOnce(() => new Promise((resolve) => { release = () => resolve([]) }))
    const launchNode = {
      ...node('launch-node'),
      title: 'Launch title',
      prompt: 'Launch full prompt '.repeat(8),
      result: {
        id: 'result-launch',
        type: 'image' as const,
        url: 'https://secret.invalid/result.png',
        raw: { providerTaskId: 'private-task' },
        createdAt: 1,
      },
    }
    const launchSnapshot: GenerationCanvasSnapshot = {
      nodes: [launchNode],
      edges: [],
      groups: [],
      selectedNodeIds: [],
    }
    let promptCanvas: unknown
    const input = {
      ...inputFor('agent'),
      snapshot: launchSnapshot,
      selectedNodes: [launchNode],
      buildPrompt: ({ snapshot: captured }: { snapshot: unknown }) => {
        promptCanvas = captured
        return 'captured prompt'
      },
    }

    const pending = sendGenerationCanvasAgentMessage(input)
    launchNode.title = 'Later title from project B'
    launchNode.prompt = 'Later prompt from project B'
    launchSnapshot.selectedNodeIds = []
    release()
    await pending

    expect(promptCanvas).toMatchObject({
      nodes: [{ title: 'Launch title', currentResultId: 'result-launch' }],
      selectedNodeIds: ['launch-node'],
    })
    expect(promptCanvas).not.toMatchObject({ nodes: [{ result: expect.anything() }] })
    expect(Object.isFrozen(promptCanvas)).toBe(true)
    expect(Object.isFrozen((promptCanvas as { nodes: unknown[] }).nodes)).toBe(true)
    expect(Object.isFrozen((promptCanvas as { nodes: object[] }).nodes[0])).toBe(true)
    expect(deps.run.mock.calls[0][0].prompt).toBe('captured prompt')
  })

  it('builds the initial compact context through the safe projector and derives the tool name from the contract', async () => {
    const selected = {
      ...node('selected'),
      prompt: '完整安全提示词 '.repeat(12),
      result: {
        id: 'opaque-result',
        type: 'image' as const,
        url: 'https://secret.invalid/result.png',
        raw: { providerTaskId: 'private-task' },
        createdAt: 1,
      },
    }
    await sendGenerationCanvasAgentMessage({
      ...inputFor('agent'),
      snapshot: { nodes: [selected], edges: [], groups: [] },
      selectedNodes: [selected],
    })
    const runtimeRequest = deps.run.mock.calls[0][0]
    expect(runtimeRequest.prompt).toContain('完整安全提示词')
    expect(runtimeRequest.prompt).not.toContain('secret.invalid')
    expect(runtimeRequest.prompt).not.toContain('private-task')
    expect(runtimeRequest.systemPrompt).toContain(`- ${CANVAS_READ_CAPABILITY.aliases.pi}：`)

    const source = readFileSync(new URL('./generationCanvasAgentClient.ts', import.meta.url), 'utf8')
    expect(source).not.toContain("'- read_canvas_state：")
    expect(source).toContain('CANVAS_READ_CAPABILITY.aliases.pi')
  })

  it('Stop during preflight never starts a model request', async () => {
    let release!: () => void
    deps.catalog.mockImplementationOnce(() => new Promise((resolve) => { release = () => resolve([]) }))
    let writable = true
    const input = { ...inputFor('agent'), canWrite: () => writable }
    const result = sendGenerationCanvasAgentMessage(input)
    writable = false
    release()
    await expect(result).rejects.toMatchObject({ name: 'AbortError' })
    expect(deps.run).not.toHaveBeenCalled()
  })

  it('empty refine selection stays empty; no host executor is fabricated', async () => {
    await sendGenerationCanvasAgentMessage({ ...inputFor('refine'), selectedNodes: [] })
    const request = deps.run.mock.calls[0][0]
    expect(request.selectedNodeIds).toEqual([])
    expect(request.onToolCall).toBeUndefined()
  })

  it('forwards an expired tool approval while the same turn can still stream', async () => {
    const expired = { toolCallId: 'expired', toolName: 'create_canvas_nodes', message: 'confirmation timed out', denied: true }
    const onToolError = vi.fn()
    deps.run.mockImplementationOnce(async (request) => {
      request.onToolError?.(expired)
      request.onContent?.('still streaming', 'still streaming')
      return { text: 'still streaming', status: 'finished' }
    })
    const onContent = vi.fn()
    const input = { ...inputFor('agent'), onToolError, onContent }
    await sendGenerationCanvasAgentMessage(input)
    expect(onToolError).toHaveBeenCalledExactlyOnceWith(expired)
    expect(onContent).toHaveBeenCalledExactlyOnceWith('still streaming', 'still streaming')
  })
})
