import { createProgress } from '../generationCanvas/store/runRecordHelpers'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { GenerationCanvasNode } from '../generationCanvas/model/generationCanvasTypes'
import { generationFeedback, SAVED_FEEDBACK_WINDOW_MS } from './generationFeedback'
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
  expect(generationFeedback(done, 19000)?.saved).toBe(true)
  expect(generationFeedback(done, 19000)).not.toBe(first)
})

it('「已保存到项目」是限时回执，不是节点的常驻状态', () => {
  // 2026-09-11 用户实测：每一个做完的图片节点下面都永久挂着这一条。
  // 图已经在画面里了，那才是「保存成功」最强的证据；文字只在刚落地那几秒有意义。
  const run = (completedAt: number) => [{ id: 'r', status: 'success' as const, startedAt: 0, updatedAt: completedAt, completedAt }]
  const saved = { ...node(), status: 'success' as const, runs: run(19000) }
  expect(generationFeedback(saved, 19000)?.saved).toBe(true)
  expect(generationFeedback({ ...saved, id: 'a' }, 19000 + SAVED_FEEDBACK_WINDOW_MS - 1)?.saved).toBe(true)
  expect(generationFeedback({ ...saved, id: 'b' }, 19000 + SAVED_FEEDBACK_WINDOW_MS)).toBeNull()
  // 重开项目读回来的老节点：完成时刻早就过去了，一条都不该冒出来。
  expect(generationFeedback({ ...saved, id: 'c', runs: run(1) }, 19000)).toBeNull()
  // 连 run 记录都没有（老项目）——同样不显示，而不是退回到常驻。
  expect(generationFeedback({ ...saved, id: 'd', runs: [] }, 19000)).toBeNull()
})
