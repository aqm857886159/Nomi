import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { importWithRetry, lazyWithChunkBoundary } from './chunkBoundary'

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

// 回归（2026-06-13 真机走查实锤）：lazy 实例若在返回的组件**内部**用 useState/
// useMemo 创建，首次渲染 suspend 时 React 丢弃 hook 状态、重试又新建 lazy → 新
// pending promise → 永久 suspend，整个 app 卡在 loading 打不开。lazy 必须模块级
// 创建一次。本测试在非渲染上下文调用组件函数：模块级版只 createElement 不调
// hooks → 不抛；任何把 lazy 放进组件内（含 hooks）的写法都会抛 "invalid hook call"。
describe('lazyWithChunkBoundary lazy 必须模块级创建', () => {
  it('返回的组件函数体不含 hooks（lazy 在工厂调用时建一次，渲染不新建）', () => {
    const Guarded = lazyWithChunkBoundary('test', () => Promise.resolve({ default: () => null }))
    expect(() => {
      Guarded({} as never)
      Guarded({} as never)
    }).not.toThrow()
  })
})
