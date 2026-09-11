import { describe, expect, it } from 'vitest'
import {
  buildImageUrlSlots, normalizeParameterEdges, parameterReferenceMetaPatch,
  projectParameterReferenceSlots, readParameterReferenceSlots, resolveParameterReferenceAssignments,
} from './parameterReferenceSlots'
import type { GenerationCanvasEdge, GenerationCanvasNode } from './generationCanvasTypes'
import { resolveGenerationReferences } from '../runner/generationReferenceResolver'
import { buildCatalogTaskRequest } from '../runner/catalogTaskActions'

function source(id: string, kind: 'image' | 'video' | 'audio' = 'image'): GenerationCanvasNode {
  return { id, kind, title: id, position: { x: 0, y: 0 }, result: { id, type: kind, url: `https://asset.test/${id}`, createdAt: 1 } }
}
const catalog = { parameters: [
  { key: 'a', label: 'A', type: 'image-url' },
  { key: 'b', label: 'B', type: 'image-url' },
  { key: 'clip', label: 'Clip', type: 'image-url', mediaKind: 'video' },
  // ComfyUI LoadAudio 声明的媒体槽（用户报的根因之一「ComfyUI 音频输入用不了」）：与 clip(video)
  // 同一条链路，只是 mediaKind 换成 audio——下面 'routes an audio declaration…' 与
  // 'does not accept an image source for an audio declaration' 两条测试对称覆盖。
  { key: 'voice', label: 'Voice', type: 'image-url', mediaKind: 'audio' },
] }
function target(): GenerationCanvasNode {
  return { id: 'target', kind: 'video', title: 'target', prompt: 'make video', position: { x: 0, y: 0 },
    meta: projectParameterReferenceSlots({ modelKey: 'custom-three', modelVendor: 'custom' }, catalog) }
}
function edge(id: string, sourceId: string, key?: string, order?: number): GenerationCanvasEdge {
  return { id, source: sourceId, target: 'target', mode: 'reference', targetParamKey: key, order }
}

describe('parameter reference assignment shared contract', () => {
  it('keeps legacy key heuristics for non-Comfy text controls', () => {
    const meta = projectParameterReferenceSlots(
      { modelKey: 'legacy-custom', modelVendor: 'custom' },
      { parameters: [{ key: 'input_image', label: 'Input image', type: 'text' }] },
    )
    expect(readParameterReferenceSlots(meta)).toEqual([
      { key: 'input_image', label: 'Input image', group: 'reference' },
    ])
  })

  it('uses only explicit media declarations for Comfy and keeps binding-derived image controls', () => {
    const meta = { modelKey: 'workflow', modelVendor: 'comfyui-local' }
    expect(readParameterReferenceSlots(projectParameterReferenceSlots(meta, {
      parameters: [{ key: 'input_image', label: 'Caption', type: 'text' }],
    }))).toEqual([])
    expect(readParameterReferenceSlots(projectParameterReferenceSlots(meta, {
      parameters: [{ key: 'opaque', label: 'Reference', type: 'text', mediaKind: 'image' }],
    }))).toEqual([{ key: 'opaque', label: 'Reference', group: 'reference', mediaKind: 'image' }])
    expect(readParameterReferenceSlots(projectParameterReferenceSlots(meta, {
      parameters: [{ key: 'bound_media', label: 'Bound media', type: 'image-url' }],
    }))).toEqual([{ key: 'bound_media', label: 'Bound media', group: 'reference' }])
  })

  it('persists an explicit empty Comfy media contract but not missing catalog metadata or non-Comfy emptiness', () => {
    const comfy = { modelKey: 'text-only', modelVendor: 'comfyui-local' }
    expect(projectParameterReferenceSlots(comfy, { parameters: [] }).parameterReferenceSlots).toEqual({
      modelKey: 'text-only', vendorKey: 'comfyui-local', slots: [],
    })
    expect(projectParameterReferenceSlots(comfy, {}).parameterReferenceSlots).toBeUndefined()
    expect(projectParameterReferenceSlots(comfy, undefined).parameterReferenceSlots).toBeUndefined()
    expect(projectParameterReferenceSlots(
      { modelKey: 'legacy', modelVendor: 'custom' },
      { parameters: [] },
    ).parameterReferenceSlots).toBeUndefined()
  })

  it.each([
    ['mixed malformed parameters', { parameters: [null, { label: 'missing key' }] }],
    ['duplicate parameters', { parameters: [
      { key: 'same', label: 'First', type: 'text' },
      { key: 'same', label: 'Second', type: 'text' },
    ] }],
    ['malformed parameterControls', { parameterControls: [null] }],
    ['unknown explicit control type', { parameters: [{ key: 'image', type: 'bogus' }] }],
    // 'audio' 曾在这里被当"unsupported explicit media kind"(用户报的根因之一「ComfyUI 音频输入
    // 用不了」)——LoadAudio 扫描器产出的 mediaKind:'audio' 一路传到这个 ComfyUI 专用的严格解析器，
    // 被判整份契约作废、退化回 legacy 启发式。'model3d' 才是真正超出 mediaKind 定义域
    // (image/video/audio)的值，顶替占住这条"未知 mediaKind 必须整份拒绝"的覆盖；
    // audio 的正面用例见下面 'accepts an explicit audio media control...'。
    ['unsupported explicit media kind', { parameters: [{ key: 'asset', type: 'text', mediaKind: 'model3d' }] }],
    ['non-string parameter key alias', { parameters: [{ name: ['image'], type: 'image-url' }] }],
    ['ambiguous dual arrays', { parameters: [], parameterControls: [] }],
    ['valid parameters with malformed spare controls', {
      parameters: [], parameterControls: 'not-an-array',
    }],
    ['malformed imported workflow marker without parameters', {
      comfyWorkflowImport: { binding: { images: [] } },
    }],
  ])('does not project an empty Comfy contract from %s', (_label, catalogMeta) => {
    const stale = 'https://legacy.test/stale.png'
    const meta = projectParameterReferenceSlots({
      modelKey: 'text-only', modelVendor: 'comfyui-local', referenceImages: [stale], firstFrameUrl: stale,
    }, catalogMeta)
    expect(meta.parameterReferenceSlots).toBeUndefined()
    const node: GenerationCanvasNode = {
      id: 'malformed', kind: 'image', title: 'malformed', prompt: 'draw', position: { x: 0, y: 0 }, meta,
    }
    const references = resolveGenerationReferences(node)
    const request = buildCatalogTaskRequest(node, { references }).request
    expect(references.referenceImages).toContain(stale)
    expect(request.kind).toBe('image_edit')
    expect(request.extras?.referenceImages).toContain(stale)
  })

  it('accepts one fully valid parameterControls array as the empty Comfy declaration source', () => {
    const meta = projectParameterReferenceSlots(
      { modelKey: 'text-only-controls', modelVendor: 'comfyui-local' },
      { parameterControls: [] },
    )
    expect(meta.parameterReferenceSlots).toEqual({
      modelKey: 'text-only-controls', vendorKey: 'comfyui-local', slots: [],
    })
  })

  it('reserves explicit keys before ordered legacy edges, including pending sources', () => {
    const node = target()
    const pending = { ...source('pending'), result: undefined }
    const assignments = resolveParameterReferenceAssignments(node, [node, pending, source('one')], [
      edge('legacy', 'one', undefined, 0), edge('explicit', 'pending', 'a', 9),
    ])
    expect(assignments.map(({ slot, edge: input }) => [slot.key, input?.source])).toEqual([
      ['a', 'pending'], ['b', 'one'], ['clip', undefined], ['voice', undefined],
    ])
  })

  it('keeps uploaded slots occupied when bare edges arrive and normalizes without later drift', () => {
    const node = target()
    node.meta!.a = 'https://upload.test/a'
    const nodes = [node, source('one')]
    const normalized = normalizeParameterEdges(nodes, [edge('legacy', 'one')])
    expect(normalized[0].targetParamKey).toBe('b')
    delete node.meta!.a
    expect(normalizeParameterEdges(nodes, normalized)).toBe(normalized)
  })

  it('routes a video declaration only to video and never treats it as a first frame', () => {
    const node = target()
    const nodes = [node, source('one'), source('movie', 'video')]
    const edges = normalizeParameterEdges(nodes, [edge('video', 'movie'), edge('image', 'one')])
    expect(edges.map((input) => input.targetParamKey)).toEqual(['clip', 'a'])
    const references = resolveGenerationReferences(node, { nodes, edges })
    expect(references.parameterReferenceUrls).toMatchObject({ clip: 'https://asset.test/movie', a: 'https://asset.test/one' })
    expect(references.firstFrameUrl).not.toBe('https://asset.test/movie')
    expect(references.relayFromVideoUrl).toBeUndefined()
    expect(buildImageUrlSlots(catalog)[2].mediaKind).toBe('video')
  })

  it('does not accept a video source for an image declaration', () => {
    const node = target()
    const assignments = resolveParameterReferenceAssignments(node, [node, source('movie', 'video')], [edge('wrong', 'movie', 'a')])
    expect(assignments.every((assignment) => !assignment.edge)).toBe(true)
  })

  // 用户报的根因之一「ComfyUI 音频输入用不了」：LoadAudio 扫描出的媒体槽最终落到这条与 video 完全
  // 对称的通路(acceptsParameterReferenceSource 按 mediaKind 精确匹配源资产类型)。video 声明已经
  // 有上面两条对称测试(只收 video、不收 image)，audio 必须补齐同一对，否则回归只覆盖了一半。
  it('routes an audio declaration only to audio and never treats it as an image/video reference', () => {
    const node = target()
    const nodes = [node, source('one'), source('narration', 'audio')]
    const edges = normalizeParameterEdges(nodes, [edge('audio', 'narration'), edge('image', 'one')])
    expect(edges.map((input) => input.targetParamKey)).toEqual(['voice', 'a'])
    const references = resolveGenerationReferences(node, { nodes, edges })
    expect(references.parameterReferenceUrls).toMatchObject({ voice: 'https://asset.test/narration', a: 'https://asset.test/one' })
    expect(buildImageUrlSlots(catalog)[3].mediaKind).toBe('audio')
  })

  it('does not accept an image source for an audio declaration', () => {
    const node = target()
    const assignments = resolveParameterReferenceAssignments(node, [node, source('one')], [edge('wrong', 'one', 'voice')])
    expect(assignments.every((assignment) => !assignment.edge)).toBe(true)
  })

  it('uses video declaration semantics even if a saved edge mode says first_frame', () => {
    const node = target()
    const references = resolveGenerationReferences(node, { nodes: [node, source('movie', 'video')], edges: [
      { ...edge('video', 'movie', 'clip'), mode: 'first_frame' },
    ] })
    expect(references.parameterReferenceUrls?.clip).toBe('https://asset.test/movie')
    expect(references.referenceVideos).toEqual(['https://asset.test/movie'])
    expect(references.firstFrameUrl).toBeUndefined()
    expect(references.relayFromVideoUrl).toBeUndefined()
  })

  it('uses first-frame declaration semantics for a legacy reference-mode video edge', () => {
    const node = target()
    node.meta = projectParameterReferenceSlots(node.meta!, {
      parameters: [{ key: 'first_frame_url', label: 'First', type: 'image-url', mediaKind: 'image' }],
    })
    const references = resolveGenerationReferences(node, { nodes: [node, source('movie', 'video')], edges: [edge('video', 'movie')] })
    expect(references.relayFromVideoUrl).toBe('https://asset.test/movie')
    expect(references.firstFrameUrl).toBeUndefined()
    expect(references.referenceVideos).toEqual([])
  })

  it('reads current source results and a pending edge masks a stale local value', () => {
    const node = target()
    node.meta!.a = 'https://stale.test/a'
    node.meta!.b = 'https://upload.test/b'
    const reference = source('one')
    const edges = [edge('input', 'one', 'a')]
    reference.result!.url = 'https://fresh.test/a'
    expect(resolveGenerationReferences(node, { nodes: [node, reference], edges }).parameterReferenceUrls?.a).toBe('https://fresh.test/a')
    const pending = { ...reference, result: undefined }
    const references = resolveGenerationReferences(node, { nodes: [node, pending], edges })
    expect(buildCatalogTaskRequest(node, { references }).request.extras?.a).toBeNull()
    expect(references.parameterReferenceUrls).toEqual({ a: null, b: 'https://upload.test/b' })
    expect(node.meta!.a).toBe('https://stale.test/a')
  })

  it('ignores a stale model identity and never leaks its keyed edge into generic references', () => {
    const node = target()
    node.meta!.modelKey = 'new-empty-model'
    expect(readParameterReferenceSlots(node.meta)).toEqual([])
    const references = resolveGenerationReferences(node, { nodes: [node, source('one')], edges: [edge('stale', 'one', 'a')] })
    expect(references.referenceImages).toEqual([])
    expect(references.firstFrameUrl).toBeUndefined()
    expect(buildCatalogTaskRequest(node, { references }).request.kind).toBe('text_to_video')
  })

  it('updates declaration keys and media kinds without persisting catalog URL defaults', () => {
    const initial = target().meta!
    const updated = projectParameterReferenceSlots({ ...initial, a: 'https://old.test/a', keep: 1 }, {
      parameters: [{ key: 'replacement', label: 'New', type: 'image-url', mediaKind: 'video', defaultValue: 'https://catalog.test/not-a-reference' }],
    })
    expect(updated.a).toBeUndefined()
    expect(updated.keep).toBe(1)
    expect(updated.replacement).toBeUndefined()
    expect(readParameterReferenceSlots(updated)).toEqual([{ key: 'replacement', label: 'New', group: 'reference', mediaKind: 'video' }])
  })

  it('clears a same-key local image when the catalog changes it to video, but treats omitted mediaKind as image', () => {
    const meta = { ...target().meta!, a: 'https://old.test/image.png', a_nodeRef: 'one' }
    const imageDeclaration = { parameters: [{ key: 'a', label: 'A', type: 'image-url', mediaKind: 'image' }] }
    expect(projectParameterReferenceSlots(meta, imageDeclaration).a).toBe(meta.a)
    const updated = projectParameterReferenceSlots(meta, { parameters: [{ ...imageDeclaration.parameters[0], mediaKind: 'video' }] })
    expect(updated.a).toBeUndefined()
    expect(updated.a_nodeRef).toBeUndefined()
    expect(readParameterReferenceSlots(updated)[0].mediaKind).toBe('video')
  })

  it('removes only the stale upload aliases owned by an invalidated unique slot', () => {
    const imageCatalog = { parameters: [{ key: 'clip', label: 'Clip', type: 'image-url', mediaKind: 'image' }] }
    const initial = projectParameterReferenceSlots({ modelKey: 'workflow', modelVendor: 'custom' }, imageCatalog)
    const slots = readParameterReferenceSlots(initial)
    const uploaded = { ...initial, ...parameterReferenceMetaPatch(slots[0], slots, 'https://old.test/image.png') }
    const videoCatalog = { parameters: [{ ...imageCatalog.parameters[0], mediaKind: 'video' }] }
    const updated = projectParameterReferenceSlots(uploaded, videoCatalog)
    const node = { ...target(), meta: updated }
    const references = resolveGenerationReferences(node)
    expect(references.referenceImages).toEqual([])
    expect(references.firstFrameUrl).toBeUndefined()
    expect(buildCatalogTaskRequest(node, { references }).request.kind).toBe('text_to_video')
    expect(updated.referenceImageUrl).toBeUndefined()
    const independent = projectParameterReferenceSlots({ ...uploaded, referenceImages: ['https://other.test/user.png'], referenceImageUrl: 'https://other.test/user.png' }, videoCatalog)
    expect(independent.referenceImages).toEqual(['https://other.test/user.png'])
    expect(independent.referenceImageUrl).toBe('https://other.test/user.png')
    const shared = projectParameterReferenceSlots({ ...uploaded, referenceImages: ['https://old.test/image.png', 'https://other.test/user.png'] }, {
      parameters: [...videoCatalog.parameters, { key: 'referenceImageUrl', label: 'Other input', type: 'image-url' }],
    })
    expect(shared.referenceImages).toEqual(['https://old.test/image.png', 'https://other.test/user.png'])
    expect(shared.referenceImageUrl).toBe('https://old.test/image.png')
  })

  it('isolates upload/removal patches for same-group parameters and keeps legacy frame aliases', () => {
    const slots = buildImageUrlSlots(catalog)
    expect(parameterReferenceMetaPatch(slots[0], slots, null)).toEqual({ a: null, a_nodeRef: null })
    expect(parameterReferenceMetaPatch(slots[2], slots, 'https://clip.test')).toEqual({ clip: 'https://clip.test', clip_nodeRef: null })
    const frame = { key: 'first_frame_url', label: 'First', group: 'first_frame' as const }
    expect(parameterReferenceMetaPatch(frame, [frame], 'https://first.test')).toMatchObject({ firstFrameUrl: 'https://first.test', firstFrameRef: null })
  })

  it('indexes incoming edges once when normalizing many declared targets', () => {
    let targetReads = 0
    const nodes = [source('one'), ...Array.from({ length: 100 }, (_, index) => ({ ...target(), id: `target-${index}` }))]
    const edges = nodes.slice(1).map((node, index): GenerationCanvasEdge => ({
      id: `edge-${index}`, source: 'one', mode: 'reference',
      get target() { targetReads += 1; return node.id },
    }))
    expect(normalizeParameterEdges(nodes, edges).every((input) => input.targetParamKey === 'a')).toBe(true)
    expect(targetReads).toBeLessThan(500)
  })
})
