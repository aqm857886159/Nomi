import { describe, expect, it } from 'vitest'
import { resolveModelParams, DETERMINISTIC_PLANNER_PARAMS_POLICY } from './resolveModelParams'
import type { ModelParameterControl } from './types'

const controls: ModelParameterControl[] = [
  { key: 'duration', label: 'Duration', type: 'number', min: 4, max: 15, defaultValue: 6, options: [] },
  { key: 'quality', label: 'Quality', type: 'select', defaultValue: '720p', options: [{ value: '720p', label: '720p' }] },
  { key: 'steps', label: 'Steps', type: 'select', defaultValue: 5, options: [{ value: 5, label: '5' }] },
  { key: 'sound', label: 'Sound', type: 'boolean', defaultValue: false, options: [] },
  { key: 'optional', label: 'Optional', type: 'select', options: [{ value: 'yes', label: 'yes' }] },
]
const human = { author: '人手', invalid: '只修下拉不管数值' } as const
const agent = { author: 'Agent', invalid: '静默丢换默认' } as const
const review = { author: '发送复查', invalid: '钳+说明', durationRange: { min: 4, max: 15 } } as const

describe('resolveModelParams / existing policies', () => {
  it('keeps strict mode enums, untouched numeric values, absent keys and unrelated meta', () => {
    const previousParams = { duration: 20, steps: '5', optional: 'bad', keep: 1 }
    const result = resolveModelParams({ controls, intent: {}, previousParams, policy: human })
    expect(result.params).toEqual({ duration: 20, steps: 5, keep: 1 })
    // 存的 '5' 经值门就是档位 5：同一个值换成内部类型，不算「被改成默认」。
    expect(result.changes.map(change => change.key)).toEqual(['optional'])
    expect(previousParams).toEqual({ duration: 20, steps: '5', optional: 'bad', keep: 1 })
    const valid = { steps: 5 }
    expect(resolveModelParams({ controls, intent: {}, previousParams: valid, policy: human }).params).toBe(valid)
  })

  it('a stored "8" on a numeric 5/8 select is the 8 the creator picked, not a reset to the default 5', () => {
    // 修前：严格 includes 判 "8" 不在 [5, 8] 里 → 换成默认 5（行上显示 8、发出 5 的那一类）。"8s" 门不认，照旧按政策换默认。
    const duration: ModelParameterControl = { key: 'duration', label: 'Duration', type: 'select', defaultValue: 5, options: [{ value: 5, label: '5' }, { value: 8, label: '8' }] }
    expect(resolveModelParams({ controls: [duration], intent: {}, previousParams: { duration: '8' }, policy: human }))
      .toEqual({ params: { duration: 8 }, changes: [] })
    expect(resolveModelParams({ controls: [duration], intent: {}, previousParams: { duration: '8s' }, policy: human }).params).toEqual({ duration: 5 })
  })

  it('mixed selects from user catalogs keep a value whose number matches an option (Agent and send-review policies)', () => {
    // 主分支按字符串形比，这两条政策下 "5" 和档位 5 算同一档、留着；门里改严格比较后由值门把它落到那一档，不掉成默认。
    const mixed: ModelParameterControl = { key: 'steps', label: 'Steps', type: 'select', defaultValue: 'auto', options: [{ value: 5, label: '5' }, { value: 'auto', label: 'auto' }, { value: 10, label: '10' }] }
    const textFirst: ModelParameterControl = { key: 'frames', label: 'Frames', type: 'select', defaultValue: 'auto', options: [{ value: 'auto', label: 'auto' }, { value: '5', label: '5' }] }
    for (const policy of [agent, review]) {
      const result = resolveModelParams({ controls: [mixed, textFirst], intent: {}, previousParams: { steps: '5', frames: 5 }, policy })
      expect(result.params).toMatchObject({ steps: 5, frames: '5' })
      expect(result.changes.filter(change => change.reason === 'param.value')).toEqual([])
    }
  })

  it('drops invalid agent values, admits numeric strings as the declared number, fills defaults and ignores unknown keys', () => {
    const result = resolveModelParams({ controls, intent: {}, previousParams: { duration: 3, steps: '5', quality: null, sound: 'yes', unknown: 1 }, policy: agent })
    expect(result.params).toEqual({ duration: 6, quality: '720p', steps: 5, sound: false })
    expect(result.changes.filter(change => change.reason === 'param.value').map(change => change.key)).toEqual(['duration', 'quality', 'sound'])
  })

  it('resets only previous stored keys, fills target defaults, and preserves unrelated meta', () => {
    expect(resolveModelParams({ controls, intent: {}, previousParams: { duration: 20, quality: 'bad', old: 1, keep: 2 }, policy: { author: '人手', invalid: '全重置默认', removeKeys: ['duration', 'quality', 'old'] } }).params)
      .toEqual({ keep: 2, duration: 6, quality: '720p', steps: 5, sound: false })
  })

  it('keeps encoded legacy defaults opaque, including their stored aliases', () => {
    const storedDefaults = { durationSeconds: 5, videoDuration: 5 }
    expect(resolveModelParams({ controls: [{ key: 'length', storedDefaults }], intent: {}, previousParams: { keep: 1 }, policy: { author: '人手', invalid: '全重置默认' } }).params)
      .toEqual({ keep: 1, durationSeconds: 5, videoDuration: 5 })
    expect(storedDefaults).toEqual({ durationSeconds: 5, videoDuration: 5 })
  })

  it('review preserves issue ordering, scalar gates, unknown keys and duration override', () => {
    const result = resolveModelParams({ controls, intent: { duration: 3 }, previousParams: { unknown: 1, quality: '4k', duration: 99, sound: 'bad', optional: null }, policy: review })
    expect(result.params).toEqual({ quality: '720p', sound: false, duration: 4 })
    expect(result.changes.map(change => change.reason)).toEqual(['param.unknown', 'param.value', 'param.value', 'duration.clamped'])
    expect(result.changes[0]?.details).toEqual({ key: 'unknown' })
  })

  it.each([Number.NaN, Number.POSITIVE_INFINITY, 3, 20, 7.5])('uses existing range semantics for %s', duration => {
    const result = resolveModelParams({ controls, intent: { duration }, previousParams: { duration }, policy: review })
    expect(result.params.duration).toBe(Number.isFinite(duration) ? Math.min(15, Math.max(4, Math.round(duration))) : 4)
  })

  it('keeps review nearest-enum ties and one-sided numeric range behavior', () => {
    const numberControls: ModelParameterControl[] = [
      { key: 'steps', label: 'Steps', type: 'number', options: [{ value: 4, label: '4' }, { value: 8, label: '8' }], defaultValue: 4 },
      { key: 'count', label: 'Count', type: 'number', options: [], min: 2 },
    ]
    const result = resolveModelParams({ controls: numberControls, intent: { duration: 6 }, previousParams: { steps: 6, count: 1 }, policy: { ...review, durationRange: { min: 4, max: 8, enum: [4, 8] } } })
    expect(result.params).toEqual({ steps: 4, count: 2, duration: 4 })
  })

  it('places semantic aspect through aspectRatioValue before agent validation', () => {
    const ratio: ModelParameterControl = { key: 'size', label: 'Aspect', type: 'select', options: [{ value: '16:9', label: '16:9' }, { value: '9:16', label: '9:16' }], defaultValue: '16:9' }
    expect(resolveModelParams({ controls: [ratio], intent: { aspect: '9:16' }, previousParams: {}, policy: agent }).params).toEqual({ size: '9:16' })
  })

  it('keeps deterministic planner range at the existing 4–15 seconds', () => {
    expect(DETERMINISTIC_PLANNER_PARAMS_POLICY.durationRange).toEqual({ min: 4, max: 15 })
    expect(resolveModelParams({ controls: [], intent: { duration: 20 }, previousParams: {}, policy: DETERMINISTIC_PLANNER_PARAMS_POLICY }).params).toEqual({ duration: 15 })
  })
})
