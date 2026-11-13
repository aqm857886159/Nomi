import { aspectRatioControlsOf, placeAspectRatio } from '../aspectRatioValue'
import { clampToRange, isParamValueAllowed, numericRangeOf, type ParamRange } from './paramConstraints'
import type { ModelParameterControl } from './types'

type ParamValue = string | number | boolean

/** Legacy catalog controls supply their existing storage codec's output. */
type StoredParamControl = { key: string; storedDefaults: Record<string, unknown> }

export type ModelParamsPolicy =
  | { author: '人手'; invalid: '全重置默认'; removeKeys?: readonly string[] }
  | { author: '人手'; invalid: '只修下拉不管数值' }
  | { author: 'Agent'; invalid: '静默丢换默认' }
  | { author: '发送复查'; invalid: '钳+说明'; durationRange: ParamRange | null }
  | { author: 'Agent'; invalid: '拟镜范围'; durationRange: ParamRange }

export const DETERMINISTIC_PLANNER_PARAMS_POLICY = {
  author: 'Agent', invalid: '拟镜范围', durationRange: { min: 4, max: 15 },
} as const

export type ModelParamChange = {
  key: string
  from: unknown
  to: unknown
  reason: 'reset' | 'param.unknown' | 'param.value' | 'param.clamped' | 'duration.clamped'
  details: Record<string, string | number>
}

/** One pure owner for the existing write policies. Step 1 deliberately preserves their differences. */
export function resolveModelParams({ controls, intent, previousParams, policy }: {
  controls: readonly (ModelParameterControl | StoredParamControl)[]
  intent: { duration?: number; aspect?: string; kind?: string }
  previousParams: Record<string, unknown>
  policy: ModelParamsPolicy
}): { params: Record<string, unknown>; changes: ModelParamChange[] } {
  const changes: ModelParamChange[] = []
  // Human policies return full meta, whose non-parameter values remain opaque.
  let params: Record<string, unknown> = {}
  const change = (key: string, from: unknown, to: unknown, reason: ModelParamChange['reason'], details: ModelParamChange['details'] = {}) => {
    changes.push({ key, from, to, reason, details })
  }
  if (policy.invalid === '全重置默认') {
    const remove = new Set(policy.removeKeys)
    params = Object.fromEntries(Object.entries(previousParams).filter(([key]) => !remove.has(key)))
    for (const control of controls) {
      Object.assign(params, 'type' in control
        ? control.defaultValue === undefined ? {} : { [control.key]: control.defaultValue }
        : control.storedDefaults)
    }
    for (const key of new Set([...Object.keys(previousParams), ...Object.keys(params)])) {
      if (!Object.is(previousParams[key], params[key])) change(key, previousParams[key], params[key], 'reset')
    }
  } else if (policy.invalid === '只修下拉不管数值') {
    params = previousParams
    for (const control of controls) {
      if (!('type' in control) || control.type !== 'select' || !control.options?.length || !(control.key in params)) continue
      const value = params[control.key]
      // Mode switching historically compares enum types strictly; Agent admission does not.
      if (isScalar(value) && isParamValueAllowed(control, value) && control.options.map(option => option.value).includes(value)) continue
      params = { ...params }
      if (control.defaultValue !== undefined) params[control.key] = control.defaultValue
      else delete params[control.key]
      change(control.key, value, params[control.key], 'param.value')
    }
  } else if (policy.invalid === '拟镜范围') {
    if (intent.duration !== undefined) {
      const clamped = clampToRange(intent.duration, policy.durationRange)
      params.duration = clamped.value
      if (clamped.changed) change('duration', intent.duration, clamped.value, 'duration.clamped')
    }
  } else {
    const parameterControls = controls.filter((control): control is ModelParameterControl => 'type' in control)
    if (policy.invalid === '静默丢换默认') {
      for (const control of parameterControls) {
        if (control.defaultValue !== undefined) params[control.key] = control.defaultValue
      }
      const raw = placeAspectRatio(
        intent.aspect === undefined ? previousParams : { ...previousParams, aspectRatio: intent.aspect },
        aspectRatioControlsOf(parameterControls),
      ).parameters
      for (const control of parameterControls) {
        const value = raw[control.key]
        if (value === undefined) continue
        if (isScalar(value) && isParamValueAllowed(control, value)) params[control.key] = value
        else change(control.key, value, params[control.key], 'param.value')
      }
    } else {
      for (const [key, value] of Object.entries(previousParams)) {
        const control = parameterControls.find(item => item.key === key)
        if (!control) { change(key, value, undefined, 'param.unknown', { key }); continue }
        if (!isScalar(value) || key === 'duration') continue
        if (isParamValueAllowed(control, value)) { params[key] = value; continue }
        if (!control.options.length && control.type === 'number' && typeof value === 'number') {
          const range = numericRangeOf(control)
          const min = typeof control.min === 'number' ? control.min : Number.NEGATIVE_INFINITY
          const max = typeof control.max === 'number' ? control.max : Number.POSITIVE_INFINITY
          const clamped = range ? clampToRange(value, range).value : Math.min(max, Math.max(min, value))
          params[key] = clamped
          change(key, value, clamped, 'param.clamped', { key, value, min, max, clamped })
        } else {
          if (control.defaultValue !== undefined) params[key] = control.defaultValue
          change(key, value, params[key], 'param.value', {
            key, value: String(value), allowed: control.options.length ? control.options.map(option => String(option.value)).join(' / ') : control.type,
          })
        }
      }
      if (policy.durationRange && intent.duration !== undefined) {
        const { min, max } = policy.durationRange
        const clamped = clampToRange(intent.duration, policy.durationRange)
        params.duration = clamped.value
        if (clamped.changed) change('duration', intent.duration, clamped.value, 'duration.clamped', { wanted: intent.duration, min, max, clamped: clamped.value })
      }
    }
  }
  return { params, changes }
}

function isScalar(value: unknown): value is ParamValue {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
}
