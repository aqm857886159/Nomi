import { describe, expect, it } from 'vitest'
import { enAgentToolFailure, zhAgentToolFailure } from '../../../i18n/locales/agentToolFailure'
import type { LaneToolPublicFailure } from '../../../../electron/shared/agentLane/laneToolFailureEnvelope'
import { laneToolFailureDetail, laneToolFailureSummary } from './laneToolFailureText'

// 用真词典插值（不是 key 回显）：钉住的是创作者真正读到的那句话由哪几块拼成，zh / en 两轨。
// 期望值也按键从词典取（`check:test-copy-literals`：测试里不抄文案）。
function translatorOf(dictionary: Record<string, string>) {
  return (key: string, options?: Record<string, unknown>): string => {
    const template = dictionary[key.replace(/^agentToolFailure\./, '')]
    if (template === undefined) throw new Error(`missing key ${key}`)
    return template.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(options?.[name] ?? `{{${name}}}`))
  }
}
const tracks = [
  { name: 'zh', t: translatorOf(zhAgentToolFailure) },
  { name: 'en', t: translatorOf(enAgentToolFailure) },
] as const

const unknownField: LaneToolPublicFailure = {
  code: 'tool_arguments_invalid',
  issues: [{ path: 'shots.0.durationSeconds', kind: 'unknown_field', nearest: 'durationSec', allowed: ['title', 'prompt', 'durationSec'] }],
}
const notAllowed: LaneToolPublicFailure = {
  code: 'tool_arguments_invalid',
  allowed: ['image', 'video'],
  issues: [{ path: 'shots.0.kind', kind: 'not_allowed', allowed: ['image', 'video'] }],
}

describe.each(tracks)('面板说「哪个字段 · 该填什么」，不说「参数不合法」（$name）', ({ t }) => {
  const k = (key: string, options?: Record<string, unknown>) => t(`agentToolFailure.${key}`, options)
  const values = (list: readonly string[]) => list.join(k('listSeparator'))

  it('行尾摘要：第一处字段 + 该怎么改', () => {
    const summary = laneToolFailureSummary(t, unknownField)
    expect(summary).toBe(k('argumentsWithField', { issue: k('issueUnknownFieldNearest', { field: 'shots.0.durationSeconds', nearest: 'durationSec' }) }))
    expect(summary).toContain('shots.0.durationSeconds')
    expect(summary).toContain('durationSec')
    expect(summary).not.toBe(k('tool_arguments_invalid'))
    expect(laneToolFailureSummary(t, notAllowed))
      .toBe(k('argumentsWithField', { issue: k('issueNotAllowed', { field: 'shots.0.kind', values: values(['image', 'video']) }) }))
  })

  it('展开体：码的那句 + 每个字段一行；同一份合法值不印两遍', () => {
    expect(laneToolFailureDetail(t, notAllowed).split('\n')).toEqual([
      k('tool_arguments_invalid'),
      k('issueNotAllowed', { field: 'shots.0.kind', values: values(['image', 'video']) }),
    ])
    expect(laneToolFailureDetail(t, {
      code: 'tool_arguments_invalid',
      issues: [
        { path: 'shots', kind: 'wrong_type', expected: 'array' },
        { path: 'prompt', kind: 'missing' },
        { path: 'durationSec', kind: 'out_of_range', min: 4, max: 15 },
        { path: '(root)', kind: 'too_few', min: 1 },
      ],
    }).split('\n')).toEqual([
      k('tool_arguments_invalid'),
      k('issueWrongType', { field: 'shots', expected: k('typeArray') }),
      k('issueMissing', { field: 'prompt' }),
      k('issueRange', { field: 'durationSec', min: 4, max: 15 }),
      k('issueTooFew', { field: k('issueRoot'), min: 1 }),
    ])
  })

  it('2026-11-07 之前的信封（只有 expected / receivedType）照样说得出该填什么', () => {
    expect(laneToolFailureSummary(t, { code: 'tool_arguments_invalid', issues: [{ path: 'nodes', expected: 'array', receivedType: 'string' }] }))
      .toBe(k('argumentsWithField', { issue: k('issueWrongType', { field: 'nodes', expected: k('typeArray') }) }))
  })

  it('准入层拒收（模型不接受这组参数）也按字段说；没有字段时说码的那句', () => {
    expect(laneToolFailureSummary(t, { code: 'generation_input_invalid', issues: [{ path: 'aspectRatio', kind: 'not_allowed', allowed: ['16:9', '9:16'] }] }))
      .toBe(k('argumentsWithField', { issue: k('issueNotAllowed', { field: 'aspectRatio', values: values(['16:9', '9:16']) }) }))
    expect(laneToolFailureSummary(t, { code: 'generation_input_invalid' })).toBe(k('generation_input_invalid'))
  })

  it('熔断拦下有自己的那句', () => {
    expect(laneToolFailureSummary(t, { code: 'tool_retry_stopped' })).toBe(k('tool_retry_stopped'))
  })

  it('没有本地词条的码：一句人话，码不出现在界面上', () => {
    const text = laneToolFailureSummary(t, { code: 'generation_pricing_unknown' })
    expect(text).toBe(k('unknown'))
    expect(text).not.toContain('generation_pricing_unknown')
    expect(k('unknown')).not.toMatch(/\{\{code\}\}/)
  })
})
