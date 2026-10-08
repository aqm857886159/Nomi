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
