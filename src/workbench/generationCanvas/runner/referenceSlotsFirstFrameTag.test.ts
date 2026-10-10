import { describe, expect, it } from 'vitest'
import { resolveReferenceSlots, firstFrameTaggedSlot } from './referenceSlots'
import type { GenerationCanvasEdge, GenerationCanvasNode } from '../model/generationCanvasTypes'

// 2026-10-08 用户「删掉连线中间的标签吗，没有作用」：连线中点的用途胶囊删了，用途改在节点上看得见（铁律⑩ 说的=摆的）。
// 只有 image_ref 数组槽（没有单独首帧槽的视频档案，如 runway-gen4.5）里，首帧 = image_ref[0]，从槽里看不出来 ——
// 这时存在 first_frame 边才在第一张缩略图上标「首帧」；只有 reference 边不标；有独立首帧槽的档案（kling、hailuo、veo）不标。

function node(id: string, kind: string, opts: { url?: string; archetypeId?: string; modeId?: string } = {}): GenerationCanvasNode {
  return {
    id, kind: kind as GenerationCanvasNode['kind'], title: id, prompt: '', position: { x: 0, y: 0 }, size: { width: 100, height: 100 },
    meta: opts.archetypeId ? { archetype: { id: opts.archetypeId, modeId: opts.modeId || '' } } : {},
    ...(opts.url ? { result: { id: `r-${id}`, type: 'image', url: opts.url, createdAt: 0 } } : {}),
  }
}
const edge = (id: string, source: string, mode: GenerationCanvasEdge['mode']): GenerationCanvasEdge => ({ id, source, target: 'tgt', mode })

describe('firstFrameTaggedSlot', () => {
  const a = node('a', 'image', { url: 'https://cdn/a.png' })
  const b = node('b', 'image', { url: 'https://cdn/b.png' })

  it('image_ref-only video archetype with a first_frame edge → the image_ref slot is tagged', () => {
    const tgt = node('tgt', 'video', { archetypeId: 'runway-gen4.5', modeId: 'i2v' })
    const resolved = resolveReferenceSlots(tgt, [a, b, tgt], [edge('e1', 'a', 'first_frame'), edge('e2', 'b', 'reference')])
    expect(firstFrameTaggedSlot(resolved)?.slotKind).toBe('image_ref')
  })

  it('only reference edges → nothing tagged', () => {
    const tgt = node('tgt', 'video', { archetypeId: 'runway-gen4.5', modeId: 'i2v' })
    const resolved = resolveReferenceSlots(tgt, [a, b, tgt], [edge('e1', 'a', 'reference'), edge('e2', 'b', 'reference')])
    expect(firstFrameTaggedSlot(resolved)).toBeNull()
  })

  it('archetype with its own first_frame slot → nothing tagged (the slot already says it)', () => {
    const tgt = node('tgt', 'video', { archetypeId: 'hailuo-2.3' })
    const resolved = resolveReferenceSlots(tgt, [a, tgt], [edge('e1', 'a', 'first_frame')])
    expect(firstFrameTaggedSlot(resolved)).toBeNull()
  })
})
