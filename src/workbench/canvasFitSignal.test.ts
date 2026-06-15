import { describe, it, expect } from 'vitest'
import { useWorkbenchStore } from './workbenchStore'

// 「请画布适应视图」一次性信号：落画布后揭示新镜头的根因修复。
// useAutoFitOnLoad 只在首次加载/切分类触发，落画布在已加载画布加节点不重跑 →
// 新镜头落视口外、用户以为「没反应」。requestCanvasFit bump nonce，画布消费后平滑 fit。
describe('requestCanvasFit（落画布揭示新镜头信号）', () => {
  it('初始 canvasFitNonce 为 0', () => {
    expect(useWorkbenchStore.getState().canvasFitNonce).toBe(0)
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
})
