import { describe, expect, it } from 'vitest'
import { enAgentToolFailure, zhAgentToolFailure } from '../../../i18n/locales/agentToolFailure'
import { laneToolFailureOf, type LaneToolPublicFailure } from '../../../../electron/shared/agentLane/laneToolFailureEnvelope'
import { GENERATION_PROBLEM_CODE_LIST, type GenerationProblem } from '../../../../electron/shared/generationProblem'
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

// 起草被拒的闭合原因（2026-11-08，`generationProblem.ts`）。用户原话：「参数不合法什么的，没有最后有一个错误码，
// 或者说分析码以及下一步该怎么办」。修之前面板对所有起草拒收说同一句「这个模型不接受这组参数」。
describe.each(tracks)('起草被拒说原因，不说笼统那句（$name）', ({ t }) => {
  const k = (key: string, options?: Record<string, unknown>) => t(`agentToolFailure.${key}`, options)
  const rejected = (problem: Omit<GenerationProblem, 'retryable' | 'charged'>): LaneToolPublicFailure =>
    ({ code: 'generation_input_invalid', problem: { retryable: true, charged: false, ...problem } })

  it('除 parameter_not_allowed 外每个码都有自己那一句，没有一句是笼统话', () => {
    const samples: Record<GenerationProblem['code'], LaneToolPublicFailure> = {
      unknown_model: rejected({ code: 'unknown_model', field: 'candidate.modelId', nearest: 'apimart/doubao-seedream-5-0-pro', next: 'use_nearest_model' }),
      no_default_model: rejected({ code: 'no_default_model', media: 'image', next: 'set_default_model' }),
      mode_not_in_model: rejected({ code: 'mode_not_in_model', allowed: ['text_to_video', 'image_to_video'], next: 'use_allowed_value' }),
      ratio_not_in_mode: rejected({ code: 'ratio_not_in_mode', field: 'aspectRatio', allowed: ['1:1', '16:9'], next: 'use_allowed_value' }),
      duration_not_in_mode: rejected({ code: 'duration_not_in_mode', field: 'durationSec', min: 4, max: 15, next: 'use_allowed_value' }),
      reference_over_capacity: rejected({ code: 'reference_over_capacity', field: 'references', max: 4, next: 'reduce_references' }),
      reference_role_not_in_mode: rejected({ code: 'reference_role_not_in_mode', allowed: ['first_frame'], next: 'use_allowed_value' }),
      parameter_not_allowed: rejected({ code: 'parameter_not_allowed', field: 'size', next: 'fix_field' }),
    }
    expect(Object.keys(samples).sort()).toEqual([...GENERATION_PROBLEM_CODE_LIST].sort())
    const sentences = new Set<string>()
    for (const code of GENERATION_PROBLEM_CODE_LIST) {
      const summary = laneToolFailureSummary(t, samples[code])
      if (code === 'parameter_not_allowed') {
        expect(summary, '没有字段时照旧是码的那句').toBe(k('generation_input_invalid'))
        continue
      }
      expect(summary, code).not.toBe(k('generation_input_invalid'))
      expect(summary, code).not.toContain('{{')
      sentences.add(summary)
    }
    expect(sentences.size, '七个码七句不同的话').toBe(GENERATION_PROBLEM_CODE_LIST.length - 1)
  })

  it('反例 1：点名的模型不在目录里 → 「没有这个模型」；不说默认模型，也不把模型 id 摆给用户', () => {
    const failure = rejected({ code: 'unknown_model', field: 'candidate.modelId', nearest: 'apimart/doubao-seedream-5-0-pro', next: 'use_nearest_model' })
    expect(laneToolFailureSummary(t, failure)).toBe(k('problemUnknownModel'))
    expect(laneToolFailureSummary(t, failure)).not.toBe(k('problemNoDefaultImage'))
    expect(laneToolFailureDetail(t, failure)).toBe(k('problemUnknownModel'))
    expect(laneToolFailureDetail(t, failure)).not.toContain('doubao')
  })

  it('反例 2：没点名也没有能用的默认 → 说缺哪一类默认，展开体指到模型菜单', () => {
    const image = rejected({ code: 'no_default_model', field: 'candidate.modelId', media: 'image', next: 'set_default_model' })
    const video = rejected({ code: 'no_default_model', media: 'video', next: 'set_default_model' })
    expect(laneToolFailureSummary(t, image)).toBe(k('problemNoDefaultImage'))
    expect(laneToolFailureSummary(t, video)).toBe(k('problemNoDefaultVideo'))
    expect(laneToolFailureDetail(t, image).split('\n')).toEqual([k('problemNoDefaultImage'), k('problemPickDefault')])
    expect(laneToolFailureDetail(t, video).split('\n')[1]).toBe(k('problemPickDefault'))
  })

  it('反例 3：参考超量 → 说上限，不说「这个模型不接受这组参数」', () => {
    const failure: LaneToolPublicFailure = {
      ...rejected({ code: 'reference_over_capacity', field: 'references', max: 4, next: 'reduce_references' }),
      issues: [{ path: 'references', kind: 'out_of_range', max: 4 }],
    }
    expect(laneToolFailureSummary(t, failure)).toBe(k('problemReferenceOverCapacity', { max: 4 }))
    expect(laneToolFailureSummary(t, failure)).not.toBe(k('generation_input_invalid'))
    expect(laneToolFailureDetail(t, failure), '字段行说的是同一件事，不再印一遍').toBe(k('problemReferenceOverCapacity', { max: 4 }))
  })

  it('比例：有可选档时展开体列可选值，超过 4 个只列前 4 个加「等」；没有比例档时说不能选', () => {
    const many = rejected({ code: 'ratio_not_in_mode', field: 'aspectRatio', allowed: ['1:1', '4:3', '3:4', '16:9', '9:16', '21:9'], next: 'use_allowed_value' })
    const first4 = ['1:1', '4:3', '3:4', '16:9'].join(k('listSeparator'))
    expect(laneToolFailureSummary(t, many)).toBe(k('problemRatioNotOffered'))
    expect(laneToolFailureDetail(t, many).split('\n')).toEqual([k('problemRatioNotOffered'), k('allowedValues', { values: k('listMore', { values: first4 }) })])
    expect(laneToolFailureDetail(t, many)).not.toContain('9:16')
    expect(laneToolFailureSummary(t, rejected({ code: 'ratio_not_in_mode', field: 'aspectRatio', next: 'drop_field' }))).toBe(k('problemRatioNone'))
  })

  it('时长：范围、档位、不收时长三种情形各一句', () => {
    expect(laneToolFailureSummary(t, rejected({ code: 'duration_not_in_mode', min: 4, max: 15, next: 'use_allowed_value' })))
      .toBe(k('problemDurationRange', { min: 4, max: 15 }))
    expect(laneToolFailureSummary(t, rejected({ code: 'duration_not_in_mode', allowed: ['6', '10'], next: 'use_allowed_value' })))
      .toBe(k('problemDurationValues', { values: ['6', '10'].join(k('listSeparator')) }))
    expect(laneToolFailureSummary(t, rejected({ code: 'duration_not_in_mode', next: 'drop_field' }))).toBe(k('problemDurationNone'))
    expect(laneToolFailureSummary(t, rejected({ code: 'duration_not_in_mode', min: 2, next: 'use_allowed_value' }))).toBe(k('problemDurationAtLeast', { min: 2 }))
    expect(laneToolFailureSummary(t, rejected({ code: 'duration_not_in_mode', max: 8, next: 'use_allowed_value' }))).toBe(k('problemDurationAtMost', { max: 8 }))
  })

  it('parameter_not_allowed 带字段：照旧「参数没填对：哪个字段 · 该填什么」', () => {
    const failure: LaneToolPublicFailure = {
      ...rejected({ code: 'parameter_not_allowed', field: 'parameters.size', next: 'fix_field' }),
      issues: [{ path: 'parameters.size', kind: 'not_allowed', allowed: ['1K', '2K'] }],
    }
    expect(laneToolFailureSummary(t, failure))
      .toBe(k('argumentsWithField', { issue: k('issueNotAllowed', { field: 'parameters.size', values: ['1K', '2K'].join(k('listSeparator')) }) }))
  })

  // 老用户：0.24.1 的写入口（`laneTools.mts` 的 rememberToolFailure）只写 code / allowed / issues / useInstead，
  // issue 只有 path / expected / receivedType。读回来的信封里不会凭空长出 problem，面板和今天 main 一字不差。
  it('0.24.1 写下的老信封：没有 problem，摘要与展开体照旧', () => {
    const bare = laneToolFailureOf({ failure: { code: 'generation_input_invalid' } })!
    const withIssue = laneToolFailureOf({ failure: { code: 'generation_input_invalid', issues: [{ path: 'durationSec', expected: 'number', receivedType: 'string' }] } })!
    expect(bare.problem).toBeUndefined()
    expect(withIssue.problem).toBeUndefined()
    expect(laneToolFailureSummary(t, bare)).toBe(k('generation_input_invalid'))
    expect(laneToolFailureDetail(t, bare)).toBe(k('generation_input_invalid'))
    const issue = k('issueWrongType', { field: 'durationSec', expected: k('typeNumber') })
    expect(laneToolFailureSummary(t, withIssue)).toBe(k('argumentsWithField', { issue }))
    expect(laneToolFailureDetail(t, withIssue).split('\n')).toEqual([k('generation_input_invalid'), issue])
  })

  it('信封里的 problem 形状不对（别的版本 / 被改坏）就当没有，退回老说法', () => {
    const forged = laneToolFailureOf({ failure: { code: 'generation_input_invalid', problem: { code: 'made_up_reason' } } })!
    expect(forged.problem).toBeUndefined()
    expect(laneToolFailureSummary(t, forged)).toBe(k('generation_input_invalid'))
  })
})
