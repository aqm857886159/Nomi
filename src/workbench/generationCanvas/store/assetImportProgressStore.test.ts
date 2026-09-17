import { beforeEach, describe, expect, it } from 'vitest'
import { importRevealRatio, useAssetImportProgressStore, __detachAssetImportProgressBridgeForTests } from './assetImportProgressStore'

describe('导入进度是渐显的唯一驱动', () => {
  beforeEach(() => { __detachAssetImportProgressBridgeForTests() })

  it('渐显比例逐字等于「已拷贝字节 / 总字节」，不掺时间', () => {
    expect(importRevealRatio({ copiedBytes: 0, totalBytes: 1_000 })).toBe(0)
    expect(importRevealRatio({ copiedBytes: 420, totalBytes: 1_000 })).toBe(0.42)
    expect(importRevealRatio({ copiedBytes: 1_000, totalBytes: 1_000 })).toBe(1)
  })

  it('总字节未知时一个格子都不显，而不是假装满了', () => {
    expect(importRevealRatio(undefined)).toBe(0)
    expect(importRevealRatio({ copiedBytes: 12, totalBytes: 0 })).toBe(0)
  })

  it('乱序到达的旧进度不把已经长出来的马赛克缩回去', () => {
    const store = useAssetImportProgressStore.getState()
    store.report('node-1', { copiedBytes: 800, totalBytes: 1_000, previewUrl: 'nomi-local://p/preview.jpg' })
    store.report('node-1', { copiedBytes: 300, totalBytes: 1_000 })
    const entry = useAssetImportProgressStore.getState().byNode['node-1']
    expect(entry.copiedBytes).toBe(800)
    // 首条带过来的预览 URL 不能被后续不带 URL 的进度事件抹掉：渐显的那张图就是它。
    expect(entry.previewUrl).toBe('nomi-local://p/preview.jpg')
  })

  it('导入结束即清，不留着让卡片继续显渐显', () => {
    const store = useAssetImportProgressStore.getState()
    store.report('node-2', { copiedBytes: 1, totalBytes: 2 })
    store.clear('node-2')
    expect(useAssetImportProgressStore.getState().byNode['node-2']).toBeUndefined()
  })

  it('收尾之后才到的预览事件不复活一条死进度（预览是和拷贝并行派生的，可能迟到）', () => {
    const store = useAssetImportProgressStore.getState()
    store.report('node-3', { copiedBytes: 0, totalBytes: 10 })
    store.clear('node-3')
    store.report('node-3', { copiedBytes: 10, totalBytes: 10, previewUrl: 'nomi-local://p/late.jpg' })
    expect(useAssetImportProgressStore.getState().byNode['node-3']).toBeUndefined()
  })

  it('「重试导入」的开场白（copiedBytes=0）能把上一轮的收尾标记抹掉', () => {
    const store = useAssetImportProgressStore.getState()
    store.report('node-4', { copiedBytes: 4, totalBytes: 8 })
    store.clear('node-4')
    store.report('node-4', { copiedBytes: 0, totalBytes: 8 })
    store.report('node-4', { copiedBytes: 8, totalBytes: 8 })
    expect(useAssetImportProgressStore.getState().byNode['node-4']?.copiedBytes).toBe(8)
  })
})

// 2026-09-17 走查 W-08 的回归：1.3 GB 真素材到 100% 之后还要约 5 秒（哈希重读整份文件、落库、
// 认领预览），那一段此前显示「100%」，和卡死长得一模一样。
describe('收尾段（W-08）', () => {
  it('phase 随事件带进来，收尾时比例已经是 1 但阶段不是 copying', () => {
    const store = useAssetImportProgressStore.getState()
    store.report('n-finalize', { copiedBytes: 0, totalBytes: 100, phase: 'preparing' })
    expect(useAssetImportProgressStore.getState().byNode['n-finalize']?.phase).toBe('preparing')
    store.report('n-finalize', { copiedBytes: 100, totalBytes: 100, phase: 'copying' })
    store.report('n-finalize', { copiedBytes: 100, totalBytes: 100, phase: 'finalizing' })
    const settledProgress = useAssetImportProgressStore.getState().byNode['n-finalize']
    expect(settledProgress?.phase).toBe('finalizing')
    expect(importRevealRatio(settledProgress)).toBe(1)
    useAssetImportProgressStore.getState().clear('n-finalize')
  })
})
