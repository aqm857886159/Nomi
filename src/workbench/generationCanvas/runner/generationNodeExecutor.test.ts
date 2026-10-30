import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TaskRequestDto, TaskResultDto } from '../../api/taskApi'
import type { GenerationCanvasEdge, GenerationCanvasNode } from '../model/generationCanvasTypes'

const { runWorkbenchTaskByVendor } = vi.hoisted(() => ({
  runWorkbenchTaskByVendor: vi.fn(),
}))

vi.mock('../../api/taskApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api/taskApi')>()
  return { ...actual, runWorkbenchTaskByVendor }
})

vi.mock('../../api/modelCatalogApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api/modelCatalogApi')>()
  return {
    ...actual,
    listWorkbenchModelCatalogVendors: vi.fn(async () => {
      throw new Error('catalog unavailable in executor integration test')
    }),
  }
})

import { generationNodeExecutor } from './generationNodeExecutor'

function textNode(id: string, text: string): GenerationCanvasNode {
  return {
    id,
    kind: 'text',
    title: id,
    position: { x: 0, y: 0 },
    contentJson: {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
    },
  } as GenerationCanvasNode
}

function mediaNode(id: string, kind: 'image' | 'video'): GenerationCanvasNode {
  return {
    id,
    kind,
    title: id,
    position: { x: 0, y: 0 },
    prompt: 'base prompt',
    meta: { modelKey: `mock-${kind}`, vendor: 'mock-vendor' },
  }
}

function textPromptEdge(source: string, target: string): GenerationCanvasEdge {
  return { id: `${source}-${target}`, source, target, mode: 'reference', order: 0 }
}

describe('generationNodeExecutor connected text prompt integration', () => {
  beforeEach(() => {
    runWorkbenchTaskByVendor.mockReset()
    runWorkbenchTaskByVendor.mockImplementation(async (_vendor: string, request: TaskRequestDto) => ({
      id: `task-${request.kind}`,
      kind: request.kind,
      status: 'succeeded',
      assets: [{ type: request.kind.includes('video') ? 'video' : 'image', url: `https://example.test/${request.kind}` }],
      raw: {},
    } satisfies TaskResultDto))
  })

  it.each(['image', 'video'] as const)('把文本正文送进 %s 的最终 catalog request', async (kind) => {
    const text = textNode('text-1', 'connected story context')
    const target = mediaNode(`${kind}-1`, kind)

    const onTaskRequest = vi.fn(async () => {})
    await generationNodeExecutor(target, {
      onTaskRequest,
      projectTarget: { projectId: 'project-test', immutableProjectUuid: '11111111-1111-4111-8111-111111111111', projectGeneration: 1 },
      nodes: [text, target],
      edges: [textPromptEdge(text.id, target.id)],
    })

    expect(onTaskRequest).toHaveBeenCalledOnce()
    expect(onTaskRequest.mock.invocationCallOrder[0]).toBeLessThan(runWorkbenchTaskByVendor.mock.invocationCallOrder[0])
    expect(runWorkbenchTaskByVendor).toHaveBeenCalledOnce()
    const [, request] = runWorkbenchTaskByVendor.mock.calls[0] as [string, TaskRequestDto]
    expect(request.prompt).toBe('base prompt\n\nconnected story context')
    expect(target.prompt).toBe('base prompt')
  })
})
