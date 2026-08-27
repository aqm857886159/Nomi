import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GenerationCanvasNode, GenerationCanvasSnapshot } from '../model/generationCanvasTypes'

const deps = vi.hoisted(() => ({ run: vi.fn(), catalog: vi.fn() }))
vi.mock('../../ai/workbenchAgentRunner', () => ({ runWorkbenchAgent: deps.run, workbenchSessionKey: () => 'wrong-current-url-key' }))
vi.mock('./availableModels', () => ({ listAvailableModelsForAgent: deps.catalog, formatAvailableModelsForPrompt: () => 'models' }))
vi.mock('./applyCanvasToolCall', () => ({ applyCanvasToolCall: vi.fn() }))
vi.mock('./gate', () => ({ evaluateGate: () => ({ outcome: 'allow' }) }))
vi.mock('./lockGateContext', () => ({ buildLockGateContext: () => ({}) }))
import { sendGenerationCanvasAgentMessage } from './generationCanvasAgentClient'

const snapshot: GenerationCanvasSnapshot = { nodes: [], edges: [], groups: [] }
const node = (id: string): GenerationCanvasNode => ({ id, kind: 'image', title: id, position: { x: 0, y: 0 } })
const inputFor = (mode: 'agent' | 'chat' | 'refine') => ({
  message: 'request', snapshot, selectedNodes: [node('launch-selection')], mode,
  projectId: 'project-A',
  history: { kind: 'persistent' as const, binding: { sessionKey: 'nomi:workbench:project-A:generation', threadId: 'thread-A' } },
  capability: `canvas-${mode}` as 'canvas-agent' | 'canvas-chat' | 'canvas-refine',
  canWrite: () => true,
})

beforeEach(() => {
  vi.clearAllMocks()
  deps.catalog.mockResolvedValue([])
  deps.run.mockResolvedValue({ text: 'answer', status: 'finished' })
})

describe('canvas business request ownership', () => {
  it.each(['agent', 'chat', 'refine'] as const)('%s uses explicit capability and persistent thread', async (mode) => {
    const input = inputFor(mode)
    await sendGenerationCanvasAgentMessage(input)
    expect(deps.run).toHaveBeenCalledWith(expect.objectContaining({
      capability: `canvas-${mode}`, history: input.history, projectId: 'project-A',
      selectedNodeIds: ['launch-selection'],
    }))
  })

  it('captures binding, mode and exact selected IDs before catalog preflight', async () => {
    let release!: () => void
    deps.catalog.mockImplementationOnce(() => new Promise((resolve) => { release = () => resolve([]) }))
    const input = inputFor('refine')
    const result = sendGenerationCanvasAgentMessage(input)
    input.history.binding.threadId = 'thread-B'
    input.projectId = 'project-B'
    input.mode = 'agent'
    input.selectedNodes.splice(0, 1, node('later-selection'))
    release()
    await result
    expect(deps.run).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'project-A', capability: 'canvas-refine', selectedNodeIds: ['launch-selection'],
      history: { kind: 'persistent', binding: { sessionKey: 'nomi:workbench:project-A:generation', threadId: 'thread-A' } },
    }))
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
