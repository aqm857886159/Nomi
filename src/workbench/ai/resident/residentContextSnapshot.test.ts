import { describe, expect, it } from 'vitest'
import type { DocumentAnchorRef } from '../../../../electron/shared/capabilityTargeting'
import {
  buildResidentContextSnapshot,
  freezeResidentContextSnapshot,
  mergeResidentContextHandles,
} from './residentContextSnapshot'
import { formatAgentContextSnapshot } from '../../../../electron/shared/agentContextSnapshot'

const documentAnchor: DocumentAnchorRef = Object.freeze({ kind: 'range', from: 4, to: 12, selectedTextHash: 'hash-doc' })

describe('resident ContextSnapshot', () => {
  it('captures an active document with an immutable revisioned locator', () => {
    const snapshot = buildResidentContextSnapshot({
      document: {
        id: 'doc-7',
        revision: 11,
        anchor: documentAnchor,
        title: '品牌脚本',
      },
    })

    expect(snapshot).toEqual({
      version: 1,
      handles: [{
        id: 'document:doc-7',
        kind: 'document',
        targetId: 'doc-7',
        revision: '11',
        locator: { type: 'documentAnchor', anchor: documentAnchor },
        display: { title: '品牌脚本' },
        intentRole: 'source',
      }],
    })
    expect(Object.isFrozen(snapshot)).toBe(true)
    expect(Object.isFrozen(snapshot.handles)).toBe(true)
    expect(Object.isFrozen(snapshot.handles[0])).toBe(true)
    expect(Object.isFrozen(snapshot.handles[0].locator)).toBe(true)
    expect(Object.isFrozen(snapshot.handles[0].display)).toBe(true)
  })

  it('captures only selected canvas nodes and timeline clips with stable revisions', () => {
    const nodes = [
      { id: 'node-a', title: '开场', kind: 'image' },
      { id: 'node-b', title: '中景', kind: 'video' },
    ] as const
    const clips = [
      { id: 'clip-1', type: 'video', label: '开场片段', startFrame: 30, endFrame: 90 },
      { id: 'clip-2', type: 'image', label: '尾帧', startFrame: 90, endFrame: 120 },
    ] as const
    const snapshot = buildResidentContextSnapshot({
      canvas: { revision: 8, nodes, selectedNodeIds: ['node-b'] },
      timeline: { revision: 'timeline-abc', fps: 30, clips, selectedClipIds: ['clip-1'] },
    })

    expect(snapshot.handles).toEqual([
      {
        id: 'canvas-node:node-b',
        kind: 'canvasNode',
        targetId: 'node-b',
        revision: '8',
        locator: { type: 'canvasSelection', nodeIds: ['node-b'] },
        display: { title: '中景', subtitle: 'video' },
        intentRole: 'subject',
      },
      {
        id: 'timeline-clip:clip-1',
        kind: 'timelineClip',
        targetId: 'clip-1',
        revision: 'timeline-abc',
        locator: { type: 'timeRange', startMs: 1000, endMs: 3000 },
        display: { title: '开场片段', subtitle: 'video' },
        intentRole: 'target',
      },
    ])
  })

  it('freezes a detached copy so later UI mutations cannot rewrite the sent context', () => {
    const selectedNodeIds = ['node-a']
    const snapshot = buildResidentContextSnapshot({
      canvas: {
        revision: 3,
        nodes: [{ id: 'node-a', title: '原始标题', kind: 'image' }],
        selectedNodeIds,
      },
    })
    selectedNodeIds[0] = 'node-other'

    expect(snapshot.handles[0]?.targetId).toBe('node-a')
    expect(() => (snapshot.handles as unknown as Array<unknown>).push({})).toThrow()
    expect(() => freezeResidentContextSnapshot(snapshot)).not.toThrow()
  })

  it('projects traceability into a bounded transient model context without posters or extensions', () => {
    const snapshot = buildResidentContextSnapshot({
      document: {
        id: 'doc-7',
        revision: 11,
        anchor: documentAnchor,
        title: 'A'.repeat(400),
        posterUrl: 'file:///private/poster.png',
      },
    })
    const context = formatAgentContextSnapshot(snapshot)
    expect(context).toContain('targetId')
    expect(context).toContain('revision')
    expect(context).toContain('intentRole')
    expect(context).toContain('documentAnchor')
    expect(context).not.toContain('poster.png')
    expect(context.length).toBeLessThan(800)
  })

  it('merges a stale manual handle once while retaining the current selection snapshot', () => {
    const current = buildResidentContextSnapshot({ canvas: {
      revision: 8,
      nodes: [{ id: 'node-current', title: '当前镜头' }],
      selectedNodeIds: ['node-current'],
    } })
    const manual = {
      id: 'canvas-node:node-old',
      kind: 'canvasNode' as const,
      targetId: 'node-old',
      revision: '7',
      locator: { type: 'canvasSelection' as const, nodeIds: ['node-old'] },
      display: { title: '手动引用' },
      intentRole: 'subject' as const,
    }
    const merged = mergeResidentContextHandles(current, [manual, manual])
    expect(merged.handles.map((handle) => handle.id)).toEqual(['canvas-node:node-current', 'canvas-node:node-old'])
    expect(Object.isFrozen(merged)).toBe(true)
    expect(Object.isFrozen(merged.handles[1])).toBe(true)
    expect(merged.handles[1]?.revision).toBe('7')
  })

  it('keeps the manual revision when the same target changed after it was referenced', () => {
    const current = buildResidentContextSnapshot({ canvas: {
      revision: 8,
      nodes: [{ id: 'node-a', title: '已更新' }],
      selectedNodeIds: ['node-a'],
    } })
    const manual = {
      id: 'canvas-node:node-a',
      kind: 'canvasNode' as const,
      targetId: 'node-a',
      revision: '7',
      locator: { type: 'canvasSelection' as const, nodeIds: ['node-a'] },
      display: { title: '引用时标题' },
      intentRole: 'subject' as const,
    }
    const merged = mergeResidentContextHandles(current, [manual])
    expect(merged.handles).toHaveLength(1)
    expect(merged.handles[0]).toMatchObject({ revision: '7', display: { title: '引用时标题' } })
  })

  it('bounds locator-heavy transient context without leaking custom payloads', () => {
    const context = formatAgentContextSnapshot({
      version: 1,
      handles: Array.from({ length: 16 }, (_, index) => ({
        id: `custom-${index}`,
        kind: 'webSelection' as const,
        targetId: `target-${index}`,
        revision: '1',
        locator: { type: 'custom' as const, key: 'opaque', value: { secret: 'x'.repeat(10000) } },
        display: { title: '标题' },
        intentRole: 'source' as const,
      })),
    })
    expect(context.length).toBeLessThan(6000 + 100)
    expect(context).not.toContain('secret')
    expect(context).toContain('target-0')
  })

  it('enforces a hard total bound and keeps the reduced projection valid JSON', () => {
    const huge = 'x'.repeat(50_000)
    const context = formatAgentContextSnapshot({
      version: 1,
      handles: Array.from({ length: 16 }, (_, index) => ({
        id: `${huge}-${index}`,
        kind: 'canvasNode' as const,
        targetId: `${huge}-target-${index}`,
        revision: huge,
        locator: {
          type: 'canvasSelection' as const,
          nodeIds: Array.from({ length: 16 }, (_, nodeIndex) => `${huge}-node-${index}-${nodeIndex}`),
        },
        display: { title: huge, subtitle: huge },
        intentRole: 'source' as const,
      })),
    })
    expect(context.length).toBeLessThanOrEqual(6000)
    const payload = context.slice(context.indexOf('\n') + 1)
    expect(() => JSON.parse(payload)).not.toThrow()
    expect(payload.length).toBeGreaterThan(2)
  })
})
