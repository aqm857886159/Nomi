// 拉环菜单：左「+」= 给它加输入（以本卡为目标判、新节点落成上游），右「+」= 用这个节点生成（以本卡为源）。
// 点一下「+」（bug ①）与拖到空白处松手出的是同一个菜单、同一份判据；选一项是**一步撤销**。
import { beforeEach, describe, expect, it } from 'vitest'
import type { GenerationCanvasNode, GenerationNodeKind } from '../model/generationCanvasTypes'
import { useGenerationCanvasStore, __resetGenerationCanvasHistoryForTests } from '../store/generationCanvasStore'
import { connectionMenuVerdicts, handleMenuAnchor, resolveRingMenuPlacement } from './connectionMenuModel'
import { createConnectedNode } from './nodeInputActions'

const state = () => useGenerationCanvasStore.getState()
function node(id: string, kind: GenerationNodeKind, meta: Record<string, unknown> = {}): GenerationCanvasNode {
  return { id, kind, title: id, position: { x: 600, y: 200 }, size: { width: 420, height: 240 }, categoryId: 'shots', meta }
}
const okKinds = (verdicts: readonly { kind: string; ok: boolean }[]) => verdicts.filter((verdict) => verdict.ok).map((verdict) => verdict.kind)

beforeEach(() => {
  __resetGenerationCanvasHistoryForTests()
  state().restoreSnapshot({ nodes: [], edges: [], groups: [] })
})

describe('which menu a ring opens', () => {
  it('left 「+」 on a video card offers its inputs: images and text are not greyed (bug ②)', () => {
    state().restoreSnapshot({ nodes: [node('video', 'video')], edges: [], groups: [] })
    expect(okKinds(connectionMenuVerdicts({ nodeId: 'video', side: 'left', sourceKind: 'node' }))).toEqual(expect.arrayContaining(['image', 'text']))
  })

  it('left 「+」 on a text card offers images and text only (10-09: a text card has a left ring)', () => {
    state().restoreSnapshot({ nodes: [node('text', 'text')], edges: [], groups: [] })
    expect(okKinds(connectionMenuVerdicts({ nodeId: 'text', side: 'left', sourceKind: 'node' }))).toEqual(['image', 'text'])
  })

  it('right 「+」 keeps the 「用这个节点生成」 verdicts (an image can now also feed a text card: describe-image)', () => {
    state().restoreSnapshot({ nodes: [{ ...node('image', 'image'), result: { id: 'r', type: 'image', url: 'nomi-local://a.png', createdAt: 1 } }], edges: [], groups: [] })
    expect(okKinds(connectionMenuVerdicts({ nodeId: 'image', side: 'right', sourceKind: 'node' }))).toEqual(['image', 'video', 'text'])
  })

  it('a click anchors the menu under the ring (left edge of the ring, 6px below)', () => {
    expect(handleMenuAnchor({ left: 100, top: 40, right: 129, bottom: 69, width: 29, height: 29 })).toEqual({ x: 100, y: 75 })
  })

  it('a click (no drop point) places the new node beside the card, on the side of the ring', () => {
    const card = node('video', 'video')
    const left = resolveRingMenuPlacement(card, 'left', 'image')
    const right = resolveRingMenuPlacement(card, 'right', 'image')
    expect(left.x).toBeLessThan(card.position.x)
    expect(right.x).toBeGreaterThan(card.position.x + 420)
    expect(left.y).toBe(card.position.y)
  })
})

describe('picking 「图片」 from the left menu of a video card', () => {
  it.each([
    ['first-frame mode', { archetype: { id: 'seedance-2', modeId: 'first' } }, 'first_frame'],
    ['text-to-video mode (lands as a reference)', { archetype: { id: 'seedance-2', modeId: 't2v' } }, 'character_ref'],
    ['no model yet', {}, 'first_frame'],
  ] as const)('creates an image node UPSTREAM — %s', (_label, meta, mode) => {
    state().restoreSnapshot({ nodes: [node('video', 'video', meta)], edges: [], groups: [] })
    const before = state().readDocumentSnapshot()
    const created = createConnectedNode({ anchorNodeId: 'video', side: 'left', sourceKind: 'node', kind: 'image', position: { x: 200, y: 200 }, exactPosition: true })
    expect(created).toBeTruthy()
    expect(state().nodes.find((candidate) => candidate.id === created)?.kind).toBe('image')
    expect(state().edges).toEqual([expect.objectContaining({ source: created, target: 'video', mode })])
    state().undo()
    expect(state().readDocumentSnapshot()).toEqual(before)
  })

  it('right 「+」 → 视频 creates the video DOWNSTREAM', () => {
    state().restoreSnapshot({ nodes: [{ ...node('image', 'image'), result: { id: 'r', type: 'image', url: 'nomi-local://a.png', createdAt: 1 } }], edges: [], groups: [] })
    const created = createConnectedNode({ anchorNodeId: 'image', side: 'right', sourceKind: 'node', kind: 'video', position: { x: 1200, y: 200 }, exactPosition: true })
    expect(state().edges).toEqual([expect.objectContaining({ source: 'image', target: created })])
  })
})
