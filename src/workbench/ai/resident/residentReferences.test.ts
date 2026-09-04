import { describe, expect, it } from 'vitest'
import {
  applyStoryboardSelectionToToolArgs,
  buildResidentReference,
  buildStoryboardReference,
  contextHandleForResidentReference,
  residentReferenceFromContextHandle,
  residentReferencePromptValue,
  storyboardShotIndexesFromReferences,
} from './residentReferences'

const context = { documentId: 'doc-7', nodeIds: ['node-a', 'node-b'], clipIds: ['clip-3'] } as const

describe('resident reference capture', () => {
  it('captures document and selected canvas identities instead of labels only', () => {
    const document = buildResidentReference('document', '当前文稿', context)
    const canvas = buildResidentReference('canvas', '已选镜头', context)
    expect(document).toMatchObject({ id: 'document:doc-7', value: 'doc-7' })
    expect(canvas).toMatchObject({ id: 'canvas:nodes:node-a,node-b', value: 'nodes:node-a,node-b' })
    expect(residentReferencePromptValue(canvas)).toContain('nodes:node-a,node-b')
  })

  it('captures selected clips for preview and timeline range references', () => {
    expect(buildResidentReference('preview', '当前预览', context)).toMatchObject({ id: 'preview:clips:clip-3', value: 'clips:clip-3' })
    expect(buildResidentReference('timeline', '时间线范围', context)).toMatchObject({ id: 'timeline:range:clip-3', value: 'range:clip-3' })
  })

  it('keeps an explicit fallback when no selection exists', () => {
    const reference = buildResidentReference('canvas', '当前画布', { documentId: null, nodeIds: [], clipIds: [] })
    expect(reference).toMatchObject({ id: 'canvas:selection' })
    expect(reference.value).toBeUndefined()
    expect(residentReferencePromptValue(reference)).toBe('当前画布')
  })

  it('binds a manual reference to the immutable handle rather than its label', () => {
    const handle = Object.freeze({
      id: 'canvas-node:node-a',
      kind: 'canvasNode' as const,
      targetId: 'node-a',
      revision: 'canvas-4',
      locator: Object.freeze({ type: 'canvasSelection' as const, nodeIds: Object.freeze(['node-a']) }),
      display: Object.freeze({ title: '开场镜头' }),
      intentRole: 'subject' as const,
    })
    const reference = residentReferenceFromContextHandle(handle)
    expect(reference).toMatchObject({
      id: 'canvas:nodes:node-a',
      value: 'nodes:node-a',
      contextHandle: handle,
    })
    expect(contextHandleForResidentReference(reference!, [handle])).toBe(handle)
  })

  it('binds timeline and preview references to the same selected timeline clip', () => {
    const handle = Object.freeze({
      id: 'timeline-clip:clip-3',
      kind: 'timelineClip' as const,
      targetId: 'clip-3',
      revision: 'timeline-4',
      locator: Object.freeze({ type: 'timeRange' as const, startMs: 1000, endMs: 3000 }),
      display: Object.freeze({ title: '开场片段', subtitle: 'video' }),
      intentRole: 'target' as const,
    })
    const timeline = residentReferenceFromContextHandle(handle)
    expect(timeline).toMatchObject({ id: 'timeline:range:clip-3', value: 'range:clip-3' })
    expect(contextHandleForResidentReference(timeline!, [handle])).toBe(handle)
    const preview = buildResidentReference('preview', '当前预览', { documentId: null, nodeIds: [], clipIds: ['clip-3'] })
    expect(contextHandleForResidentReference(preview, [handle])).toBe(handle)
  })

  it('does not resolve a reference from a display label when its target is absent', () => {
    const reference = buildResidentReference('canvas', '看起来像镜头', { documentId: null, nodeIds: ['missing'], clipIds: [] })
    expect(contextHandleForResidentReference(reference, [
      {
        id: 'canvas-node:other',
        kind: 'canvasNode',
        targetId: 'other',
        revision: '1',
        display: { title: '看起来像镜头' },
        intentRole: 'subject',
      },
    ])).toBeUndefined()
  })

  it('injects the real selected storyboard rows into the canonical plan approval args', () => {
    const references = [
      buildStoryboardReference('shot', 4, '镜头 04', 'selected shot'),
      buildStoryboardReference('shot', 2, '镜头 02', 'selected shot'),
    ]
    const args = {
      operation: 'patch_shots',
      select: { kind: 'all' },
      patch: { promptAppend: '雨天' },
      untouched: 'must stay out of the selection bridge',
    }
    const effective = applyStoryboardSelectionToToolArgs('nomi_canvas_plan', args, references)
    expect(effective).toEqual({
      ...args,
      select: { kind: 'indexes', indexes: [2, 4] },
    })
    expect(args.select).toEqual({ kind: 'all' })
    expect(storyboardShotIndexesFromReferences(references)).toEqual([2, 4])
    expect(applyStoryboardSelectionToToolArgs('patch_shots', args, references)).toBe(args)
  })

  it('does not invent a target when no storyboard row is selected', () => {
    const args = { operation: 'patch_shots', select: { kind: 'all' }, patch: { promptAppend: '雨天' } }
    expect(applyStoryboardSelectionToToolArgs('nomi_canvas_plan', args, [])).toBe(args)
  })
})
