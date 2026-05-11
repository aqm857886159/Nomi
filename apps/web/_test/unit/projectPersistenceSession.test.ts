import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  setActiveWorkbenchProjectSaveTarget,
  subscribeWorkbenchProjectPersistence,
  persistActiveWorkbenchProjectNow,
} from '../../src/workbench/project/workbenchProjectSession'
import { useGenerationCanvasStore } from '../../src/workbench/generationCanvasV2/store/generationCanvasStore'
import { useWorkbenchStore } from '../../src/workbench/workbenchStore'

function makeOptions(overrides: Partial<Parameters<typeof subscribeWorkbenchProjectPersistence>[0]> = {}) {
  const saveProject = vi.fn().mockResolvedValue({ id: 'p1', name: 'P', version: 1, createdAt: 1, updatedAt: 1, payload: {} })
  const onSaved = vi.fn()
  return {
    projectId: 'p1',
    projectName: 'P',
    isHydrating: () => false,
    canPersist: () => true,
    saveProject,
    onSaved,
    ...overrides,
  }
}

describe('subscribeWorkbenchProjectPersistence', () => {
  beforeEach(() => {
    setActiveWorkbenchProjectSaveTarget(null)
    vi.restoreAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // Bug 1: dispose 间隙 — React useEffect 先 cleanup 旧订阅再 setup 新订阅
  // 修复前：旧订阅 dispose 时清空 target，新订阅建立前的间隙里 persistActiveWorkbenchProjectNow 返回 null
  // 修复后：dispose 不清空 target，新订阅直接覆盖
  it('persistActiveWorkbenchProjectNow succeeds in the gap between dispose and re-subscribe', async () => {
    const opts = makeOptions()
    const dispose = subscribeWorkbenchProjectPersistence(opts)

    // 模拟 React useEffect cleanup（旧订阅 dispose）
    dispose()

    // 间隙：新订阅还没建立，此时调用 persistActiveWorkbenchProjectNow
    const result = await persistActiveWorkbenchProjectNow()

    // 修复后：target 仍然存在，保存成功
    expect(opts.saveProject).toHaveBeenCalledTimes(1)
    expect(result).not.toBeNull()
  })

  it('new subscription overwrites target from disposed subscription', async () => {
    const opts1 = makeOptions({ projectId: 'p1' })
    const opts2 = makeOptions({ projectId: 'p2' })

    const dispose1 = subscribeWorkbenchProjectPersistence(opts1)
    dispose1()

    // 新项目订阅建立
    subscribeWorkbenchProjectPersistence(opts2)

    await persistActiveWorkbenchProjectNow()

    // 应该保存的是新项目 p2，不是旧项目 p1
    expect(opts2.saveProject).toHaveBeenCalledTimes(1)
    expect(opts1.saveProject).not.toHaveBeenCalled()
  })

  it('debounces rapid store changes into one autosave', async () => {
    vi.useFakeTimers()
    const opts = makeOptions({ autoSaveDelayMs: 100 })
    const dispose = subscribeWorkbenchProjectPersistence(opts)

    useGenerationCanvasStore.getState().setGenerationAiDraft('a')
    await vi.advanceTimersByTimeAsync(99)
    useGenerationCanvasStore.getState().setGenerationAiDraft('ab')
    await vi.advanceTimersByTimeAsync(99)

    expect(opts.saveProject).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)

    expect(opts.saveProject).toHaveBeenCalledTimes(1)
    dispose()
  })
})

describe('runGenerationNode: persist failure does not corrupt node status', () => {
  beforeEach(() => {
    useGenerationCanvasStore.getState().restoreSnapshot({
      nodes: [{ id: 'n1', kind: 'image', title: 'Image', position: { x: 0, y: 0 }, prompt: 'test' }],
      edges: [],
      selectedNodeIds: [],
    })
    setActiveWorkbenchProjectSaveTarget(null)
    vi.restoreAllMocks()
  })

  it('node result is saved to store even when persistActiveWorkbenchProjectNow has no target', async () => {
    // target 为 null 模拟间隙场景
    setActiveWorkbenchProjectSaveTarget(null)

    const { runGenerationNode } = await import('../../src/workbench/generationCanvasV2/runner/generationRunController')

    const fakeResult = { id: 'r1', type: 'image' as const, url: 'https://cdn.test/img.png', createdAt: Date.now() }
    const executor = vi.fn().mockResolvedValue(fakeResult)

    await runGenerationNode('n1', { executor })

    const node = useGenerationCanvasStore.getState().nodes.find((n) => n.id === 'n1')
    // 节点状态应该是 success，不是 error
    expect(node?.status).toBe('success')
    expect(node?.result?.url).toBe('https://cdn.test/img.png')
  })

  it('node result is saved to store even when persistActiveWorkbenchProjectNow throws', async () => {
    setActiveWorkbenchProjectSaveTarget({
      projectId: 'p1',
      projectName: 'P',
      canPersist: () => true,
      saveProject: vi.fn().mockRejectedValue(new Error('storage quota exceeded')),
      onSaved: vi.fn(),
    })

    const { runGenerationNode } = await import('../../src/workbench/generationCanvasV2/runner/generationRunController')

    const fakeResult = { id: 'r2', type: 'image' as const, url: 'https://cdn.test/img2.png', createdAt: Date.now() }
    const executor = vi.fn().mockResolvedValue(fakeResult)

    // 修复前：saveProject 抛错 → 节点状态变为 error
    // 修复后：saveProject 抛错被吞掉，节点状态保持 success
    await runGenerationNode('n1', { executor })

    const node = useGenerationCanvasStore.getState().nodes.find((n) => n.id === 'n1')
    expect(node?.status).toBe('success')
    expect(node?.result?.url).toBe('https://cdn.test/img2.png')
  })
})
