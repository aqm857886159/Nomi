import { describe, it, expect } from 'vitest'
import type { ModelParameterControl } from '../../../../config/modelCatalogMeta'
import {
  buildImageUrlSlots,
  isImportedComfyWorkflowModel,
  parseControlInput,
  shouldUseVideoFrameSlotFallback,
  videoAspectDefaultPatch,
  type DynamicModelControl,
} from './parameterControlModel'

// parseControlInput 按控件类型回类型。关键修复（2026-06-16）：select 按选中 option 的声明类型回类型——
// 数值 option（如 duration 离散枚举 4/8/12）回 number 整数，避免发字符串 "8" 被 vendor 400。
describe('parseControlInput — select 按 option 声明类型回类型', () => {
  const numSelect: ModelParameterControl = {
    key: 'duration', label: '时长', type: 'select',
    options: [{ value: 4, label: '4' }, { value: 8, label: '8' }, { value: 12, label: '12' }],
  }
  const strSelect: ModelParameterControl = {
    key: 'resolution', label: '清晰度', type: 'select',
    options: [{ value: '720p', label: '720p' }, { value: '1080p', label: '1080p' }],
  }

  it('数值 option 的 select → 回 number（发整数）', () => {
    expect(parseControlInput(numSelect, '8')).toBe(8)
    expect(typeof parseControlInput(numSelect, '8')).toBe('number')
  })
  it('字符串 option 的 select → 仍回 string（720p 不被误转）', () => {
    expect(parseControlInput(strSelect, '720p')).toBe('720p')
  })
  it('number 控件直接 Number()', () => {
    expect(parseControlInput({ key: 'd', label: 'd', type: 'number', options: [] }, '5')).toBe(5)
  })
})

describe('videoAspectDefaultPatch（2026-07-17：视频首选 16:9 / 输入全竖 9:16 的产品默认）', () => {
  const catalogAspect: DynamicModelControl = {
    key: 'aspect_ratio',
    label: '画幅',
    binding: 'size',
    options: [
      { value: '1:1', label: '1:1' },
      { value: '9:16', label: '9:16' },
      { value: '16:9', label: '16:9' },
    ],
  }

  it('catalog 比例控件：匹配 16:9 并生成多键同步 patch', () => {
    const patch = videoAspectDefaultPatch([catalogAspect], '16:9')
    expect(patch.aspect_ratio).toBe('16:9')
    expect(patch.size).toBe('16:9')
    expect(patch.videoSize).toBe('16:9')
  })

  it('parameter 比例控件：像素值靠 label 归一匹配（value=1024x1536 label=9:16）', () => {
    const paramAspect = {
      key: 'size',
      label: '比例',
      type: 'select',
      binding: 'parameter',
      options: [
        { value: '1024x1024', label: '1:1' },
        { value: '1024x1536', label: '9:16' },
      ],
    } as unknown as DynamicModelControl
    const patch = videoAspectDefaultPatch([paramAspect], '9:16')
    expect(patch.size).toBe('1024x1536')
    expect(patch.aspect_ratio).toBe('9:16')
  })

  it('模型没有等价档位（只有 1:1）→ 空 patch（保留档案默认）', () => {
    const only11: DynamicModelControl = { ...catalogAspect, options: [{ value: '1:1', label: '1:1' }] }
    expect(videoAspectDefaultPatch([only11], '16:9')).toEqual({})
  })

  it('无比例控件 → 空 patch', () => {
    const duration: DynamicModelControl = { key: 'durationSeconds', label: '时长', binding: 'durationSeconds', options: [{ value: '5', label: '5s' }] }
    expect(videoAspectDefaultPatch([duration], '16:9')).toEqual({})
  })
})

// 2026-08-20：原先这里测的是 buildComfyWorkflowImageUrlSlots——一个只认 firstFrame/lastFrame
// 两个角色的 ComfyUI 特例。它已按 P1 删除：导入侧把**声明的每个**媒体输入都写成 type:'image-url'
// 参数，于是通用的 buildImageUrlSlots 逐条出槽。下面测的就是这条通用路（群反馈 G2#421 的判据）。
describe('buildImageUrlSlots — ComfyUI 导入工作流按声明逐条出槽', () => {
  const comfyMeta = (parameters: Array<{ key: string; label: string; type: string }>) => ({ parameters })

  it('声明 3 个图像输入 → 出 3 个槽（多参工作流不再只能连一张）', () => {
    const slots = buildImageUrlSlots(comfyMeta([
      { key: 'comfy_ref_a', label: '参考图 A', type: 'image-url' },
      { key: 'comfy_ref_b', label: '参考图 B', type: 'image-url' },
      { key: 'comfy_ref_c', label: '参考图 C', type: 'image-url' },
    ]))
    expect(slots.map((s) => s.key)).toEqual(['comfy_ref_a', 'comfy_ref_b', 'comfy_ref_c'])
    expect(slots.map((s) => s.label)).toEqual(['参考图 A', '参考图 B', '参考图 C'])
  })

  it('老工作流的首/尾帧键仍分回首帧/尾帧组（迁移不改语义）', () => {
    const slots = buildImageUrlSlots(comfyMeta([
      { key: 'first_frame_url', label: '首帧', type: 'image-url' },
      { key: 'last_frame_url', label: '尾帧', type: 'image-url' },
    ]))
    expect(slots).toEqual([
      { key: 'first_frame_url', label: '首帧', group: 'first_frame' },
      { key: 'last_frame_url', label: '尾帧', group: 'last_frame' },
    ])
  })

  it('一个图像输入都没声明 → 一个槽都不出，绝不瞎猜首尾帧', () => {
    expect(buildImageUrlSlots(comfyMeta([{ key: 'comfy_seed', label: 'Seed', type: 'number' }]))).toEqual([])
  })
})

describe('shouldUseVideoFrameSlotFallback — 未识别视频模型兜底不套到 ComfyUI', () => {
  it('普通未知视频模型 → 兜底显示首尾帧槽', () => {
    expect(shouldUseVideoFrameSlotFallback({
      isVideoLike: true,
      modelImageUrlSlots: [],
      vendor: 'custom-relay',
    })).toBe(true)
  })

  it('ComfyUI 视频 workflow 缺 binding → 不凭空补尾帧', () => {
    expect(shouldUseVideoFrameSlotFallback({
      isVideoLike: true,
      modelImageUrlSlots: [],
      vendor: 'comfyui-local',
    })).toBe(false)
  })

  it('ComfyUI 文生视频 binding 明确无帧槽 → 不兜底首尾帧', () => {
    expect(shouldUseVideoFrameSlotFallback({
      isVideoLike: true,
      modelImageUrlSlots: [],
      vendor: 'comfyui-local',
    })).toBe(false)
  })
})


// 群反馈 2026-08-20 G2#433「导入时勾了功能，画布里没有对应的功能按钮」。
// 参数其实**渲染了**（resolveRenderedControls 在无 archetype 分支会读 meta.parameters），
// 缺的是底栏那颗摘要 pill 没说清里面是什么：它默认串当前值，
// 档案模型上是 `16:9 · 2k`（认得出），导入工作流上是 `15 · 24`（认不出）。
// 这个判据决定要不要换成「工作流参数 · N 项」。
describe('isImportedComfyWorkflowModel — 认出「用户导入的工作流」这类模型', () => {
  it('导入流程写过 comfyWorkflowImport → 是', () => {
    expect(isImportedComfyWorkflowModel({ comfyWorkflowImport: { binding: {} } })).toBe(true)
  })

  it('内置档案模型没有这个键 → 否（它们的值串本来就读得懂，不该被改文案）', () => {
    expect(isImportedComfyWorkflowModel({ parameters: [{ key: 'aspect_ratio' }] })).toBe(false)
  })

  it('meta 缺失 / 非对象 → 否，不炸', () => {
    expect(isImportedComfyWorkflowModel(undefined)).toBe(false)
    expect(isImportedComfyWorkflowModel(null)).toBe(false)
    expect(isImportedComfyWorkflowModel('comfyWorkflowImport')).toBe(false)
  })
})
