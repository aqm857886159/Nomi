import { describe, it, expect } from 'vitest'
import type { ModelParameterControl } from '../../../../config/modelCatalogMeta'
import {
  buildComfyWorkflowImageUrlSlots,
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

describe('buildComfyWorkflowImageUrlSlots — 按导入 binding 显示 Comfy 图像槽', () => {
  const labels = { firstFrame: '首帧', lastFrame: '尾帧' }

  it('只绑定首帧的 i2v workflow → 只显示首帧槽', () => {
    const slots = buildComfyWorkflowImageUrlSlots({
      comfyWorkflowImport: {
        binding: { firstFrameNodeId: '57', firstFrameInputKey: 'image', outputKind: 'video' },
      },
    }, labels)
    expect(slots).toEqual([{ key: 'firstFrameUrl', label: '首帧', group: 'first_frame' }])
  })

  it('首尾帧 workflow → 显示首帧和尾帧槽', () => {
    const slots = buildComfyWorkflowImageUrlSlots({
      comfyWorkflowImport: {
        binding: {
          firstFrameNodeId: '80',
          firstFrameInputKey: 'image',
          lastFrameNodeId: '89',
          lastFrameInputKey: 'image',
        },
      },
    }, labels)
    expect(slots).toEqual([
      { key: 'firstFrameUrl', label: '首帧', group: 'first_frame' },
      { key: 'lastFrameUrl', label: '尾帧', group: 'last_frame' },
    ])
  })

  it('Comfy 文生视频 workflow 无帧绑定 → 返回空槽数组，调用方不应再用视频首尾帧兜底', () => {
    expect(buildComfyWorkflowImageUrlSlots({ comfyWorkflowImport: { binding: { outputKind: 'video' } } }, labels)).toEqual([])
  })

  it('非 Comfy 导入模型 → 返回 null，调用方继续走通用参数解析和视频兜底', () => {
    expect(buildComfyWorkflowImageUrlSlots({ parameters: [] }, labels)).toBeNull()
  })
})

describe('shouldUseVideoFrameSlotFallback — 未识别视频模型兜底不套到 ComfyUI', () => {
  it('普通未知视频模型 → 兜底显示首尾帧槽', () => {
    expect(shouldUseVideoFrameSlotFallback({
      isVideoLike: true,
      modelImageUrlSlots: [],
      comfyImageUrlSlots: null,
      vendor: 'custom-relay',
    })).toBe(true)
  })

  it('ComfyUI 视频 workflow 缺 binding → 不凭空补尾帧', () => {
    expect(shouldUseVideoFrameSlotFallback({
      isVideoLike: true,
      modelImageUrlSlots: [],
      comfyImageUrlSlots: null,
      vendor: 'comfyui-local',
    })).toBe(false)
  })

  it('ComfyUI 文生视频 binding 明确无帧槽 → 不兜底首尾帧', () => {
    expect(shouldUseVideoFrameSlotFallback({
      isVideoLike: true,
      modelImageUrlSlots: [],
      comfyImageUrlSlots: [],
      vendor: 'comfyui-local',
    })).toBe(false)
  })
})
