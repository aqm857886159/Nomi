import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import { useGenerationCanvasStore, __resetGenerationCanvasHistoryForTests } from '../store/generationCanvasStore'

// 2026-10-09 对抗评审 B1。设计卡「素材选择器上传中关闭……文件已导入的留成素材卡，不连线」说的是**上传途中把选择器关掉**这一种：
// 那时已导入的留成素材卡、不连线。选择器一直开到上传完成的正常情形，左环「给它加输入」就是要接上，
// 而且「导入 + 连线」必须是一步撤销（Ctrl+Z 一次撤干净）。
const imported = vi.hoisted(() => ({ ids: [] as string[] }))
vi.mock('../components/canvasStageDrop', () => ({
  importLocalFilesToGenerationCanvas: async () => {
    const store = (await import('../store/generationCanvasStore')).useGenerationCanvasStore.getState()
    const created = store.addNode({ kind: 'asset', title: 'uploaded', position: { x: 0, y: 0 }, categoryId: 'shots', select: false })
    imported.ids = [created.id]
    return [created.id]
  },
}))

const { addUploadedInput } = await import('./nodeInputActions')
const store = () => useGenerationCanvasStore.getState()
const target: GenerationCanvasNode = { id: 'target', kind: 'video', title: 'target', position: { x: 400, y: 0 }, categoryId: 'shots', meta: {} }
const file = new File(['x'], 'a.png', { type: 'image/png' })

beforeEach(() => {
  __resetGenerationCanvasHistoryForTests()
  store().restoreSnapshot({ nodes: [target], edges: [], groups: [] })
})

describe('addUploadedInput', () => {
  it('upload completes while the picker is still open → the new asset card is wired in, and one Ctrl+Z undoes import + edge together', async () => {
    await addUploadedInput('target', file, { shouldConnect: () => true })
    expect(store().nodes.map((n) => n.id)).toContain(imported.ids[0])
    expect(store().edges).toMatchObject([{ source: imported.ids[0], target: 'target' }])
    store().undo()
    expect(store().nodes.map((n) => n.id)).toEqual(['target'])
    expect(store().edges).toEqual([])
  })

  it('picker closed mid-upload → the imported asset card stays, no edge', async () => {
    await addUploadedInput('target', file, { shouldConnect: () => false })
    expect(store().nodes.map((n) => n.id)).toContain(imported.ids[0])
    expect(store().edges).toEqual([])
  })
})
