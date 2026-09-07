// 「错误里什么都没有」时唯一允许说的话。这份夹具守的是**信息不被洗掉**：
// 机器码要活着穿到分类器（否则出站被拦会被归成 network，配一句「稍等重试」——而重试 = 再付一次钱），
// 兜底句不许等于顶部状态徽标那句「生成失败」（那是同义反复，用户读到「生成失败：生成失败」）。
import { describe, expect, it } from 'vitest'
import { describeOpaqueFailure } from './opaqueFailure'
import { classifyGenerationError } from './classifyError'
import { tagNomiError } from '../../../electron/shared/nomiErrorCodes'
import i18n from '../../i18n'

describe('describeOpaqueFailure', () => {
  it('有 message 就原样交出——机器码必须一个字不改地活着穿过去', () => {
    const tagged = tagNomiError('outbound-blocked', '钱已经付过，用「重新拉取结果」免费取回。')
    expect(describeOpaqueFailure(new Error(tagged))).toBe(tagged)
    // 端到端那半：交出去的东西被分类器认回同一个 kind，而不是掉进 unknown/network。
    expect(classifyGenerationError(describeOpaqueFailure(new Error(tagged))).kind).toBe('outbound-blocked')
  })

  it('Error 但 message 为空 → 交出类名当线索，而不是一句同义反复', () => {
    class OutboundDestinationRefusedError extends Error {}
    const described = describeOpaqueFailure(new OutboundDestinationRefusedError(''))
    expect(described).toContain('OutboundDestinationRefusedError')
    expect(described).toContain(i18n.t('generationCommon.observability.error.opaque.detail'))
  })

  it('根本不是 Error（throw 一个对象 / 字符串）→ 交出能读的那部分', () => {
    expect(describeOpaqueFailure({ code: 'E_NO_IDEA' })).toContain('E_NO_IDEA')
    expect(describeOpaqueFailure('上游直接扔了个字符串')).toContain('上游直接扔了个字符串')
  })

  it('什么都没有（null/undefined）→ 只剩兜底句，且**刻意不等于**顶部徽标的「生成失败」', () => {
    const fallback = i18n.t('generationCommon.observability.error.opaque.detail')
    expect(describeOpaqueFailure(null)).toBe(fallback)
    expect(describeOpaqueFailure(undefined)).toBe(fallback)
    // 这条是整个模块存在的理由：兜底句一旦退化成徽标那句，用户就又读到「生成失败：生成失败」。
    expect(fallback).not.toBe(i18n.t('generationCommon.observability.error.unknown.reason'))
    expect(String(fallback).trim()).not.toBe('生成失败')
  })

  it('非 Error 的可读部分被截断，撑不爆错误卡', () => {
    expect(describeOpaqueFailure({ blob: 'x'.repeat(5000) }).length).toBeLessThan(600)
  })
})
