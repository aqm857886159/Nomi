import { describe, expect, it } from 'vitest'
import { buildTemplateContext, renderTemplateValue } from '../ai/requestPipeline'
import { applyWireDefaults, taskTemplateParams } from './taskParams'
import {
  buildComfyImportModelMapping,
  buildImportedWorkflow,
  normalizeWorkflowBinding,
  type ComfyGraph,
  type WorkflowBinding,
} from './comfyuiWorkflowImport'

const graph: ComfyGraph = {
  '1': { class_type: 'LoadImage', inputs: { image: 'a.png' } },
  '2': { class_type: 'LoadImage', inputs: { image: 'b.png' } },
  '3': { class_type: 'LoadImage', inputs: { image: 'c.png' } },
  '4': { class_type: 'TextInput', inputs: { text: 'a caption', other: 'another caption' } },
  '9': { class_type: 'SaveImage', inputs: { images: ['1', 0] } },
}

function collidingBinding(): WorkflowBinding {
  return {
    images: ['1', '2', '3'].map((nodeId) => ({
      nodeId, inputKey: 'image', paramKey: `comfy_image_${nodeId}`, label: `Image ${nodeId}`, mediaKind: 'image',
    })),
    outputNodeId: '9', outputKind: 'image',
    params: [
      { nodeId: '4', inputKey: 'text', paramKey: 'image_1', label: 'Caption', type: 'text', default: 'a caption' },
      { nodeId: '4', inputKey: 'other', paramKey: 'comfy_image_1', label: 'Other', type: 'text', default: 'another caption' },
    ],
  }
}

describe('ComfyUI shared media and scalar parameter namespace', () => {
  it('drops a stale media binding that targets VHS frame_rate and preserves the numeric fps', () => {
    const videoGraph: ComfyGraph = {
      '1': { class_type: 'LoadImage', inputs: { image: 'input.png' } },
      '9': { class_type: 'VHS_VideoCombine', inputs: { images: ['1', 0], frame_rate: 24 } },
    }
    const staleBinding: WorkflowBinding = {
      images: [
        {
          nodeId: '9',
          inputKey: 'frame_rate',
          paramKey: 'first_frame_url',
          label: 'First frame',
          mediaKind: 'image',
        },
      ],
      outputNodeId: '9',
      outputKind: 'video',
      params: [],
    }

    const normalized = normalizeWorkflowBinding(staleBinding, videoGraph)
    expect(normalized.images).toEqual([])
    expect(buildImportedWorkflow(videoGraph, staleBinding).templatedGraph['9'].inputs?.frame_rate).toBe(24)
  })

  it('keeps media keys and suffixes every colliding scalar without dropping user fields', () => {
    const source = collidingBinding()
    const normalized = normalizeWorkflowBinding(source, graph)
    expect(normalized.images).toEqual(source.images)
    expect(normalized.params?.map((param) => param.paramKey)).toEqual(['comfy_image_1_2', 'comfy_image_1_3'])
    expect(normalized.params?.map((param) => param.default)).toEqual(['a caption', 'another caption'])
    expect(normalizeWorkflowBinding(normalized, graph)).toEqual(normalized)
  })

  it('builds separate controls, defaults and actual rendered values for all three images and both captions', () => {
    const binding = collidingBinding()
    const built = buildImportedWorkflow(graph, binding)
    const { mapping } = buildComfyImportModelMapping(built, {
      modelKey: 'comfy-shared-keys', labelZh: 'Shared keys', draft: { text: JSON.stringify(graph), binding },
    })
    expect(built.parameters.map(({ key, type }) => ({ key, type }))).toEqual([
      { key: 'comfy_image_1', type: 'image-url' },
      { key: 'comfy_image_2', type: 'image-url' },
      { key: 'comfy_image_3', type: 'image-url' },
      { key: 'comfy_image_1_2', type: 'text' },
      { key: 'comfy_image_1_3', type: 'text' },
    ])
    expect(built.templatedGraph['1'].inputs?.image).toBe('{{request.params.comfy_image_1}}')
    expect(built.templatedGraph['4'].inputs?.text).toBe('{{request.params.comfy_image_1_2}}')
    const create = mapping.create as { body: unknown; defaultParams: Record<string, unknown> }
    expect(create.defaultParams).toEqual({
      comfy_image_1: '', comfy_image_2: '', comfy_image_3: '',
      comfy_image_1_2: 'a caption', comfy_image_1_3: 'another caption',
    })
    const extras = applyWireDefaults({ comfy_image_1: 'upload/a.png', comfy_image_2: 'upload/b.png', comfy_image_3: 'upload/c.png' }, create.defaultParams)
    const context = buildTemplateContext({ request: { extras }, params: taskTemplateParams({ extras }), model: {}, modelKey: 'comfy-shared-keys', apiKey: '' })
    const body = renderTemplateValue(create.body, context) as { prompt: ComfyGraph }
    expect(['1', '2', '3'].map((nodeId) => body.prompt[nodeId].inputs?.image)).toEqual(['upload/a.png', 'upload/b.png', 'upload/c.png'])
    expect(body.prompt['4'].inputs).toEqual({ text: 'a caption', other: 'another caption' })
  })

  it.each(['first_frame_url', 'last_frame_url', 'source_video_url'])(
    'preserves the legacy %s media key through repeated normalization', (paramKey) => {
      const source = collidingBinding()
      source.images![0].paramKey = paramKey
      source.params![0].paramKey = paramKey
      const normalized = normalizeWorkflowBinding(source, graph)
      expect(normalized.images?.[0]?.paramKey).toBe(paramKey)
      expect(normalized.params?.[0]?.paramKey).toBe(`comfy_${paramKey}`)
      expect(normalizeWorkflowBinding(normalized, graph)).toEqual(normalized)
    },
  )
})
