import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('timeline panel overflow layout', () => {
  it('keeps the track viewport vertically scrollable when derived rows exceed panel height', () => {
    const source = readFileSync(resolve(__dirname, 'TimelinePanel.tsx'), 'utf8')
    expect(source).toContain('overflow-y-auto')
    expect(source).not.toContain('overflow-x-auto overflow-y-hidden')
    expect(source).toContain('const showTextChip = showTextTrack')
    expect(source).toContain('{showTextTrack ? <TimelineTextTrack /> : null}')
    expect(source).toContain('new ResizeObserver(update)')
  })
})
