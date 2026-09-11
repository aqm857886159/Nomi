import { describe, expect, it } from 'vitest'
import { composerHeadlineSummary } from './composerHeadlineSummary'
import type { DynamicModelControl } from './controls/parameterControlModel'

// 底栏参数 chip 的「两个值」（2026-09-11 拍板的 v1.1）：视频=比例+时长，图=比例+清晰度。
// 这条规则的价值全在「换个模型照样说得对」——所以每条都拿**档案里真实存在的控件形状**去验，
// 不是拿一个手搓的理想 control。

const ratio: DynamicModelControl = {
  key: 'aspect_ratio', label: '比例', type: 'select', binding: 'parameter',
  options: [{ value: '16:9', label: '16:9' }, { value: '9:16', label: '9:16' }], defaultValue: '16:9',
}
// 档案里 duration 就是 number 型、options 为空（见 electron/shared/videoCapabilities/minimaxH3Max.ts）。
const duration: DynamicModelControl = {
  key: 'duration', label: '时长(秒)', type: 'number', binding: 'parameter',
  options: [], min: 5, max: 15, defaultValue: 5,
}
const resolution: DynamicModelControl = {
  key: 'resolution', label: '清晰度', type: 'select', binding: 'parameter',
  options: [{ value: '1080p', label: '1080p' }, { value: '2K', label: '2K' }], defaultValue: '1080p',
}
const audio: DynamicModelControl = {
  key: 'generate_audio', label: '生成音频', type: 'boolean', binding: 'parameter',
  options: [], defaultValue: true,
}

const seconds = (value: string): string => `${value}s`
const summary = (args: Partial<Parameters<typeof composerHeadlineSummary>[0]> & {
  controls: DynamicModelControl[]
  meta: Record<string, unknown>
}): string | undefined => composerHeadlineSummary({
  isImageLike: false, isVideoLike: false, formatSeconds: seconds, ...args,
})

describe('composerHeadlineSummary', () => {
  it('视频只报比例 + 时长，清晰度和生成音频退到弹层里', () => {
    expect(summary({
      isVideoLike: true,
      controls: [resolution, ratio, duration, audio],
      meta: { aspect_ratio: '16:9', duration: 5, resolution: '1080p', generate_audio: true },
    })).toBe('16:9 · 5s')
  })

  it('图只报比例 + 清晰度', () => {
    expect(summary({
      isImageLike: true,
      controls: [ratio, resolution],
      meta: { aspect_ratio: '9:16', resolution: '2K' },
    })).toBe('9:16 · 2K')
  })

  it('顺序按规则来，不随控件在档案里的声明顺序漂', () => {
    expect(summary({
      isVideoLike: true,
      controls: [duration, ratio],
      meta: { aspect_ratio: '16:9', duration: 8 },
    })).toBe('16:9 · 8s')
  })

  it('时长已经带单位就不再补一次（否则渲出「5ss」）', () => {
    expect(summary({
      isVideoLike: true,
      controls: [ratio, { ...duration, type: 'select', options: [{ value: '5', label: '5 秒' }] } as DynamicModelControl],
      meta: { aspect_ratio: '16:9', duration: '5' },
    })).toBe('16:9 · 5 秒')
  })

  it('声音 / 文本 / 3D 没定过「那两个值」，就不替它们挑——回默认串接', () => {
    expect(summary({ controls: [ratio, duration], meta: { aspect_ratio: '16:9', duration: 5 } })).toBeUndefined()
  })

  it('一个都命中不到就返回 undefined，不假装有摘要', () => {
    expect(summary({ isVideoLike: true, controls: [audio], meta: { generate_audio: true } })).toBeUndefined()
  })

  it('值从 meta derive，不是写死的一句文案', () => {
    expect(summary({
      isVideoLike: true, controls: [ratio, duration], meta: { aspect_ratio: '9:16', duration: 12 },
    })).toBe('9:16 · 12s')
  })
})
