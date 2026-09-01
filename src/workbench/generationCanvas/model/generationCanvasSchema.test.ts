import { describe, expect, expectTypeOf, it } from 'vitest'
import {
  GENERATION_NODE_STATUSES,
  generationNodeStatusSchema as sharedGenerationNodeStatusSchema,
  type GenerationNodeStatus as SharedGenerationNodeStatus,
} from '../../../../electron/shared/canvas/generationNodeStatus'
import {
  generationCanvasNodeSchema,
  generationCanvasSnapshotSchema,
  generationNodeRunStatusSchema,
  generationNodeStatusSchema,
  nodeGroupSchema,
} from './generationCanvasSchema'
import type { GenerationNodeStatus } from './generationCanvasTypes'
import { normalizeGenerationCanvasSnapshot } from '../../workbenchPersistence'

const legacySnapshot = {
  nodes: [
    {
      id: 'node-1',
      kind: 'shot',
      title: '分镜 1',
      position: { x: 10, y: 20 },
      categoryId: 'shots',
    },
  ],
  edges: [],
  selectedNodeIds: ['node-1'],
}

describe('generationCanvasSchema Phase E.2 groups', () => {
  it('projects the neutral shared generation status contract without copying its members', () => {
    expect(generationNodeStatusSchema).toBe(sharedGenerationNodeStatusSchema)
    expectTypeOf<GenerationNodeStatus>().toEqualTypeOf<SharedGenerationNodeStatus>()

    for (const status of GENERATION_NODE_STATUSES) {
      expect(generationCanvasNodeSchema.parse({ ...legacySnapshot.nodes[0], status }).status).toBe(status)
    }

    const runStatuses = GENERATION_NODE_STATUSES.filter((status) => status !== 'idle')
    for (const status of [...runStatuses, 'cancelled'] as const) {
      expect(generationNodeRunStatusSchema.parse(status)).toBe(status)
    }
    expect(generationNodeRunStatusSchema.safeParse('idle').success).toBe(false)
  })

  it('defaults missing groups to an empty array for legacy snapshots', () => {
    expect(generationCanvasSnapshotSchema.parse(legacySnapshot).groups).toEqual([])
    expect(normalizeGenerationCanvasSnapshot(legacySnapshot).groups).toEqual([])
  })

  it('validates node groups with category ids and optional frame metadata', () => {
    const parsed = nodeGroupSchema.parse({
      id: 'group-1',
      name: '角色组',
      categoryId: 'cast',
      nodeIds: ['node-1', 'node-2'],
      color: '#7C3AED',
      frameBounds: { x: 0, y: 0, w: 640, h: 360 },
      collapsed: false,
      createdAt: 100,
      updatedAt: 200,
    })

    expect(parsed).toMatchObject({
      id: 'group-1',
      name: '角色组',
      categoryId: 'cast',
      nodeIds: ['node-1', 'node-2'],
    })
    expect(() => nodeGroupSchema.parse({ ...parsed, categoryId: 'legacy' })).toThrow()
  })

  it('preserves optional group input/output declarations while old groups remain valid', () => {
    const base = {
      id: 'group-links',
      name: '参考组',
      categoryId: 'shots',
      nodeIds: ['image-a', 'image-b'],
      createdAt: 100,
      updatedAt: 200,
    }
    expect(nodeGroupSchema.parse(base).outputLinks).toBeUndefined()
    expect(nodeGroupSchema.parse({
      ...base,
      inputLinks: [{ sourceNodeId: 'style-source' }],
      outputLinks: [{ targetNodeId: 'generation-target' }],
    })).toMatchObject({
      inputLinks: [{ sourceNodeId: 'style-source' }],
      outputLinks: [{ targetNodeId: 'generation-target' }],
    })
  })

  it('preserves node groupId and derivedFrom while validating category ids', () => {
    const parsed = generationCanvasNodeSchema.parse({
      id: 'node-2',
      kind: 'image',
      title: '画面',
      position: { x: 0, y: 0 },
      categoryId: 'shots',
      groupId: 'group-1',
      derivedFrom: 'node-1',
    })

    expect(parsed.groupId).toBe('group-1')
    expect(parsed.derivedFrom).toBe('node-1')
    expect(() => generationCanvasNodeSchema.parse({ ...parsed, categoryId: 'legacy' })).toThrow()
  })

  it('preserves Tiptap contentJson and accepts legacy nodes without it (C5)', () => {
    const withDoc = generationCanvasNodeSchema.parse({
      id: 'text-1',
      kind: 'text',
      title: '文本',
      position: { x: 0, y: 0 },
      categoryId: 'shots',
      contentJson: { type: 'doc', content: [{ type: 'paragraph' }] },
    })
    expect(withDoc.contentJson).toEqual({ type: 'doc', content: [{ type: 'paragraph' }] })

    // Legacy node without contentJson still parses; field stays undefined.
    const legacy = generationCanvasNodeSchema.parse({
      id: 'text-2',
      kind: 'text',
      title: '文本',
      position: { x: 0, y: 0 },
      categoryId: 'shots',
    })
    expect(legacy.contentJson).toBeUndefined()
  })

  it('preserves scene3d trajectory data in node meta', () => {
    const parsed = generationCanvasNodeSchema.parse({
      id: 'scene3d-1',
      kind: 'scene3d',
      title: '3D 场景',
      position: { x: 0, y: 0 },
      categoryId: 'shots',
      meta: {
        scene3dState: {
          trajectories: [
            {
              id: 'trajectory-1',
              name: '轨迹1',
              points: [
                { id: 'point-1', position: [0, 0, 0] },
                { id: 'point-2', position: [2, 0, 1] },
              ],
              curveControls: [{ segmentStartPointId: 'point-1', position: [1, 0, 1] }],
              tension: 0.5,
              closed: false,
              color: '#ef4444',
            },
          ],
          trajectoryBindings: [],
          trajectoryGroups: [{ id: 'group-1', name: '组1', trajectoryIds: ['trajectory-1'] }],
          sceneTimeline: { totalDuration: 3 },
        },
      },
    })

    expect(parsed.meta?.scene3dState).toMatchObject({
      trajectories: [expect.objectContaining({ id: 'trajectory-1' })],
      trajectoryGroups: [expect.objectContaining({ id: 'group-1' })],
      sceneTimeline: { totalDuration: 3 },
    })
  })
})
