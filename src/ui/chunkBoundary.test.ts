import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { importWithRetry } from './chunkBoundary'

// 审计 A5：chunk 加载的瞬时失败（构建竞态/IO 抖动）由工厂层自动重试吃掉，
// 持久失败再交给 ChunkErrorBoundary 降级该区域（不再全 app 崩根错误页）。
describe('importWithRetry', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('瞬时失败自动重试：败两次后成功 → 整体成功', async () => {
    let calls = 0
    const factory = vi.fn(() => {
      calls += 1
      return calls < 3 ? Promise.reject(new Error('transient')) : Promise.resolve({ default: 'ok' })
    })
    const promise = importWithRetry(factory)
    await vi.runAllTimersAsync()
    await expect(promise).resolves.toEqual({ default: 'ok' })
    expect(factory).toHaveBeenCalledTimes(3)
  })

  it('持久失败重试耗尽 → 以原错误拒绝（交给边界降级）', async () => {
    const factory = vi.fn(() => Promise.reject(new Error('chunk gone')))
    const promise = importWithRetry(factory)
    promise.catch(() => {}) // 防 unhandled rejection 噪音
    await vi.runAllTimersAsync()
    await expect(promise).rejects.toThrow('chunk gone')
    expect(factory).toHaveBeenCalledTimes(3) // 1 次 + 2 次重试
  })
})
