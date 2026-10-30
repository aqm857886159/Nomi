import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { LightweightGenerationNode } from './LightweightGenerationNode'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'

vi.mock('../../observability/useGenerationFeedback', async () => {
  const { generationFeedback } = await import('../../observability/generationFeedback')
  return { useGenerationFeedback: (node: GenerationCanvasNode) => generationFeedback(node, 13000, node.id === 'queued-rerun', node.id === 'queued-rerun' ? 2 : undefined) }
})
// 夹具时钟钉在 13000：落地回执的窗口按 `completedAt` 算，所以这一条也钉在同一条时间线上。
const node: GenerationCanvasNode = { id: 'light-shot', kind: 'image', title: 'Shot', shotIndex: 2, position: { x: 0, y: 0 }, status: 'success', runs: [{ id: 'run-0', status: 'success', startedAt: 1000, updatedAt: 12000, completedAt: 12000 }] }
const render = (patch: Partial<GenerationCanvasNode>) => renderToStaticMarkup(React.createElement(LightweightGenerationNode, { node: { ...node, ...patch }, appear: false }))
describe('lightweight shots use the shared lifecycle feedback', () => {
  it('shows scheduled reruns instead of stale success', () => {
    expect(render({ id: 'queued-rerun' })).toContain('前面 2 个')
    expect(render({ id: 'queued-rerun' })).not.toContain('已保存到项目')
  })
  it('keeps active elapsed time, completion and failure reason', () => {
    expect(render({ status: 'running', progress: { phase: 'generating', updatedAt: 1000 } })).toContain('已等 12 秒')
    expect(render({})).not.toContain('已保存到项目')
    // 同一个节点，窗口过完就不再挂那一条（落地回执是一次性的，不是常驻状态）。
    expect(render({ runs: [{ id: 'run-0', status: 'success', startedAt: 0, updatedAt: 1, completedAt: 1 }] })).not.toContain('已保存到项目')
    expect(render({ status: 'error', error: 'SpecificUnrecognizedProviderFailure' })).toContain('SpecificUnrecognizedProviderFailure')
  })
})

// LOD 是「画多细」，不是「是谁、什么状态」。这一条把身份三件套钉在两档共同的契约上：
// 少了 data-status，下游（走查、样式、任何按状态选择的消费者）就会在卡片掉档的那一刻
// 静默失明——那正是屏幕尺寸 LOD（#787 的另一半）被撤出批次的机制。
describe('两档共用同一份身份契约', () => {
  it('轻量档也带 data-node-id / data-kind / data-status', () => {
    const markup = render({})
    expect(markup).toContain('data-node-id="light-shot"')
    expect(markup).toContain('data-kind="image"')
    expect(markup).toContain('data-status="success"')
    expect(render({ status: 'error', error: 'x' })).toContain('data-status="error"')
    expect(render({ status: 'running' })).toContain('data-status="running"')
  })
})

// 用户 10-12 拍板「悬停也能拖」：远看也算数，但只挂在光标所在的那张卡上。真挂上、真拖得动由
// clip-drop-zoom 走查的 50% 档（画布验收套件 far-zoom-clip-drop）守；这里守「光标不在时不白加 DOM」。
describe('远看卡的拖入把手', () => {
  it('光标不在卡上时不挂把手', () => {
    expect(render({ result: { id: 'r', type: 'image', url: 'file:///a.png', createdAt: 1 } })).not.toContain('data-node-timeline-hover-handle')
  })
})

// Suspense 兜底（种类渲染器 chunk 没到）和真正的轻量档长得一样，但它马上会被整棵换掉；
// 只有兜底带 data-node-loading，走查按它等「卡已经是正式的」再点，免得点击落在即将被摘掉的元素上而丢掉。
describe('Suspense 兜底带 loading 标记', () => {
  it('只有兜底态带 data-node-loading', () => {
    expect(render({})).not.toContain('data-node-loading')
    const loading = renderToStaticMarkup(React.createElement(LightweightGenerationNode, { node, appear: false, loading: true }))
    expect(loading).toContain('data-node-loading="true"')
    expect(loading).toContain('data-render-mode="lightweight"')
  })
})
