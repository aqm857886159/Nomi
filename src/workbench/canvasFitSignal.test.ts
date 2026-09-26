import { describe, it, expect } from 'vitest'
import { useWorkbenchStore } from './workbenchStore'

// 「请画布适应视图」一次性信号的语义（nonce 递增、可带目标分类）。2026-09-25 起它只由用户显式动作触发
// （谁能调见 canvasViewportMovers.structure.test.ts），落画布 / 导入不再用它揭示新镜头——改由画布边缘提示指路。
describe('requestCanvasFit（用户显式「去看看」的适应信号）', () => {
  it('初始 canvasFitNonce 为 0', () => {
    expect(useWorkbenchStore.getState().canvasFitNonce).toBe(0)
    expect(useWorkbenchStore.getState().canvasFitCategoryId).toBeNull()
  })

  it('每次 requestCanvasFit 单调递增 nonce（一次性信号，消费端按变化触发）', () => {
    const before = useWorkbenchStore.getState().canvasFitNonce
    useWorkbenchStore.getState().requestCanvasFit()
    const after1 = useWorkbenchStore.getState().canvasFitNonce
    expect(after1).toBe(before + 1)
    useWorkbenchStore.getState().requestCanvasFit()
    expect(useWorkbenchStore.getState().canvasFitNonce).toBe(after1 + 1)
  })

  it('不动 persistRevision（视口意图非持久化产物，别触发回存）', () => {
    const rev = useWorkbenchStore.getState().persistRevision
    useWorkbenchStore.getState().requestCanvasFit()
    expect(useWorkbenchStore.getState().persistRevision).toBe(rev)
  })

  it('显式目标分类与 nonce 原子更新并立即切换', () => {
    useWorkbenchStore.getState().setActiveCategoryId('audio')
    useWorkbenchStore.getState().requestCanvasFit('shots')
    expect(useWorkbenchStore.getState().activeCategoryId).toBe('shots')
    expect(useWorkbenchStore.getState().canvasFitCategoryId).toBe('shots')
  })
})
