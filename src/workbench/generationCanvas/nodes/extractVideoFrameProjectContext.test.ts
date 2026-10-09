import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import { __resetGenerationCanvasHistoryForTests, useGenerationCanvasStore } from '../store/generationCanvasStore'
import { classifyGenerationError } from '../../observability/classifyError'

const fixture = vi.hoisted(() => ({ controller: new AbortController(), extract: vi.fn() }))
vi.mock('../../../desktop/bridge', () => ({ getDesktopBridge: () => ({ video: { extractFrame: fixture.extract } }) }))
vi.mock('../../project/projectCanvasReadSurface', () => ({
  isProjectImportCancellation: (error: { code?: string }) => error.code === 'project_binding_stale',
  // The single issuance point hands the originating project to the action.
  withProjectAction: (run: (project: unknown) => unknown) => run((() => {
    const signal = fixture.controller.signal
    return { signal, binding: { projectId: 'a', immutableProjectUuid: 'uuid-a', projectGeneration: 1 },
      assertCurrent() { if (signal.aborted) throw Object.assign(new Error('stale'), { code: 'project_binding_stale' }) },
    }
  })()),
}))
import { extractVideoFrameToNode, retryVideoFrameCapture } from './extractVideoFrameToNode'
import { localRetryOf } from './localRetry'

const video = {
  id: 'video', kind: 'video', title: 'Rain', categoryId: 'shots', position: { x: 0, y: 0 }, status: 'success',
  result: { id: 'result', type: 'video', url: 'nomi-local://video', createdAt: 1, durationSeconds: 12 },
} as GenerationCanvasNode
const binding = { projectId: 'a', immutableProjectUuid: 'uuid-a', projectGeneration: 1 }
const state = () => useGenerationCanvasStore.getState()
const frameCards = () => state().nodes.filter((node) => node.id !== 'video')

beforeEach(() => {
  vi.clearAllMocks()
  fixture.controller = new AbortController()
  __resetGenerationCanvasHistoryForTests()
  state().restoreSnapshot({ nodes: [structuredClone(video)], edges: [], selectedNodeIds: [], groups: [] })
})

describe('截帧落卡', () => {
  it.each(['first', 'last', { atSeconds: 7.2 }] as const)('A→B→A 之后不落卡、不报迟到的错（%j）', async (request) => {
    fixture.extract.mockImplementation(async () => { fixture.controller.abort(); fixture.controller = new AbortController(); return { url: 'nomi-local://frame' } })
    const feedback = vi.fn()
    await extractVideoFrameToNode(video, request, feedback)
    expect(frameCards()).toHaveLength(0)
    expect(feedback).not.toHaveBeenCalled()
  })

  it('当前帧：抽的就是菜单上写的那一秒；旁边落一张图片卡并连线，来源写在卡上', async () => {
    fixture.extract.mockResolvedValue({ url: 'nomi-local://frame-7.2' })
    await extractVideoFrameToNode(video, { atSeconds: 7.2 }, vi.fn())
    expect(fixture.extract).toHaveBeenCalledWith({ videoUrl: 'nomi-local://video', which: 7.2, projectId: 'a', projectBinding: binding })
    const [card] = frameCards()
    expect(card).toMatchObject({ kind: 'image', status: 'success', result: { type: 'image', url: 'nomi-local://frame-7.2' } })
    expect(card.title).toContain('0:07.2')
    expect(card.meta).toMatchObject({ sourceVideoNodeId: 'video', sourceFrame: 'time', sourceTime: 7.2 })
    expect(state().edges.map((edge) => [edge.source, edge.target])).toEqual([['video', card.id]])
  })

  it('首帧 / 尾帧：来源时间写在卡上（尾帧 = 已知时长 − 0.1）', async () => {
    fixture.extract.mockResolvedValue({ url: 'nomi-local://frame' })
    await extractVideoFrameToNode(video, 'first', vi.fn())
    await extractVideoFrameToNode(video, 'last', vi.fn())
    const metas = frameCards().map((card) => card.meta)
    expect(metas).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceFrame: 'first', sourceTime: 0 }),
      expect.objectContaining({ sourceFrame: 'last', sourceTime: 11.9 }),
    ]))
    expect(fixture.extract).toHaveBeenCalledWith(expect.objectContaining({ which: 'last' }))
  })

  it('Ctrl+Z 一次：卡和线一起没有', async () => {
    fixture.extract.mockResolvedValue({ url: 'nomi-local://frame' })
    await extractVideoFrameToNode(video, { atSeconds: 7.2 }, vi.fn())
    expect(frameCards()).toHaveLength(1)
    expect(state().edges).toHaveLength(1)
    state().undo()
    expect(frameCards()).toHaveLength(0)
    expect(state().edges).toHaveLength(0)
    expect(state().nodes.map((node) => node.id)).toEqual(['video'])
  })

  it('失败：新卡就是错误卡（本机处理失败，只留重试），原视频不动，一次撤销也撤干净', async () => {
    fixture.extract.mockRejectedValue(new Error('ffmpeg 抽帧失败（code 1）：boom'))
    const feedback = vi.fn()
    await extractVideoFrameToNode(video, { atSeconds: 7.2 }, feedback)
    const [card] = frameCards()
    expect(card).toMatchObject({ kind: 'image', status: 'error' })
    expect(card.result).toBeUndefined()
    expect(card.meta).toMatchObject({ retryableFrame: true, sourceVideoNodeId: 'video', sourceTime: 7.2 })
    const report = classifyGenerationError(card.error ?? '')
    expect(report.kind).toBe('local-processing')
    expect([report.primary, report.secondary]).toEqual(['retry', null])
    expect(report.raw).toContain('boom')
    expect(feedback).not.toHaveBeenCalled() // 错误卡自己就是回执
    expect(state().nodes.find((node) => node.id === 'video')).toMatchObject({ status: 'success', result: { url: 'nomi-local://video' } })
    state().undo()
    expect(state().nodes.map((node) => node.id)).toEqual(['video'])
    expect(state().edges).toHaveLength(0)
  })

  it('失败卡的「重试」重抽同一张卡（同一秒），成功后变成图片卡', async () => {
    fixture.extract.mockRejectedValueOnce(new Error('boom'))
    await extractVideoFrameToNode(video, { atSeconds: 7.2 }, vi.fn())
    const [failed] = frameCards()
    const retry = localRetryOf(state().nodes.find((node) => node.id === failed.id)!, vi.fn())
    expect(retry).not.toBeNull()
    fixture.extract.mockResolvedValueOnce({ url: 'nomi-local://frame-retried' })
    await retryVideoFrameCapture(failed.id, vi.fn())
    expect(fixture.extract).toHaveBeenLastCalledWith(expect.objectContaining({ which: 7.2 }))
    expect(frameCards()).toHaveLength(1)
    expect(state().nodes.find((node) => node.id === failed.id)).toMatchObject({ status: 'success', result: { url: 'nomi-local://frame-retried' }, meta: { retryableFrame: false } })
  })

  it('重试时来源视频已经不在画布上：如实说，不冒充', async () => {
    fixture.extract.mockRejectedValueOnce(new Error('boom'))
    await extractVideoFrameToNode(video, 'first', vi.fn())
    const [failed] = frameCards()
    state().deleteNode('video')
    const feedback = vi.fn()
    await retryVideoFrameCapture(failed.id, feedback)
    expect(feedback).toHaveBeenCalledOnce()
    expect(fixture.extract).toHaveBeenCalledTimes(1)
  })
})
