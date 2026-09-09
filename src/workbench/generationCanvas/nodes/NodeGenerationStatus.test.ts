import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it } from 'vitest'
import { NodeErrorReport } from './NodeErrorReport'
import { NodeGenerationStatus } from './NodeGenerationStatus'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'

import { selectGenerationFeedbackNode } from '../../observability/useGenerationFeedback'
import { generationFeedback } from '../../observability/generationFeedback'
import { useGenerationQueueStore } from '../runner/generationQueueStore'
afterEach(() => useGenerationQueueStore.setState({ entries: [], batches: {} }))

const node: GenerationCanvasNode = { id: 'shot-status', kind: 'image', title: '', position: { x: 0, y: 0 }, status: 'success' }
describe('shot inline lifecycle feedback', () => {
  it('keeps completion visible in its own node', () => {
    expect(renderToStaticMarkup(React.createElement(NodeGenerationStatus, { node }))).toContain('已保存到项目')
  })
  it('keeps the failed phase and reason next to its node', () => {
    const html = renderToStaticMarkup(React.createElement(NodeGenerationStatus, { node: { ...node, status: 'error', error: '服务连接中断' } }))
    expect(html).toContain('data-phase="failed"')
    expect(html).toContain('data-generation-message')
  })
})


it('a queued rerun keeps its queue position instead of showing the previous success', () => {
  useGenerationQueueStore.setState({ entries: ['other', node.id].map((nodeId, index) => ({ id: `entry-${index}`, batchId: 'batch', nodeId, state: 'queued', waveIndex: 0, enqueuedAt: 1 })) })
  const selected = selectGenerationFeedbackNode(node, null, useGenerationQueueStore.getState().entries)
  const feedback = generationFeedback(selected.current!, Date.now(), selected.queued, selected.queueAhead)
  expect(feedback?.phase).toBe('queued')
  expect(feedback?.message).toContain('前面 1 个')
  expect(feedback?.saved).toBe(false)
})

it('a failed prerequisite stays visible even when the shot itself is recoverable', () => {
  const html = renderToStaticMarkup(React.createElement(NodeGenerationStatus, {
    node: { ...node, status: 'recoverable' },
    keyframeNode: { ...node, id: 'keyframe', status: 'error', error: 'network timeout' },
  }))
  expect(html).toContain('data-phase="failed"')
})

it('an active prerequisite owns feedback even if the shot has an old result', () => {
  const html = renderToStaticMarkup(React.createElement(NodeGenerationStatus, {
    node,
    keyframeNode: { ...node, id: 'keyframe', status: 'running', progress: { phase: 'generating', updatedAt: Date.now() - 12000 } },
  }))
  expect(html).toContain('生成中')
  expect(html).not.toContain('已保存到项目')
})


it('keeps exactly one failure summary while retaining the existing recovery actions', () => {
  const failed = { ...node, status: 'error' as const, error: 'SpecificProviderFailure' }
  const html = renderToStaticMarkup(React.createElement(React.Fragment, null,
    React.createElement(NodeGenerationStatus, { node: failed }),
    React.createElement(NodeErrorReport, { message: failed.error, summaryVisible: false, onRetry: () => {} }),
  ))
  expect(html.match(/data-generation-status=/g)).toHaveLength(1)
  expect(html).toContain('role="alert"')
  expect(html).toContain('SpecificProviderFailure')
  expect(html).toContain('重试')
})
