import { describe, expect, it, vi } from 'vitest'

// 2026-10-09 评审 B1（复审）：importLocalFilesToGenerationCanvas 返回的是**导入成功的**节点 id——失败的卡留在画布上（error，可重试），
// 但不算「导入好了」，调用方（素材选择器上传后接线）不许把它们接进目标。
vi.mock('../../project/projectCanvasReadSurface', () => {
  const project = { binding: { projectId: 'project-a', immutableProjectUuid: 'uuid-a', projectGeneration: 1 }, signal: new AbortController().signal, assertCurrent: () => undefined }
  return { withProjectAction: (run: (issued: typeof project) => unknown) => run(project), isProjectExecutionContextCurrent: () => true }
})
vi.mock('../adapters/assetImportAdapter', () => ({
  importLocalMediaFilesToGenerationCanvas: async () => ({
    created: [{ node: { id: 'ok-1' } }, { node: { id: 'failed-1' } }],
    succeededNodeIds: ['ok-1'],
    skippedDuplicateCount: 0, rejected: [], skippedOverLimitCount: 0, failedCount: 1,
  }),
}))

const { importLocalFilesToGenerationCanvas } = await import('./canvasStageDrop')

describe('importLocalFilesToGenerationCanvas', () => {
  it('returns only the ids that imported successfully', async () => {
    const ids = await importLocalFilesToGenerationCanvas([new File(['x'], 'a.png', { type: 'image/png' })], { basePosition: { x: 0, y: 0 } })
    expect(ids).toEqual(['ok-1'])
  })
})
