import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { LightweightGenerationNode } from './LightweightGenerationNode'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'

vi.mock('../../observability/useGenerationFeedback', async () => {
  const { generationFeedback } = await import('../../observability/generationFeedback')
  return { useGenerationFeedback: (node: GenerationCanvasNode) => generationFeedback(node, 13000, node.id === 'queued-rerun', node.id === 'queued-rerun' ? 2 : undefined) }
})
const node: GenerationCanvasNode = { id: 'light-shot', kind: 'image', title: 'Shot', shotIndex: 2, position: { x: 0, y: 0 }, status: 'success' }
const render = (patch: Partial<GenerationCanvasNode>) => renderToStaticMarkup(React.createElement(LightweightGenerationNode, { node: { ...node, ...patch }, appear: false }))
describe('lightweight shots use the shared lifecycle feedback', () => {
  it('shows scheduled reruns instead of stale success', () => {
    expect(render({ id: 'queued-rerun' })).toContain('前面 2 个')
    expect(render({ id: 'queued-rerun' })).not.toContain('已保存到项目')
  })
  it('keeps active elapsed time, completion and failure reason', () => {
    expect(render({ status: 'running', progress: { phase: 'generating', updatedAt: 1000 } })).toContain('已等 12 秒')
    expect(render({})).toContain('已保存到项目')
    expect(render({ status: 'error', error: 'SpecificUnrecognizedProviderFailure' })).toContain('SpecificUnrecognizedProviderFailure')
  })
})
