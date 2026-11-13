import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useGenerationCanvasStore } from '../../store/generationCanvasStore'
import type { GenerationCanvasNode } from '../../model/generationCanvasTypes'
import { archetypeForNode } from '../../agent/referenceEdgeCapability'
import { applyHumanModeChoice, effectiveArchetypeMode } from './archetypeMeta'
import { removeFromArray, removeUnusedReference, type ReferenceWriteContext } from './referenceWrites'
import { attachCameraMoveForNode } from '../director/agent/attachCameraMoveForNode'
import { CAMERA_MOVE_ATTACHED_URL_KEY, DIRECTOR_PREVIEW_DISMISSED_URL_KEY } from '../director/agent/attachCameraMoveToTarget'

const PREVIEW = 'nomi-local://asset/p/preview.mp4'
const PREVIEW_DIRECTIVE = { kind: 'preview' as const, cuts: [{ start: 0, end: 3, shotSize: '全景', move: 'static' }], notes: [] as string[] }
const MEDIA = {
  image: { metaKey: 'referenceImageUrls', url: 'nomi-local://asset/p/reference.png', resultType: 'image', nodeKind: 'image' },
  video: { metaKey: 'referenceVideoUrls', url: 'nomi-local://asset/p/reference.mp4', resultType: 'video', nodeKind: 'video' },
  audio: { metaKey: 'referenceAudioUrls', url: 'nomi-local://asset/p/reference.mp3', resultType: 'audio', nodeKind: 'audio' },
} as const

function shot(modeId = 't2v'): GenerationCanvasNode {
  return {
    id: 'shot', kind: 'video', title: 'shot', position: { x: 0, y: 0 }, prompt: '两人对话',
    meta: { archetype: { id: 'seedance-2-apimart', modeId } },
  } as GenerationCanvasNode
}

function source(kind: keyof typeof MEDIA): GenerationCanvasNode {
  const media = MEDIA[kind]
  return {
    id: `source-${kind}`, kind: media.nodeKind, title: `source-${kind}`, position: { x: 0, y: 0 }, prompt: '',
    result: { id: `result-${kind}`, type: media.resultType, url: media.url, createdAt: 1 },
  } as GenerationCanvasNode
}

function context(node: GenerationCanvasNode): ReferenceWriteContext {
  const archetype = archetypeForNode(node)!
  const store = useGenerationCanvasStore.getState()
  const archMode = effectiveArchetypeMode(archetype, node, { nodes: store.nodes, edges: store.edges }).mode
  return {
    node, archMode, getImageUrlSlots: () => [],
    latestNode: (id) => useGenerationCanvasStore.getState().nodes.find((candidate) => candidate.id === id),
    updateNode: store.updateNode, getLatestMeta: () => useGenerationCanvasStore.getState().nodes.find((candidate) => candidate.id === node.id)?.meta ?? {},
    updateMeta: () => {}, storeConnectNodes: store.connectNodes, storeDisconnectEdge: store.disconnectEdge,
    closeSlot: () => {}, feedback: () => {},
  }
}

function directorPreview(): GenerationCanvasNode {
  return {
    id: 'director', kind: 'director', title: 'director', position: { x: 0, y: 0 },
    meta: { directorPreview: { status: 'ready', revision: 'r1', targetNodeId: 'shot', videoUrl: PREVIEW, updatedAt: 1 } },
  } as GenerationCanvasNode
}

describe('director preview reference deletion through the production owner', () => {
  beforeEach(() => {
    useGenerationCanvasStore.setState({ nodes: [shot()], edges: [] })
  })

  it('attachCameraMoveForNode then removeFromArray clears the video reference, edge, and @ mention while retaining the marker', () => {
    const attached = attachCameraMoveForNode('shot', PREVIEW, PREVIEW_DIRECTIVE)
    expect(attached.kind).toBe('patch')
    if (attached.kind !== 'patch') return
    useGenerationCanvasStore.getState().updateNode('shot', attached.patch)
    useGenerationCanvasStore.setState({ nodes: [...useGenerationCanvasStore.getState().nodes, directorPreview()] })
    const afterAttach = useGenerationCanvasStore.getState().nodes.find((item) => item.id === 'shot')!
    expect(afterAttach.meta?.referenceVideoUrls).toEqual([PREVIEW])

    removeFromArray(context(afterAttach), 'referenceVideoUrls', 0)

    const afterDelete = useGenerationCanvasStore.getState().nodes[0]
    expect(afterDelete.meta?.referenceVideoUrls ?? []).toEqual([])
    expect(useGenerationCanvasStore.getState().edges).toEqual([])
    expect(afterDelete.prompt).not.toContain(`@[asset:${encodeURIComponent(PREVIEW)}]`)
    expect(afterDelete.prompt).not.toContain('跟随这段参考视频的运镜')
    expect(afterDelete.meta?.[CAMERA_MOVE_ATTACHED_URL_KEY]).toBe(PREVIEW)
    expect(afterDelete.meta?.[DIRECTOR_PREVIEW_DISMISSED_URL_KEY]).toBe(PREVIEW)
  })

  it('the faded unused-reference delete owner records the same explicit preview dismissal', () => {
    const current = { ...shot(), prompt: `描述\n 跟随这段参考视频的运镜（只参考镜头运动，画面内容由角色参考与文字决定）。`, meta: {
      ...shot().meta, referenceImageUrls: [PREVIEW], [CAMERA_MOVE_ATTACHED_URL_KEY]: PREVIEW,
    } }
    useGenerationCanvasStore.setState({ nodes: [current, directorPreview()], edges: [] })
    removeUnusedReference(context(current), PREVIEW)
    const afterDelete = useGenerationCanvasStore.getState().nodes.find((item) => item.id === 'shot')!
    expect(afterDelete.meta?.referenceImageUrls ?? []).toEqual([])
    expect(afterDelete.meta?.[DIRECTOR_PREVIEW_DISMISSED_URL_KEY]).toBe(PREVIEW)
    expect(afterDelete.prompt).not.toContain('跟随这段参考视频的运镜')
  })

  it('deleting a user clip that is not the attached preview does not record a dismissal', () => {
    const base = shot('omni')
    const userUrl = MEDIA.video.url
    const node = { ...base, meta: { ...base.meta, referenceVideoUrls: [userUrl], [CAMERA_MOVE_ATTACHED_URL_KEY]: PREVIEW } }
    useGenerationCanvasStore.setState({ nodes: [node, directorPreview()], edges: [] })
    removeFromArray(context(node), 'referenceVideoUrls', 0)
    const afterDelete = useGenerationCanvasStore.getState().nodes.find((item) => item.id === 'shot')!
    expect(afterDelete.meta?.[DIRECTOR_PREVIEW_DISMISSED_URL_KEY]).toBeUndefined()
  })

  it('the delete owner emits one atomic node patch containing the reference, directive, and dismissal changes', () => {
    const attached = attachCameraMoveForNode('shot', PREVIEW, PREVIEW_DIRECTIVE)
    expect(attached.kind).toBe('patch')
    if (attached.kind !== 'patch') return
    useGenerationCanvasStore.getState().updateNode('shot', attached.patch)
    useGenerationCanvasStore.setState({ nodes: [...useGenerationCanvasStore.getState().nodes, directorPreview()] })
    const current = useGenerationCanvasStore.getState().nodes.find((item) => item.id === 'shot')!
    const updateNode = vi.fn()
    removeFromArray({ ...context(current), updateNode } as ReferenceWriteContext, 'referenceVideoUrls', 0)
    expect(updateNode).toHaveBeenCalledTimes(1)
    const patch = updateNode.mock.calls[0]?.[1] as { meta: Record<string, unknown>; prompt: string }
    expect(patch.meta.referenceVideoUrls).toEqual([])
    expect(patch.meta[DIRECTOR_PREVIEW_DISMISSED_URL_KEY]).toBe(PREVIEW)
    expect(patch.prompt).not.toContain('跟随这段参考视频的运镜')
  })

  it.each(Object.keys(MEDIA) as Array<keyof typeof MEDIA>)('upload %s reference deletion clears its @ mention', (kind) => {
    const media = MEDIA[kind]
    const base = shot('omni')
    const node = { ...base, prompt: `描述 ${encodeURIComponent(media.url)}`, meta: { ...base.meta, [media.metaKey]: [media.url] } }
    // Use the production mention encoding in the prompt, not a test-only string shape.
    node.prompt = `描述 @[asset:${encodeURIComponent(media.url)}]`
    useGenerationCanvasStore.setState({ nodes: [node], edges: [] })
    removeFromArray(context(node), media.metaKey, 0)
    const afterDelete = useGenerationCanvasStore.getState().nodes[0]
    expect(afterDelete.meta?.[media.metaKey] ?? []).toEqual([])
    expect(afterDelete.prompt).toBe('描述')
  })

  it.each(Object.keys(MEDIA) as Array<keyof typeof MEDIA>)('edge %s reference deletion disconnects the edge and clears its @ mention', (kind) => {
    const media = MEDIA[kind]
    const base = shot('omni')
    const node = { ...base, prompt: `描述 @[asset:${encodeURIComponent(media.url)}]`, meta: { ...base.meta } }
    const edge = { id: `edge-${kind}`, source: `source-${kind}`, target: node.id, mode: 'reference' as const }
    useGenerationCanvasStore.setState({ nodes: [node, source(kind)], edges: [edge] })
    removeFromArray(context(node), media.metaKey, 0)
    const afterDelete = useGenerationCanvasStore.getState().nodes.find((candidate) => candidate.id === node.id)!
    expect(useGenerationCanvasStore.getState().edges).toEqual([])
    expect(afterDelete.prompt).toBe('描述')
  })

  it('upload references remain deletable after switching modes away and back', () => {
    const media = MEDIA.image
    const base = { ...shot(), prompt: `描述 @[asset:${encodeURIComponent(media.url)}]`, meta: { ...shot().meta, [media.metaKey]: [media.url] } }
    const archetype = archetypeForNode(base)!
    const away = { ...base, meta: applyHumanModeChoice(base.meta ?? {}, archetype, 't2v') }
    const switched = { ...away, meta: applyHumanModeChoice(away.meta ?? {}, archetype, 'omni') }
    useGenerationCanvasStore.setState({ nodes: [switched], edges: [] })
    removeFromArray(context(switched), media.metaKey, 0)
    const afterDelete = useGenerationCanvasStore.getState().nodes[0]
    expect(afterDelete.meta?.[media.metaKey] ?? []).toEqual([])
    expect(afterDelete.prompt).toBe('描述')
  })
})
