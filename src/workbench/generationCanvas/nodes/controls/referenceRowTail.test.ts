import { describe, expect, it } from 'vitest'
import i18n from '../../../../i18n'
import { modelLimitNotice, referenceCountText } from './referenceRowTail'
import type { ModelOption } from '../../../../config/models'

// 行尾报数（边界样张 K1，用户 2026-11-12「按推荐做」）：只有图 →「参考图 N 张」；两种以上 →「图 30 · 视频 10 · 音频 10」。
// 用真词典，不在测试里抄第二份文案。
const tOf = (locale: string) => i18n.getFixedT(locale) as unknown as (key: string, values?: Record<string, unknown>) => string
const zh = tOf('zh-CN')
const en = tOf('en')

describe('referenceCountText', () => {
  it('什么都没放 → 不报数', () => {
    expect(referenceCountText(zh, { image: 0, video: 0, audio: 0 })).toBe('')
  })

  it('只有图 → 参考图 N 张（视频、音频不算进「参考图」）', () => {
    expect(referenceCountText(zh, { image: 4, video: 0, audio: 0 })).toBe(zh('assetLibrary.refRow.count', { count: 4 }))
    expect(referenceCountText(en, { image: 1, video: 0, audio: 0 })).toBe(en('assetLibrary.refRow.count', { count: 1 }))
  })

  it('两种以上 → 按类型报数，顺序固定 图 · 视频 · 音频', () => {
    expect(referenceCountText(zh, { image: 30, video: 10, audio: 10 })).toBe('图 30 · 视频 10 · 音频 10')
    expect(referenceCountText(en, { image: 30, video: 10, audio: 10 })).toBe('30 images · 10 videos · 10 audio')
    expect(referenceCountText(en, { image: 1, video: 1, audio: 0 })).toBe('1 image · 1 video')
  })

  it('只有视频 / 只有音频也按类型报，不叫「参考图」', () => {
    expect(referenceCountText(zh, { image: 0, video: 2, audio: 0 })).toBe('视频 2')
    expect(referenceCountText(zh, { image: 0, video: 0, audio: 3 })).toBe('音频 3')
  })

  it('每种都到上限 → 末尾加「，都放满了」', () => {
    expect(referenceCountText(zh, { image: 30, video: 10, audio: 10 }, true)).toBe('图 30 · 视频 10 · 音频 10，都放满了')
    expect(referenceCountText(en, { image: 30, video: 10, audio: 10 }, true)).toBe('30 images · 10 videos · 10 audio, all full')
  })
})

describe('modelLimitNotice — 方式只收下一部分才报数', () => {
  const kling = { value: 'apimart:kling-4.0', label: '可灵 4.0', vendor: 'apimart', kind: 'video', meta: { canonicalModelId: 'kling-4.0' } } as unknown as ModelOption
  it('收下 2 / 共 3 → 报数，模型名是底栏那一份', () => {
    expect(modelLimitNotice([kling], kling, { status: 'ok', taken: 2 }, 3)).toMatchObject({ max: 2, total: 3 })
  })
  it('全收下、一件没收、或方式状态不是 ok → 不报', () => {
    expect(modelLimitNotice([kling], kling, { status: 'ok', taken: 3 }, 3)).toBeNull()
    expect(modelLimitNotice([kling], kling, { status: 'ok', taken: 0 }, 3)).toBeNull()
    expect(modelLimitNotice([kling], kling, { status: 'blocked', taken: 2 }, 3)).toBeNull()
    expect(modelLimitNotice([kling], kling, null, 3)).toBeNull()
  })
})
