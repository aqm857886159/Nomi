import { beforeEach, describe, expect, it, vi } from 'vitest'
import { captureCanvasReadResult } from './canvasReadResultSeal'

const deps = vi.hoisted(() => ({ send: vi.fn(), models: vi.fn() }))
vi.mock('../../ai/agentLoopMode', () => ({ runSingleShotAgent: deps.send }))
vi.mock('./availableModels', async importOriginal => ({ ...await importOriginal<typeof import('./availableModels')>(), listAvailableModelsForAgent: deps.models }))
vi.mock('../../../../electron/shared/agentCapabilities/availableModels', () => ({ formatAvailableModelsForPrompt: () => 'available-models' }))
import { buildAgentModelEntries } from './availableModels'
import { runStoryboardPlanner } from './runStoryboardPlanner'

const plan = { title: 'this operation', anchors: [], shots: [{ index: 1, durationSec: 3, anchorIds: [], prompt: 'rain' }] }
const base = () => ({ storyText: 'story', projectId: 'A', target: 'production' as const, canWrite: () => true,
  snapshot: captureCanvasReadResult({ nodes: [{ id: 'node-A', kind: 'image', title: 'Captured A', prompt: 'old frame', position: { x: 0, y: 0 } }], edges: [], groups: [], selectedNodeIds: ['node-A'] }),
  capturedCanvasReadSnapshot: { version: 1 as const, handleId: 'snapshot-A', nonce: 'nonce-A' },
})
beforeEach(() => {
  vi.clearAllMocks()
  deps.models.mockResolvedValue([])
  deps.send.mockResolvedValue({ status: 'finished', text: JSON.stringify(plan) })
})

describe('storyboard planning is a pure isolated proposal', () => {
  it('uses the supplied project, captured canvas and canonical schema without renderer tool execution', async () => {
    const result = await runStoryboardPlanner(base())
    expect(result.plan).toMatchObject(plan)
    const request = deps.send.mock.calls[0][0]
    expect(request.projectId).toBe('A')
    expect(request.prompt).toContain('Captured A')
    expect(request.prompt).toContain('available-models')
    expect(request.prompt).toContain('"properties"')
    expect(request.prompt).not.toContain('propose_storyboard_plan')
    expect(request).not.toHaveProperty('onToolCall')
  })

  it('rejects an unissued canvas snapshot before making a model request', async () => {
    const input = base()
    await expect(runStoryboardPlanner({ ...input, snapshot: { ...input.snapshot } })).rejects.toThrow('canvas_target_stale')
    expect(deps.send).not.toHaveBeenCalled()
  })

  it('rejects an abandoned operation before accepting its delayed plan', async () => {
    let writable = true
    deps.send.mockImplementation(async () => { writable = false; return { status: 'finished', text: JSON.stringify(plan) } })
    await expect(runStoryboardPlanner({ ...base(), canWrite: () => writable })).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('accepts a single JSON fence but validates the actual domain schema', async () => {
    deps.send.mockResolvedValueOnce({ status: 'finished', text: `\`\`\`json\n${JSON.stringify(plan)}\n\`\`\`` })
    expect((await runStoryboardPlanner(base())).plan).toMatchObject(plan)
    deps.send.mockResolvedValueOnce({ status: 'finished', text: '{"title":"missing shots"}' })
    await expect(runStoryboardPlanner(base())).rejects.toThrow()
  })

  it('normalizes real character inputs at the production IR boundary too', async () => {
    deps.models.mockResolvedValue(buildAgentModelEntries([{ value: 'MiniMax-H3', vendor: 'apimart', label: 'H3', kind: 'video' }]))
    deps.send.mockResolvedValue({ status: 'finished', text: JSON.stringify({ title: 'real anchor',
      anchors: [{ id: 'hero', name: 'Hero', description: 'blue shirt', kind: 'character', carrier: 'visual', referenceUrl: 'https://example.com/hero.png' }],
      shots: [{ index: 1, shotKind: 'video', durationSec: 8, prompt: 'walk', anchorIds: ['hero'], modelKey: 'MiniMax-H3', modelVendor: 'apimart', modeId: 't2v' }],
    }) })
    const result = await runStoryboardPlanner(base())
    expect(result.plan?.shots[0].modeId).toBe('ref')
    expect(result.plan?.shots[0].referenceBindings?.image_ref?.[0]).toMatchObject({ anchorId: 'hero', url: 'https://example.com/hero.png' })
    expect(JSON.parse(result.text).shots[0].modeId).toBe('t2v')
  })

  it('does not turn a cancelled response into a plan to materialize', async () => {
    deps.send.mockResolvedValueOnce({ status: 'cancelled', text: 'partial' })
    expect(await runStoryboardPlanner(base())).toEqual({ status: 'cancelled', text: 'partial' })
  })
})
