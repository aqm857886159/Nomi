import { describe, expect, it } from 'vitest'
import { planActiveStoryboardTimeline, planStoryboardTimeline } from './storyboardTimelinePlan'
import type {
  GenerationCanvasEdge,
  GenerationCanvasNode,
  GenerationNodeKind,
  GenerationNodeResult,
} from '../model/generationCanvasTypes'

function node(
  id: string,
  kind: GenerationNodeKind,
  shotIndex: number | undefined,
  result?: Partial<GenerationNodeResult>,
  y = 0,
): GenerationCanvasNode {
  return {
    id,
    kind,
    title: id,
    position: { x: 0, y },
    categoryId: 'shots',
    ...(typeof shotIndex === 'number' ? { shotIndex } : {}),
    ...(result
      ? { result: { id: `${id}-r`, type: 'video', url: `file://${id}.mp4`, ...result } as GenerationNodeResult }
      : {}),
  }
}

function edge(source: string, target: string, mode?: GenerationCanvasEdge['mode']): GenerationCanvasEdge {
  return { id: `${source}-${target}`, source, target, ...(mode ? { mode } : {}) }
}

function fromDesign(nodeValue: GenerationCanvasNode, storyboardDesignId: string): GenerationCanvasNode {
  return { ...nodeValue, meta: { ...nodeValue.meta, storyboardDesignId } }
}

describe('planStoryboardTimeline', () => {
  it('orders generated videos by shotIndex regardless of array order', () => {
    const nodes = [
      node('v3', 'video', 3, { type: 'video' }),
      node('v1', 'video', 1, { type: 'video' }),
      node('v2', 'video', 2, { type: 'video' }),
    ]
    const { units, skipped } = planStoryboardTimeline(nodes, [])
    expect(units.map((u) => u.nodeId)).toEqual(['v1', 'v2', 'v3'])
    expect(units.every((u) => u.role === 'video')).toBe(true)
    expect(skipped).toEqual([])
  })

  it('falls back to the keyframe image as a placeholder when the video is not generated', () => {
    const nodes = [
      node('kf1', 'image', 1, { type: 'image', url: 'file://kf1.png' }),
      node('v1', 'video', 2, undefined), // not generated
    ]
    const edges = [edge('kf1', 'v1', 'first_frame')]
    const { units, skipped } = planStoryboardTimeline(nodes, edges)
    // placeholder takes the video's script slot; keyframe is not double-placed as a still
    expect(units).toEqual([{ nodeId: 'kf1', shotIndex: 2, role: 'placeholder' }])
    expect(skipped).toEqual([])
  })

  it('dedups: a keyframe feeding a generated video is not placed independently', () => {
    const nodes = [
      node('kf1', 'image', 1, { type: 'image', url: 'file://kf1.png' }),
      node('v1', 'video', 2, { type: 'video' }),
    ]
    const edges = [edge('kf1', 'v1', 'first_frame')]
    const { units } = planStoryboardTimeline(nodes, edges)
    expect(units).toEqual([{ nodeId: 'v1', shotIndex: 2, role: 'video' }])
  })

  it('skips a shot whose video and keyframe are both ungenerated, reporting the video', () => {
    const nodes = [
      node('kf1', 'image', 1, undefined),
      node('v1', 'video', 2, undefined),
    ]
    const edges = [edge('kf1', 'v1', 'first_frame')]
    const { units, skipped } = planStoryboardTimeline(nodes, edges)
    expect(units).toEqual([])
    expect(skipped.map((s) => s.nodeId)).toEqual(['v1'])
  })

  it('arranges a pure-image storyboard (no video nodes) by shotIndex', () => {
    const nodes = [
      node('img2', 'image', 2, { type: 'image', url: 'file://2.png' }),
      node('img1', 'image', 1, { type: 'image', url: 'file://1.png' }),
    ]
    const { units } = planStoryboardTimeline(nodes, [])
    expect(units.map((u) => u.nodeId)).toEqual(['img1', 'img2'])
    expect(units.every((u) => u.role === 'still')).toBe(true)
  })

  it('honors a scope subset and ignores non-shot nodes', () => {
    const nodes = [
      node('v1', 'video', 1, { type: 'video' }),
      node('v2', 'video', 2, { type: 'video' }),
      { ...node('t1', 'text', undefined), categoryId: 'shots' } as GenerationCanvasNode,
    ]
    const { units } = planStoryboardTimeline(nodes, [], { nodeIds: ['v2'] })
    expect(units.map((u) => u.nodeId)).toEqual(['v2'])
  })

  it('fails closed when multiple storyboard designs exist without an exact scope', () => {
    const nodes = [
      fromDesign(node('a-1', 'video', 1, { type: 'video' }), 'design-a'),
      fromDesign(node('b-1', 'video', 1, { type: 'video' }), 'design-b'),
    ]

    expect(planStoryboardTimeline(nodes, [])).toEqual({
      units: [],
      skipped: [],
      scopeError: 'ambiguous_storyboard_scope',
    })
  })

  it('uses the active storyboard design and never mixes equal shot numbers from another design', () => {
    const nodes = [
      fromDesign(node('a-2', 'video', 2, { type: 'video' }), 'design-a'),
      fromDesign(node('b-1', 'video', 1, { type: 'video' }), 'design-b'),
      fromDesign(node('a-1', 'video', 1, { type: 'video' }), 'design-a'),
    ]

    const plan = planActiveStoryboardTimeline(nodes, [], 'design-a')
    expect(plan.scopeError).toBeUndefined()
    expect(plan.units.map((unit) => unit.nodeId)).toEqual(['a-1', 'a-2'])
  })

  it('rejects an explicit Agent node subset that crosses storyboard designs', () => {
    const nodes = [
      fromDesign(node('a-1', 'video', 1, { type: 'video' }), 'design-a'),
      fromDesign(node('b-1', 'video', 1, { type: 'video' }), 'design-b'),
    ]

    expect(planStoryboardTimeline(nodes, [], { nodeIds: ['a-1', 'b-1'] }).scopeError)
      .toBe('mixed_storyboard_scope')
  })

  it('mixes generated videos and placeholders in one ordered sequence', () => {
    const nodes = [
      node('kf1', 'image', 1, { type: 'image', url: 'file://kf1.png' }),
      node('v1', 'video', 2, { type: 'video' }),
      node('kf2', 'image', 3, { type: 'image', url: 'file://kf2.png' }),
      node('v2', 'video', 4, undefined), // not generated -> kf2 placeholder
    ]
    const edges = [edge('kf1', 'v1', 'first_frame'), edge('kf2', 'v2', 'first_frame')]
    const { units } = planStoryboardTimeline(nodes, edges)
    expect(units).toEqual([
      { nodeId: 'v1', shotIndex: 2, role: 'video' },
      { nodeId: 'kf2', shotIndex: 4, role: 'placeholder' },
    ])
  })
})
