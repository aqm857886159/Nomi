// 「画布节点预览 · 实时」的视图模型。口径必须和生成画布一致（否则预览就是在骗人），
// 关键一条：首帧/尾帧要**节点 + 输入键成对**才算绑上——与画布 buildComfyWorkflowImageUrlSlots 同判据。
import { describe, expect, it } from 'vitest'
import { buildCanvasPreview, previewValuesToExtras } from './comfyuiCanvasPreview'
import type { WorkflowBinding } from './comfyuiWorkflowBinding'

const param = (paramKey: string, type: 'number' | 'text' | 'boolean', value: string | number | boolean) => ({
  nodeId: '292', inputKey: 'value', paramKey, label: paramKey, type, default: value,
})

describe('画布节点预览', () => {
  it('没绑任何东西 = 画布上只有一个生成钮，明确报空（不是留白）', () => {
    expect(buildCanvasPreview({})).toEqual({ fields: [], isEmpty: true })
    expect(buildCanvasPreview(null).isEmpty).toBe(true)
  })

  it('顺序固定：提示词 → 源视频 → 首帧 → 尾帧 → 可调字段', () => {
    const binding: WorkflowBinding = {
      promptNodeId: '110', promptInputKey: 'text',
      sourceVideoNodeId: '210', sourceVideoInputKey: 'file',
      firstFrameNodeId: '200', firstFrameInputKey: 'image',
      lastFrameNodeId: '201', lastFrameInputKey: 'image',
      params: [param('comfy_width', 'number', 960)],
    }
    expect(buildCanvasPreview(binding).fields.map((f) => f.key)).toEqual([
      'prompt', 'sourceVideo', 'firstFrame', 'lastFrame', 'comfy_width',
    ])
  })

  it('首帧只有节点号、没有输入键 → 不算绑上（和画布判据一致，别画一个画布上不存在的槽）', () => {
    expect(buildCanvasPreview({ firstFrameNodeId: '200' }).fields).toEqual([])
    expect(buildCanvasPreview({ firstFrameNodeId: '200', firstFrameInputKey: 'image' }).fields).toHaveLength(1)
  })

  it('提示词槽带出它来自哪个节点的哪个输入（改绑时能对上图上的卡）', () => {
    const [field] = buildCanvasPreview({ promptNodeId: '110', promptInputKey: 'text' }).fields
    expect(field).toMatchObject({ kind: 'prompt', nodeId: '110', inputKey: 'text' })
  })

  it('源视频是 video 槽、不是 image 槽（当首帧发 mp4 必失败）', () => {
    const [field] = buildCanvasPreview({ sourceVideoNodeId: '210', sourceVideoInputKey: 'file' }).fields
    expect(field.kind).toBe('video')
  })

  it('可调字段带上用户起的名字、类型和默认值', () => {
    const fields = buildCanvasPreview({ params: [param('steps', 'number', 20), param('hires', 'boolean', true)] }).fields
    expect(fields.map((f) => [f.label, f.kind, f.defaultValue])).toEqual([
      ['steps', 'number', 20],
      ['hires', 'boolean', true],
    ])
  })

  it('combo 参数按 classType+inputKey 拿到本机可选值 → 预览给下拉，不假装是自由输入框', () => {
    const preview = buildCanvasPreview(
      { params: [{ nodeId: '4', inputKey: 'ckpt_name', paramKey: 'ckpt', label: '模型', type: 'text', default: 'a.safetensors' }] },
      {
        classTypeByNodeId: new Map([['4', 'CheckpointLoaderSimple']]),
        enumOptions: [{ classType: 'CheckpointLoaderSimple', inputKey: 'ckpt_name', options: ['a.safetensors', 'b.safetensors'] }],
      },
    )
    expect(preview.fields[0].options).toEqual(['a.safetensors', 'b.safetensors'])
  })

  it('对不上的 enumOptions 不硬套（别给一个装满别的节点选项的假下拉）', () => {
    const preview = buildCanvasPreview(
      { params: [param('comfy_width', 'number', 960)] },
      {
        classTypeByNodeId: new Map([['292', 'INTConstant']]),
        enumOptions: [{ classType: 'CheckpointLoaderSimple', inputKey: 'ckpt_name', options: ['a'] }],
      },
    )
    expect(preview.fields[0].options).toBeUndefined()
  })
})

describe('预览里填的值 → 试跑 extras', () => {
  const fields = buildCanvasPreview({
    promptNodeId: '110', promptInputKey: 'text',
    firstFrameNodeId: '200', firstFrameInputKey: 'image',
    params: [param('comfy_width', 'number', 960), param('style', 'text', 'anime'), param('hires', 'boolean', false)],
  }).fields

  it('媒体槽和提示词不进 extras（它们各有各的传法）', () => {
    const extras = previewValuesToExtras(fields, {})
    expect(extras).not.toHaveProperty('prompt')
    expect(extras).not.toHaveProperty('firstFrame')
  })

  it('没填的字段落回默认值', () => {
    expect(previewValuesToExtras(fields, {})).toEqual({ comfy_width: 960, style: 'anime', hires: false })
  })

  it('数字按数字发；打了非数字退回默认值（NaN 进 JSON 会变 null，ComfyUI 直接 400）', () => {
    expect(previewValuesToExtras(fields, { comfy_width: '512' }).comfy_width).toBe(512)
    expect(previewValuesToExtras(fields, { comfy_width: '一千' }).comfy_width).toBe(960)
  })

  it('布尔按字符串 true 判', () => {
    expect(previewValuesToExtras(fields, { hires: 'true' }).hires).toBe(true)
    expect(previewValuesToExtras(fields, { hires: 'false' }).hires).toBe(false)
  })
})
