import { createProgress } from '../generationCanvas/store/runRecordHelpers'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { GenerationCanvasNode } from '../generationCanvas/model/generationCanvasTypes'
import { generationFeedback } from './generationFeedback'
import { GenerationStatusBar } from '../generationCanvas/nodes/GenerationStatusBar'

const node = (percent?: number): GenerationCanvasNode => ({ id: 'test', kind: 'image', title: '', position: { x: 0, y: 0 }, status: 'running', progress: { phase: 'generating', updatedAt: 1000, ...(percent === undefined ? {} : { percent }) } })
const html = (value: GenerationCanvasNode) => renderToStaticMarkup(React.createElement(GenerationStatusBar, { feedback: generationFeedback(value, 19000)! }))
describe('C1 feedback atom', () => {
  it('omits numbers without provider evidence and preserves a real percentage', () => {
    expect(html(node())).not.toContain('%')
    expect(html(node())).not.toMatch(/前面.*个/)
    expect(html(node(60))).toContain('60%')
    for (const invalid of [NaN, Infinity, -1, 101]) expect(html(node(invalid))).not.toContain('%')
  })
  it('returns the exact same narration object for simultaneous consumers', () => {
    const value = node()
    expect(generationFeedback(value, 19001)).toBe(generationFeedback(value, 19999))
    expect(generationFeedback(value, 19000)?.message).toBe('生成中 · 已等 18 秒')
  })
  it('does not mistake queue zero for a percentage', () => {
    const value = node(0); value.progress!.phase = 'comfyui-queued'
    expect(html(value)).not.toContain('%')
  })
})

it('waiting audio has equal-height bars and no invented preview', async () => {
  const { GenerationWaitingSurface } = await import('../generationCanvas/nodes/GenerationWaitingSurface')
  const markup = renderToStaticMarkup(React.createElement(GenerationWaitingSurface, { audio: true, previewLabel: 'preview' }))
  expect(markup).not.toContain('<img')
  expect(markup).not.toContain('data-process-progress')
  expect(markup.match(/class="h-6 w-1 shrink-0 rounded-full bg-nomi-ink-30"/g)).toHaveLength(24)
})

it('rejects invalid percentages before they can become seemingly real zero or one hundred', () => {
  for (const percent of [-1, 101, NaN, Infinity]) expect(createProgress({ percent }).percent).toBeUndefined()
  expect(createProgress({ percent: 60 }).percent).toBe(60)
})

it('does not reuse an active feedback object after an immutable status transition sharing progress', () => {
  const active = node()
  const first = generationFeedback(active, 19000)
  const done = { ...active, status: 'success' as const, runs: [{ id: 'r', status: 'success' as const, startedAt: 1000, updatedAt: 18000, completedAt: 18000 }] }
  expect(generationFeedback(done, 19000)).toBeNull()
  expect(generationFeedback(done, 19000)).not.toBe(first)
})

it('completed nodes do not create a redundant inline receipt', () => {
  const run = (completedAt: number) => [{ id: 'r', status: 'success' as const, startedAt: 0, updatedAt: completedAt, completedAt }]
  const saved = { ...node(), status: 'success' as const, runs: run(19000) }
  expect(generationFeedback(saved, 19000)).toBeNull()
  expect(generationFeedback({ ...saved, id: 'old', runs: run(1) }, 19000)).toBeNull()
  expect(generationFeedback({ ...saved, id: 'legacy', runs: [] }, 19000)).toBeNull()
})

it('motion-reduced generation and import keep a static grid without a blue band or fabricated image', async () => {
  const { GenerationWaitingSurface } = await import('../generationCanvas/nodes/GenerationWaitingSurface')
  for (const props of [{ motion: 'reduced' as const }, { zoom: 0.39 }, { inViewport: false }, { motion: 'reduced' as const, progressReveal: { ratio: 0.42 } }]) {
    const markup = renderToStaticMarkup(React.createElement(GenerationWaitingSurface, { previewLabel: '', ...props }))
    expect(markup).toContain('data-process-static-grid')
    expect(markup).not.toContain('data-process-static-band')
    expect(markup).not.toContain('waiting-band')
    expect(markup).not.toContain('<img')
    expect(markup).not.toContain('data-process-progress')
  }
  const audio = renderToStaticMarkup(React.createElement(GenerationWaitingSurface, { audio: true, previewLabel: '' }))
  expect(audio).toContain('data-process-audio-waiting')
  expect(audio).not.toContain('data-process-static-grid')
  expect(audio).not.toContain('data-process-static-band')
})
