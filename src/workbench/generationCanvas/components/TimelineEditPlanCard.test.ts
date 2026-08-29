import { describe, expect, it } from 'vitest'
import { describeTimelineOperation } from './timelineEditPlanModel'

const translate = (key: string, values?: Record<string, unknown>): string => {
  const leaf = key.split('.').at(-1) ?? key
  if (key.includes('.edges.')) return leaf
  return `${leaf}:${JSON.stringify(values ?? {})}`
}

describe('TimelineEditPlanCard operation summaries', () => {
  it('summarizes the supported edit operations without exposing raw JSON', () => {
    expect(describeTimelineOperation({ kind: 'move', clipId: 'clip-1', startFrame: 30 }, translate))
      .toBe('move:{"clip":"clip-1","frame":30}')
    expect(describeTimelineOperation({ kind: 'trim', clipId: 'clip-2', edge: 'right', deltaFrame: -6 }, translate))
      .toBe('trim:{"clip":"clip-2","delta":-6,"edge":"right"}')
    expect(describeTimelineOperation({ kind: 'source-window', clipId: 'clip-3', sourceStartFrame: 4, sourceEndFrame: 40 }, translate))
      .toBe('source-window:{"clip":"clip-3","start":4,"end":40}')
    expect(describeTimelineOperation({ kind: 'remove', clipIds: ['clip-4', 'clip-5'] }, translate))
      .toBe('remove:{"clip":"clip-4, clip-5"}')
  })

  it('keeps an unknown operation visible as a safe generic label', () => {
    expect(describeTimelineOperation({ kind: 'future-op', clipId: 'clip-4' }, translate))
      .toBe('unknown:{"clip":"clip-4"}')
  })
})
