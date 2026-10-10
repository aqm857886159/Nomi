import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import { __resetGenerationCanvasHistoryForTests, useGenerationCanvasStore } from '../store/generationCanvasStore'
import { classifyGenerationError } from '../../observability/classifyError'
import { requestTaskCancel } from '../runner/localTaskControl'

const fixture = vi.hoisted(() => ({
  controller: new AbortController(),
  trim: vi.fn(),
  cancelTrim: vi.fn(),
  progressListener: null as null | ((event: { jobId: string; ratio: number }) => void),
}))
vi.mock('../../../desktop/bridge', () => ({
  getDesktopBridge: () => ({
    video: {
      trim: fixture.trim,
      cancelTrim: fixture.cancelTrim,
      onTrimProgress: (callback: (event: { jobId: string; ratio: number }) => void) => { fixture.progressListener = callback; return () => { fixture.progressListener = null } },
    },
  }),
}))
vi.mock('../runner/runProjectDelivery', async () => {
  const store = await import('../store/generationCanvasStore')
  return {
    whenRunTargetLoaded: (_target: unknown, apply: () => void) => { apply(); return true },
    // 项目正打开：结局直接进画布（切走的分支由 runProjectDelivery 自己的测试覆盖）。
    deliverRunOutcome: async (_target: unknown, nodeId: string, outcome: { kind: string; result?: never; status?: never; error?: string }) => {
      const state = store.useGenerationCanvasStore.getState()
      if (outcome.kind === 'result') state.addNodeResult(nodeId, outcome.result as never)
      else state.setNodeStatus(nodeId, 'error', outcome.error)
    },
  }
})
vi.mock('../../project/projectCanvasReadSurface', () => ({
  isProjectImportCancellation: (error: { code?: string }) => error.code === 'project_binding_stale',
  withProjectAction: (run: (project: unknown) => unknown) => run({
    signal: fixture.controller.signal,
    binding: { projectId: 'a', immutableProjectUuid: 'uuid-a', projectGeneration: 1 },
    assertCurrent() { if (fixture.controller.signal.aborted) throw Object.assign(new Error('stale'), { code: 'project_binding_stale' }) },
  }),
}))
import { retryVideoTrim, startVideoTrim } from './trimVideoToNode'
import { localStepRedoOf } from './localStepRedo'

const video = {
  id: 'video', kind: 'video', title: 'Rain', categoryId: 'shots', position: { x: 0, y: 0 }, status: 'success',
  result: { id: 'result', type: 'video', url: 'nomi-local://video', createdAt: 1, durationSeconds: 24 },
} as GenerationCanvasNode
const state = () => useGenerationCanvasStore.getState()
const cards = () => state().nodes.filter((node) => node.id !== 'video')
const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

beforeEach(() => {
  vi.clearAllMocks()
  fixture.controller = new AbortController()
  fixture.progressListener = null
  __resetGenerationCanvasHistoryForTests()
  state().restoreSnapshot({ nodes: [structuredClone(video)], edges: [], selectedNodeIds: [], groups: [] })
})

describe('直接剪辑：落卡 / 进度 / 结果', () => {
  it('确认后先建一张连好线的新视频卡（剪辑中），标题带区间，来源与区间写在卡上；主进程拿到的就是面板上的区间', async () => {
    let finish!: (value: unknown) => void
    fixture.trim.mockReturnValue(new Promise((resolve) => { finish = resolve }))
    const id = startVideoTrim(video, { startSeconds: 6, endSeconds: 18 }, vi.fn())
    expect(id).not.toBeNull()
    const [card] = cards()
    expect(card).toMatchObject({ kind: 'video', status: 'running' })
    expect(card.title).toContain('0:06.0')
    expect(card.title).toContain('0:18.0')
    expect(card.meta).toMatchObject({ sourceVideoNodeId: 'video', trimStart: 6, trimEnd: 18 })
    expect(state().edges.map((edge) => [edge.source, edge.target])).toEqual([['video', card.id]])
    expect(fixture.trim).toHaveBeenCalledWith(expect.objectContaining({ videoUrl: 'nomi-local://video', startSeconds: 6, endSeconds: 18, projectId: 'a' }))
    // 进度：按 jobId 回到这张卡
    const jobId = fixture.trim.mock.calls[0][0].jobId
    fixture.progressListener?.({ jobId: 'someone-else', ratio: 0.9 })
    fixture.progressListener?.({ jobId, ratio: 0.62 })
    expect(state().nodes.find((node) => node.id === card.id)?.progress).toMatchObject({ percent: 62 })
    finish({ url: 'nomi-local://trimmed', durationSeconds: 12 })
    await flush()
    expect(state().nodes.find((node) => node.id === card.id)).toMatchObject({ status: 'success', result: { type: 'video', url: 'nomi-local://trimmed' } })
    expect(state().nodes.find((node) => node.id === 'video')).toMatchObject({ status: 'success', result: { url: 'nomi-local://video' } })
  })

  it('区间短于 0.1 秒：不建卡、说清原因', () => {
    const feedback = vi.fn()
    expect(startVideoTrim(video, { startSeconds: 5, endSeconds: 5.04 }, feedback)).toBeNull()
    expect(cards()).toHaveLength(0)
    expect(feedback).toHaveBeenCalledOnce()
  })

  it('卡 + 线是一个撤销步：Ctrl+Z 一次都没有（剪辑还在跑也一样）', () => {
    fixture.trim.mockReturnValue(new Promise(() => undefined))
    startVideoTrim(video, { startSeconds: 6, endSeconds: 18 }, vi.fn())
    expect(cards()).toHaveLength(1)
    state().undo()
    expect(state().nodes.map((node) => node.id)).toEqual(['video'])
    expect(state().edges).toHaveLength(0)
  })
})

describe('直接剪辑：成片落下之后的撤销', () => {
  it('成片已经落到卡上：Ctrl+Z 一次，卡和线整个没有（不是只撤掉最后一笔、更不是把带结果的卡叠回来）', async () => {
    fixture.trim.mockResolvedValue({ url: 'nomi-local://trimmed', durationSeconds: 12 })
    startVideoTrim(video, { startSeconds: 6, endSeconds: 18 }, vi.fn())
    await flush()
    expect(cards()[0]).toMatchObject({ status: 'success', result: { url: 'nomi-local://trimmed' } })
    state().undo()
    expect(state().nodes.map((node) => node.id)).toEqual(['video'])
    expect(state().edges).toHaveLength(0)
  })
})

describe('直接剪辑：取消 / 失败 / 重试', () => {
  it('取消 = 当没发生过：叫停主进程那一个任务、删掉这张还没出片的卡，原视频不动', async () => {
    let reject!: (error: Error) => void
    fixture.trim.mockReturnValue(new Promise((_resolve, rej) => { reject = rej }))
    fixture.cancelTrim.mockResolvedValue({ ok: true })
    startVideoTrim(video, { startSeconds: 6, endSeconds: 18 }, vi.fn())
    const [card] = cards()
    const jobId = fixture.trim.mock.calls[0][0].jobId
    requestTaskCancel(state().nodes.find((node) => node.id === card.id)!, vi.fn())
    expect(fixture.cancelTrim).toHaveBeenCalledWith({ jobId })
    reject(new Error('已取消'))
    await flush()
    expect(cards()).toHaveLength(0)
    expect(state().nodes.find((node) => node.id === 'video')).toMatchObject({ status: 'success' })
  })

  it('失败：同一张卡变本机处理错误卡（只留重试），原视频不动；重试读卡上的区间，成功后变新视频', async () => {
    fixture.trim.mockRejectedValueOnce(new Error('ffmpeg 剪辑失败（code 1）：boom'))
    startVideoTrim(video, { startSeconds: 6, endSeconds: 18 }, vi.fn())
    await flush()
    const [failed] = cards()
    expect(failed.status).toBe('error')
    const report = classifyGenerationError(failed.error ?? '')
    expect(report.kind).toBe('local-processing')
    expect([report.primary, report.secondary]).toEqual(['retry', null])
    expect(report.raw).toContain('boom')
    expect(localStepRedoOf(failed, vi.fn())).not.toBeNull()

    fixture.trim.mockResolvedValueOnce({ url: 'nomi-local://retried', durationSeconds: 12 })
    retryVideoTrim(failed.id, vi.fn())
    expect(state().nodes.find((node) => node.id === failed.id)?.status).toBe('running')
    await flush()
    expect(fixture.trim).toHaveBeenLastCalledWith(expect.objectContaining({ startSeconds: 6, endSeconds: 18 }))
    expect(cards()).toHaveLength(1)
    expect(state().nodes.find((node) => node.id === failed.id)).toMatchObject({ status: 'success', result: { url: 'nomi-local://retried' } })
  })

  it('重试时来源视频已经不在画布上：如实说，不冒充', async () => {
    fixture.trim.mockRejectedValueOnce(new Error('boom'))
    startVideoTrim(video, { startSeconds: 6, endSeconds: 18 }, vi.fn())
    await flush()
    const [failed] = cards()
    state().deleteNode('video')
    const feedback = vi.fn()
    retryVideoTrim(failed.id, feedback)
    expect(feedback).toHaveBeenCalledOnce()
    expect(fixture.trim).toHaveBeenCalledTimes(1)
  })

  it('换项目（A→B）：不在新项目里写失败卡', async () => {
    fixture.trim.mockImplementation(async () => { fixture.controller.abort(); throw Object.assign(new Error('stale'), { code: 'project_binding_stale' }) })
    startVideoTrim(video, { startSeconds: 6, endSeconds: 18 }, vi.fn())
    await flush()
    expect(cards()[0]?.status).toBe('running')
  })
})
