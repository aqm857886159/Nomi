import { describe, expect, it } from 'vitest'
import { canvasReadResultSchema, projectCanvasRead } from './canvasRead'
import { formatCanvasForAgent } from './canvasReadCompact'

const frame = { id: 'frame', kind: 'image', categoryId: 'shots', shotIndex: 99, meta: { storyboardKeyframe: true, secret: 'never expose' } }
const video = { id: 'video', kind: 'video', categoryId: 'shots', shotIndex: 4 }
const edge = { id: 'pair', source: 'frame', target: 'video', mode: 'first_frame' }

describe('Agent shot references match the paired canvas labels', () => {
  it('reports distinct frame/video roles and executable node IDs, and never the global number', () => {
    const result = projectCanvasRead({ nodes: [frame, video], edges: [edge] })
    expect(result.nodes[0]).toMatchObject({ id: 'frame', shotRole: 'first_frame', shotOwnerNodeIds: ['video'] })
    expect(result.nodes[1]).toMatchObject({ id: 'video', shotRole: 'video' })
    for (const node of result.nodes) expect(node).not.toHaveProperty('shotIndex')
    const compact = formatCanvasForAgent(result)
    expect(compact).toContain('首帧图')
    expect(compact).toContain('视频')
    expect(compact).not.toMatch(/镜s?d/)
    expect(compact).toContain('shotOwnerNodeIds: video')
    expect(compact).not.toContain('never expose')
  })
  it('does not invent a unique shot for orphan or shared frames', () => {
    const orphan = projectCanvasRead({ nodes: [frame], edges: [] }).nodes[0]
    expect(orphan).toMatchObject({ shotRole: 'first_frame' })
    expect(orphan).not.toHaveProperty('shotIndex')
    const shared = projectCanvasRead({ nodes: [frame, video, { ...video, id: 'video-b', shotIndex: 5 }], edges: [edge, { ...edge, id: 'pair-b', target: 'video-b' }] })
    expect(shared.nodes[0]).toMatchObject({ shotRole: 'first_frame', shotOwnerNodeIds: ['video', 'video-b'] })
    expect(shared.nodes[0]).not.toHaveProperty('shotIndex')
    expect(formatCanvasForAgent(shared)).toContain('shotOwnerNodeIds: video, video-b')
  })
  it('rejects invalid roles and dangling or repeated owners in external read results', () => {
    const result = projectCanvasRead({ nodes: [frame, video], edges: [edge] })
    for (const patch of [{ shotRole: 'unknown' }, { shotOwnerNodeIds: ['missing'] }, { shotOwnerNodeIds: ['video', 'video'] }, { shotIndex: 0 }]) {
      expect(canvasReadResultSchema.safeParse({ ...result, nodes: [{ ...result.nodes[0], ...patch }, result.nodes[1]] }).success).toBe(false)
    }
  })
  it('never publishes stale reference/non-shot labels', () => {
    const result = projectCanvasRead({ nodes: [{ ...video, categoryId: 'scene' }, { ...frame, id: 'reference', meta: { referenceSheet: true } }] })
    for (const node of result.nodes) expect(node).not.toHaveProperty('shotIndex')
  })
})


it('preserves exact category identity instead of trimming an unrelated category into shots', () => {
  const result = projectCanvasRead({ nodes: [{ ...video, categoryId: ' shots ' }], edges: [] })
  expect(result.nodes[0]).not.toHaveProperty('shotIndex')
  expect(result.nodes[0]).not.toHaveProperty('shotRole')
})
