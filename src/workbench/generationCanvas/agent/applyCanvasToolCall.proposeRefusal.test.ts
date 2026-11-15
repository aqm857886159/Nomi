import { beforeEach, describe, expect, it, vi } from 'vitest'

// 兜底这一层单独证：入参边界（严格 schema）今天就挡住了 NaN 时长，所以这里把边界换成原样放行，
// 模拟「边界哪天松了 / 新字段没进严格面」——写入口仍要拒收，而且 Agent 拿到的是字段路径，不是「目标已不存在」。
vi.mock('./availableModels', async (importOriginal) => ({
  ...await importOriginal<typeof import('./availableModels')>(),
  listAvailableModelsForAgent: vi.fn(async () => []),
}))
vi.mock('./storyboardPlanSchema', async (importOriginal) => ({
  ...await importOriginal<typeof import('./storyboardPlanSchema')>(),
  parseStoryboardPlan: (value: unknown) => value,
}))

import { applyCanvasToolCall } from './applyCanvasToolCall'
import { useWorkbenchStore } from '../../workbenchStore'

describe('propose_storyboard_plan when the write door refuses what the boundary let through', () => {
  beforeEach(() => {
    useWorkbenchStore.getState().hydrateWorkbenchDocuments(
      [{ id: 'doc-1', version: 1, title: '', contentJson: { type: 'doc', content: [] }, updatedAt: 1 }],
      'doc-1',
    )
    useWorkbenchStore.getState().hydrateStoryboardDesigns({})
  })

  it('returns capability_input_invalid naming the field, and the store does not change', async () => {
    const before = useWorkbenchStore.getState().storyboardDesignsByDocumentId
    await expect(applyCanvasToolCall('propose_storyboard_plan', {
      title: 't', anchors: [], shots: [{ index: 1, durationSec: Number.NaN, anchorIds: [], prompt: 'A' }],
    })).rejects.toMatchObject({ code: 'capability_input_invalid', fields: expect.stringContaining('shots[0].durationSec') })
    expect(useWorkbenchStore.getState().storyboardDesignsByDocumentId).toBe(before)
  })
})
