import { describe, expect, it } from 'vitest'
import {
  analyzeComfyWorkflow,
  buildComfyImportModelMapping,
  buildImportedWorkflow,
  type ComfyGraph,
} from './comfyuiWorkflowImport'
import { taskTemplateParams } from './taskParams'
import { buildTemplateContext, renderTemplateValue } from '../ai/requestPipeline'
import {
  parameterReferenceMetaPatch,
  projectParameterReferenceSlots,
  readParameterReferenceSlots,
} from '../../src/workbench/generationCanvas/model/parameterReferenceSlots'
import { resolveGenerationReferences } from '../../src/workbench/generationCanvas/runner/generationReferenceResolver'
import { buildCatalogTaskRequest } from '../../src/workbench/generationCanvas/runner/catalogTaskActions'
import type { GenerationCanvasNode } from '../../src/workbench/generationCanvas/model/generationCanvasTypes'

const graph: ComfyGraph = {
  '1': { class_type: 'LoadVideo', inputs: { file: 'first.mp4' } },
  '2': { class_type: 'LoadVideo', inputs: { file: 'second.mp4' } },
  '3': { class_type: 'GetVideoComponents', inputs: { video: ['1', 0] } },
  '4': { class_type: 'GetVideoComponents', inputs: { video: ['2', 0] } },
  '5': { class_type: 'ImageBatch', inputs: { image1: ['3', 0], image2: ['4', 0] } },
  '6': { class_type: 'CreateVideo', inputs: { images: ['5', 0], fps: 24 } },
  '7': { class_type: 'SaveVideo', inputs: { video: ['6', 0], filename_prefix: 'dual' } },
}
const built = buildImportedWorkflow(graph, analyzeComfyWorkflow(graph).suggested)
const imageGraph: ComfyGraph = {
  '1': { class_type: 'LoadImage', inputs: { image: 'first.png' } },
  '2': { class_type: 'LoadImage', inputs: { image: 'second.png' } },
  '3': { class_type: 'ImageBatch', inputs: { image1: ['1', 0], image2: ['2', 0] } },
  '4': { class_type: 'SaveImage', inputs: { images: ['3', 0], filename_prefix: 'dual' } },
}
const builtImages = buildImportedWorkflow(imageGraph, analyzeComfyWorkflow(imageGraph).suggested)
const singleImageGraph: ComfyGraph = {
  '1': { class_type: 'LoadImage', inputs: { image: 'reference.png' } },
  '2': { class_type: 'SaveImage', inputs: { images: ['1', 0], filename_prefix: 'single' } },
}
const singleImageSuggested = analyzeComfyWorkflow(singleImageGraph).suggested
const builtSingleImage = buildImportedWorkflow(singleImageGraph, {
  ...singleImageSuggested,
  images: [{
    nodeId: '1', inputKey: 'image', paramKey: 'comfy_image_1', label: 'Reference image', mediaKind: 'image',
  }],
})
function source(id: string, pending: boolean): GenerationCanvasNode {
  return { id, kind: 'video', title: id, position: { x: 0, y: 0 },
    ...(!pending ? { result: { id, type: 'video' as const, url: `https://fixture.test/${id}.mp4`, createdAt: 1 } } : {}) }
}

const genericReferenceAliases = [
  'image',
  'referenceImages', 'referenceImageUrl', 'referenceImageUrls', 'referenceImageRef',
  'referenceImageRefs',
  'firstFrameUrl', 'firstFrameRef', 'firstFrameReference',
  'lastFrameUrl', 'lastFrameRef', 'lastFrameReference',
  'image_url', 'imageUrl', 'reference_images', 'reference_image_urls',
  'first_frame_url', 'last_frame_url',
  'referenceVideoUrls', 'reference_video_urls', 'sourceVideoUrl', 'source_video_url', 'video_url',
  'referenceAudioUrls', 'reference_audio_urls',
  'styleReferenceImages', 'characterReferenceImages', 'compositionReferenceImages',
  'upstreamResultUrls', 'archetypeInput', 'activeAssetUrls',
] as const

function comfyNodeWithExactSlot(key: string, value: string): GenerationCanvasNode {
  const modelKey = `collision-${key}`
  return {
    id: `node-${key}`,
    kind: 'image',
    title: '',
    prompt: 'restyle',
    position: { x: 0, y: 0 },
    meta: {
      modelKey,
      modelVendor: 'comfyui-local',
      parameterReferenceSlots: {
        modelKey,
        vendorKey: 'comfyui-local',
        slots: [{ key, label: key, group: 'reference', mediaKind: 'image' }],
      },
      [key]: value,
    },
  }
}

function expectOnlyKeyedReference(
  extras: Record<string, unknown> | undefined,
  key: string,
  value: string | null,
): void {
  expect(extras).toMatchObject({ [key]: value })
  for (const alias of genericReferenceAliases) expect(extras).not.toHaveProperty(alias)
}

describe('multiple declared media inputs retain identity through the final wire template', () => {
  it.each([
    ['non-object slot', [
      { key: 'comfy_image_1', label: 'Reference', group: 'reference', mediaKind: 'image' },
      null,
    ]],
    ['invalid group', [
      { key: 'comfy_image_1', label: 'Reference', group: 'reference', mediaKind: 'image' },
      { key: 'bad-group', label: 'Bad', group: 'other', mediaKind: 'image' },
    ]],
    ['array group', [
      { key: 'comfy_image_1', label: 'Reference', group: 'reference', mediaKind: 'image' },
      { key: 'bad-group', label: 'Bad', group: ['reference'], mediaKind: 'image' },
    ]],
    ['numeric label', [
      { key: 'comfy_image_1', label: 'Reference', group: 'reference', mediaKind: 'image' },
      { key: 'bad-label', label: 1, group: 'reference', mediaKind: 'image' },
    ]],
    ['empty key', [
      { key: 'comfy_image_1', label: 'Reference', group: 'reference', mediaKind: 'image' },
      { key: '   ', label: 'Bad', group: 'reference', mediaKind: 'image' },
    ]],
    ['duplicate key', [
      { key: 'comfy_image_1', label: 'Reference', group: 'reference', mediaKind: 'image' },
      { key: 'comfy_image_1', label: 'Duplicate', group: 'reference', mediaKind: 'image' },
    ]],
    // 'audio' 曾在这条黑名单里 —— 用户报的根因之一(「ComfyUI 音频输入用不了」)：LoadAudio 扫描器
    // 产出的 mediaKind:'audio' 被这道校验当非法值,整份契约判 null。'model3d' 才是真正超出
    // mediaKind 定义域(image/video/audio)的值,顶替占住这条"未知 mediaKind 必须整份拒绝"的覆盖；
    // 正面用例见下面 describe('ComfyUI LoadAudio 媒体输入…')。
    ['model3d mediaKind (真正超出 image/video/audio 定义域)', [
      { key: 'comfy_image_1', label: 'Reference', group: 'reference', mediaKind: 'image' },
      { key: 'bad-media', label: 'Bad', group: 'reference', mediaKind: 'model3d' },
    ]],
    ['null mediaKind', [
      { key: 'comfy_image_1', label: 'Reference', group: 'reference', mediaKind: 'image' },
      { key: 'bad-media', label: 'Bad', group: 'reference', mediaKind: null },
    ]],
    ['numeric mediaKind', [
      { key: 'comfy_image_1', label: 'Reference', group: 'reference', mediaKind: 'image' },
      { key: 'bad-media', label: 'Bad', group: 'reference', mediaKind: 1 },
    ]],
  ])('keeps the legacy resolver and request path when the contract contains %s', (_name, slots) => {
    const legacyUrl = 'https://legacy.test/reference.png'
    const node: GenerationCanvasNode = {
      id: 'invalid-contract', kind: 'image', title: '', prompt: 'restyle', position: { x: 0, y: 0 },
      meta: {
        modelKey: 'workflow',
        modelVendor: 'comfyui-local',
        parameterReferenceSlots: {
          modelKey: 'workflow',
          vendorKey: 'comfyui-local',
          slots,
        },
        comfy_image_1: 'https://exact.test/should-not-activate.png',
        referenceImages: [legacyUrl],
      },
    }

    const references = resolveGenerationReferences(node)
    expect(references.parameterReferenceUrls).toBeUndefined()
    expect(references.referenceImages).toEqual([legacyUrl])
    const { request } = buildCatalogTaskRequest(node, { references })
    expect(request.kind).toBe('image_edit')
    expect(request.extras?.referenceImages).toEqual([legacyUrl])
  })

  it('does not promote an imported Comfy text parameter whose key merely looks like an image input', () => {
    const textParameterGraph: ComfyGraph = {
      '1': { class_type: 'AuthorMetadata', inputs: { input_image: 'caption only' } },
      '2': { class_type: 'EmptyImage', inputs: { width: 64, height: 64, batch_size: 1 } },
      '3': { class_type: 'SaveImage', inputs: { images: ['2', 0], filename_prefix: 'text-only' } },
    }
    const textOnly = buildImportedWorkflow(textParameterGraph, {
      images: [],
      params: [{
        nodeId: '1', inputKey: 'input_image', paramKey: 'input_image', label: 'Input image caption',
        type: 'text', default: 'caption only',
      }],
      outputNodeId: '3', outputKind: 'image',
    })
    const imported = buildComfyImportModelMapping(textOnly, { modelKey: 'text-key-workflow', labelZh: 'Text key workflow' })
    expect(imported.mapping.taskKind).toBe('text_to_image')
    expect(textOnly.parameters).toEqual([
      { key: 'comfy_input_image', label: 'Input image caption', type: 'text', default: 'caption only' },
    ])

    const meta = projectParameterReferenceSlots(
      {
        modelKey: 'text-key-workflow', modelVendor: 'comfyui-local',
        referenceImages: ['https://stale.test/reference.png'],
        firstFrameUrl: 'https://stale.test/first.png',
      },
      imported.model.meta,
    )
    expect(meta.parameterReferenceSlots).toEqual({
      modelKey: 'text-key-workflow', vendorKey: 'comfyui-local', slots: [],
    })
    expect(readParameterReferenceSlots(meta)).toEqual([])
    const reloadedMeta = JSON.parse(JSON.stringify(meta)) as Record<string, unknown>
    const node: GenerationCanvasNode = {
      id: 'text-key-workflow', kind: 'image', title: '', prompt: 'draw', position: { x: 0, y: 0 }, meta: reloadedMeta,
    }
    const references = resolveGenerationReferences(node)
    expect(references).toMatchObject({
      parameterReferenceUrls: {}, referenceImages: [], referenceVideos: [], referenceAudios: [],
    })
    const request = buildCatalogTaskRequest(node, { references }).request
    expect(request.kind).toBe('text_to_image')
    for (const alias of genericReferenceAliases) expect(request.extras).not.toHaveProperty(alias)
  })

  it.each([false, true])('keeps reverse-selected video slots independent, including pending=%s', (pending) => {
    const node: GenerationCanvasNode = { id: 'target', kind: 'video', title: '', prompt: '', position: { x: 0, y: 0 },
      meta: projectParameterReferenceSlots({ modelKey: 'dual', modelVendor: 'comfyui-local' }, { parameters: built.parameters }) }
    const references = resolveGenerationReferences(node, {
      nodes: [node, source('first', pending), source('second', false)],
      edges: [
        { id: 'second', source: 'second', target: node.id, mode: 'reference', targetParamKey: 'comfy_video_2', order: 0 },
        { id: 'first', source: 'first', target: node.id, mode: 'reference', targetParamKey: 'source_video_url', order: 1 },
      ],
    })
    const { request } = buildCatalogTaskRequest(node, { references })
    const params = taskTemplateParams(request)
    const context = buildTemplateContext({ request, params, model: {}, modelKey: 'dual', apiKey: '' })
    const wire = renderTemplateValue(built.templatedGraph, context) as ComfyGraph
    expect(wire['1']?.inputs?.file).toBe(pending ? null : 'https://fixture.test/first.mp4')
    expect(wire['2']?.inputs?.file).toBe('https://fixture.test/second.mp4')
  })

  it('keeps two uploaded image slots independent and uses the imported image_edit contract', () => {
    const imported = buildComfyImportModelMapping(builtImages, { modelKey: 'dual-image', labelZh: 'Dual image' })
    let meta = projectParameterReferenceSlots(
      { modelKey: 'dual-image', modelVendor: 'comfyui-local' },
      { parameters: builtImages.parameters },
    )
    const slots = readParameterReferenceSlots(meta)
    meta = {
      ...meta,
      ...parameterReferenceMetaPatch(slots[0], slots, 'https://upload.test/first.png'),
      ...parameterReferenceMetaPatch(slots[1], slots, 'https://upload.test/second.png'),
    }
    const node: GenerationCanvasNode = {
      id: 'target', kind: 'image', title: '', prompt: 'combine', position: { x: 0, y: 0 }, meta,
    }

    const references = resolveGenerationReferences(node)
    const { request } = buildCatalogTaskRequest(node, { references })
    const params = taskTemplateParams(request)
    const context = buildTemplateContext({ request, params, model: {}, modelKey: 'dual-image', apiKey: '' })
    const wire = renderTemplateValue(builtImages.templatedGraph, context) as ComfyGraph

    expect(builtImages.taskKind).toBe('image_edit')
    expect(imported.mapping.taskKind).toBe('image_edit')
    expect(request.kind).toBe('image_edit')
    expect(references.referenceImages).toEqual([])
    expect(references.parameterReferenceUrls).toEqual({
      [slots[0].key]: 'https://upload.test/first.png',
      [slots[1].key]: 'https://upload.test/second.png',
    })
    expect(wire['1']?.inputs?.image).toBe('https://upload.test/first.png')
    expect(wire['2']?.inputs?.image).toBe('https://upload.test/second.png')
  })

  it('uses the structural image_edit contract even before declared image slots are filled', () => {
    const node: GenerationCanvasNode = {
      id: 'empty', kind: 'image', title: '', prompt: 'combine', position: { x: 0, y: 0 },
      meta: projectParameterReferenceSlots(
        { modelKey: 'dual-image', modelVendor: 'comfyui-local' },
        { parameters: builtImages.parameters },
      ),
    }
    const references = resolveGenerationReferences(node)

    expect(references.referenceImages).toEqual([])
    expect(buildCatalogTaskRequest(node, { references }).request.kind).toBe('image_edit')
  })

  it('keeps a unique Comfy image upload keyed without reviving its legacy generic aliases', () => {
    let meta = projectParameterReferenceSlots(
      { modelKey: 'single-image', modelVendor: 'comfyui-local' },
      { parameters: builtSingleImage.parameters },
    )
    const [slot] = readParameterReferenceSlots(meta)
    meta = {
      ...meta,
      ...parameterReferenceMetaPatch(slot, [slot], 'https://upload.test/reference.png'),
      referenceImageUrls: ['https://upload.test/reference.png'],
      firstFrameUrl: 'https://upload.test/reference.png',
      firstFrameRef: 'stale-source',
      firstFrameReference: 'stale-source',
      image_url: 'https://upload.test/reference.png',
      reference_images: ['https://upload.test/reference.png'],
      archetypeInput: { reference_image_urls: ['https://upload.test/reference.png'] },
    }
    const node: GenerationCanvasNode = {
      id: 'single', kind: 'image', title: '', prompt: 'restyle', position: { x: 0, y: 0 }, meta,
    }

    const references = resolveGenerationReferences(node)

    expect(meta.referenceImages).toEqual(['https://upload.test/reference.png'])
    expect(references.parameterReferenceUrls).toEqual({ [slot.key]: 'https://upload.test/reference.png' })
    expect(references.referenceImages).toEqual([])
    expect(references.firstFrameUrl).toBeUndefined()
    const { request } = buildCatalogTaskRequest(node, { references })
    expect(request.kind).toBe('image_edit')
    expectOnlyKeyedReference(request.extras, slot.key, 'https://upload.test/reference.png')
  })

  it('keeps a live or pending keyed Comfy edge out of generic fallbacks', () => {
    let meta = projectParameterReferenceSlots(
      { modelKey: 'single-image', modelVendor: 'comfyui-local' },
      { parameters: builtSingleImage.parameters },
    )
    const [slot] = readParameterReferenceSlots(meta)
    meta = { ...meta, ...parameterReferenceMetaPatch(slot, [slot], 'https://stale.test/reference.png') }
    const node: GenerationCanvasNode = {
      id: 'single', kind: 'image', title: '', prompt: 'restyle', position: { x: 0, y: 0 }, meta,
    }
    const live: GenerationCanvasNode = {
      id: 'source', kind: 'image', title: '', position: { x: 0, y: 0 },
      result: { id: 'result', type: 'image', url: 'https://fresh.test/reference.png', createdAt: 1 },
    }
    const edges = [{ id: 'keyed', source: live.id, target: node.id, mode: 'reference' as const, targetParamKey: slot.key }]

    const liveReferences = resolveGenerationReferences(node, { nodes: [node, live], edges })
    expect(liveReferences.parameterReferenceUrls).toEqual({ [slot.key]: 'https://fresh.test/reference.png' })
    expect(liveReferences.referenceImages).toEqual([])
    expect(liveReferences.firstFrameUrl).toBeUndefined()

    const pendingReferences = resolveGenerationReferences(node, { nodes: [node, { ...live, result: undefined }], edges })
    expect(pendingReferences.parameterReferenceUrls).toEqual({ [slot.key]: null })
    expect(pendingReferences.referenceImages).toEqual([])
    expect(pendingReferences.firstFrameUrl).toBeUndefined()
    expectOnlyKeyedReference(buildCatalogTaskRequest(node, { references: pendingReferences }).request.extras, slot.key, null)
  })

  it('ignores every stale generic media source when a valid Comfy parameter contract exists', () => {
    const exactUrl = 'https://exact.test/slot.png'
    const image = { id: 'stale-image', kind: 'image' as const, title: '', position: { x: 0, y: 0 },
      result: { id: 'image-result', type: 'image' as const, url: 'https://stale.test/node-image.png', createdAt: 1 } }
    const video = { id: 'stale-video', kind: 'video' as const, title: '', position: { x: 0, y: 0 },
      result: { id: 'video-result', type: 'video' as const, url: 'https://stale.test/node-video.mp4', createdAt: 1 } }
    const audio = { id: 'stale-audio', kind: 'audio' as const, title: '', position: { x: 0, y: 0 },
      result: { id: 'audio-result', type: 'audio' as const, url: 'https://stale.test/node-audio.mp3', createdAt: 1 } }
    const node = comfyNodeWithExactSlot('comfy_image_1', exactUrl)
    node.references = [image.id, video.id, audio.id, 'https://stale.test/direct-reference.png']
    node.meta = {
      ...node.meta,
      referenceImages: ['https://stale.test/reference-images.png'],
      referenceImageUrls: ['https://stale.test/reference-image-urls.png'],
      upstreamResultUrls: ['https://stale.test/upstream.png'],
      firstFrameUrl: 'https://stale.test/first-frame.png',
      first_frame_url: 'https://stale.test/first-frame-snake.png',
      firstFrameRef: image.id,
      firstFrameReference: image.id,
      lastFrameUrl: 'https://stale.test/last-frame.png',
      last_frame_url: 'https://stale.test/last-frame-snake.png',
      lastFrameRef: image.id,
      lastFrameReference: image.id,
      referenceVideoUrls: ['https://stale.test/meta-video.mp4'],
      referenceAudioUrls: ['https://stale.test/meta-audio.mp3'],
      styleReferenceImages: ['https://stale.test/style.png'],
      characterReferenceImages: ['https://stale.test/character.png'],
      compositionReferenceImages: ['https://stale.test/composition.png'],
      archetypeInput: { reference_images: ['https://stale.test/archetype.png'] },
    }

    const references = resolveGenerationReferences(node, { nodes: [node, image, video, audio], edges: [] })
    expect(references).toMatchObject({
      parameterReferenceUrls: { comfy_image_1: exactUrl },
      referenceImages: [],
      referenceVideos: [],
      referenceAudios: [],
      styleReferenceImages: [],
      characterReferenceImages: [],
      compositionReferenceImages: [],
    })
    expect(references.firstFrameUrl).toBeUndefined()
    expect(references.lastFrameUrl).toBeUndefined()
    expect(JSON.stringify(buildCatalogTaskRequest(node, { references }).request.extras)).not.toContain('https://stale.test/')
  })

  it.each(genericReferenceAliases)('lets an exact Comfy slot named %s override the derived legacy alias', (key) => {
    const exactUrl = key === 'activeAssetUrls'
      ? 'nomi-local://asset/exact-active.png'
      : `https://exact.test/${key}`
    const node = comfyNodeWithExactSlot(key, exactUrl)
    const uploaded = buildCatalogTaskRequest(node, { references: resolveGenerationReferences(node) }).request.extras
    expect(uploaded?.[key]).toBe(exactUrl)
    expect(typeof uploaded?.[key]).toBe('string')

    const pendingSource: GenerationCanvasNode = {
      id: 'pending', kind: 'image', title: '', position: { x: 0, y: 0 },
    }
    const pendingReferences = resolveGenerationReferences(node, {
      nodes: [node, pendingSource],
      edges: [{ id: `edge-${key}`, source: pendingSource.id, target: node.id, mode: 'reference', targetParamKey: key }],
    })
    const pending = buildCatalogTaskRequest(node, { references: pendingReferences }).request.extras
    expect(pending).toHaveProperty(key, null)
  })

  it('keeps a LoadVideo-only SaveVideo workflow in text_to_video', () => {
    const node: GenerationCanvasNode = {
      id: 'video-only', kind: 'video', title: '', prompt: '', position: { x: 0, y: 0 },
      meta: projectParameterReferenceSlots(
        { modelKey: 'dual-video', modelVendor: 'comfyui-local' },
        { parameters: built.parameters },
      ),
    }

    expect(built.taskKind).toBe('text_to_video')
    expect(buildCatalogTaskRequest(node, { references: resolveGenerationReferences(node) }).request.kind)
      .toBe('text_to_video')
  })

  it('does not apply the Comfy structural contract to non-Comfy vendors', () => {
    const node: GenerationCanvasNode = {
      id: 'custom', kind: 'image', title: '', prompt: 'combine', position: { x: 0, y: 0 },
      meta: projectParameterReferenceSlots(
        { modelKey: 'custom-image', modelVendor: 'custom' },
        { parameters: builtImages.parameters },
      ),
    }
    const references = resolveGenerationReferences(node)

    expect(buildCatalogTaskRequest(node, { references }).request.kind).toBe('text_to_image')
    expect(buildCatalogTaskRequest(node, { references: { ...references, referenceImages: ['https://ref.test/a.png'] } }).request.kind)
      .toBe('image_edit')
  })

  it('preserves unique-slot legacy aliases and dynamic image_edit for non-Comfy vendors', () => {
    let meta = projectParameterReferenceSlots(
      { modelKey: 'custom-single-image', modelVendor: 'custom' },
      { parameters: builtSingleImage.parameters },
    )
    const [slot] = readParameterReferenceSlots(meta)
    meta = { ...meta, ...parameterReferenceMetaPatch(slot, [slot], 'https://upload.test/custom.png') }
    const node: GenerationCanvasNode = {
      id: 'custom-single', kind: 'image', title: '', prompt: 'restyle', position: { x: 0, y: 0 }, meta,
    }

    const references = resolveGenerationReferences(node)

    expect(references.parameterReferenceUrls).toEqual({ [slot.key]: 'https://upload.test/custom.png' })
    expect(references.referenceImages).toEqual(['https://upload.test/custom.png'])
    expect(references.firstFrameUrl).toBe('https://upload.test/custom.png')
    const { request } = buildCatalogTaskRequest(node, { references })
    expect(request.kind).toBe('image_edit')
    expect(request.extras).toMatchObject({
      [slot.key]: 'https://upload.test/custom.png',
      referenceImages: ['https://upload.test/custom.png'],
      referenceImageUrl: 'https://upload.test/custom.png',
      referenceImageRef: null,
    })
  })
})
