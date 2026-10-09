// 200 个节点的画布开着，图片一张张解码完会往节点 meta 里写尺寸（运行时测量）。这些写入不许让整张列表重排重绘：
// 第一次切到列表在 V-1128 的 200 节点项目里曾经 4~6 秒。
import { describe, expect, it } from 'vitest'
import type { GenerationCanvasNode } from '../../generationCanvas/model/generationCanvasTypes'
import { columnsFor, sameListNodes } from './generationListSource'

const node = (id: string, patch: Partial<GenerationCanvasNode> = {}): GenerationCanvasNode =>
  ({ id, kind: 'image', title: id, prompt: 'p', position: { x: 0, y: 0 }, status: 'success', categoryId: 'shots', meta: { aspect_ratio: '16:9' }, ...patch }) as GenerationCanvasNode

describe('sameListNodes', () => {
  it('ignores decoded-size measurements, position and size', () => {
    const before = [node('a'), node('b')]
    const measured = [{ ...before[0]!, meta: { ...before[0]!.meta, imageWidth: 1024, imageHeight: 576, imageAspectRatio: 16 / 9, cardInfoHeight: 40 } }, before[1]!]
    const moved = [{ ...measured[0]!, position: { x: 50, y: 50 }, size: { width: 400, height: 225 } }, before[1]!]
    expect(sameListNodes(before, measured)).toBe(true)
    expect(sameListNodes(before, moved)).toBe(true)
  })

  it('reacts to anything the list shows or groups by', () => {
    const before = [node('a'), node('b')]
    expect(sameListNodes(before, [{ ...before[0]!, status: 'running' }, before[1]!])).toBe(false)
    expect(sameListNodes(before, [{ ...before[0]!, title: 'renamed' }, before[1]!])).toBe(false)
    expect(sameListNodes(before, [{ ...before[0]!, prompt: 'changed' }, before[1]!])).toBe(false)
    expect(sameListNodes(before, [{ ...before[0]!, meta: { aspect_ratio: '9:16' } }, before[1]!])).toBe(false)
    expect(sameListNodes(before, [{ ...before[0]!, meta: { ...before[0]!.meta, shotId: 's1', storyboardDesignId: 'd' } }, before[1]!])).toBe(false)
    expect(sameListNodes(before, [before[0]!])).toBe(false)
  })
})

describe('columnsFor', () => {
  it('fixed 256 cards with 24 gaps and 32 side padding: as many columns as fit, at least one', () => {
    expect(columnsFor(200)).toBe(1)
    expect(columnsFor(1000)).toBe(3)
    expect(columnsFor(1440)).toBe(5)
  })
})
