import { describe, expect, it } from 'vitest'
import { formatMissing, resolveModelAdapterDetailState } from './modelAdapterDetailState'

// D-1117-delete-verification：模型详情的状态区标题永远是五个状态词之一，和列表那一行同一个投影；
// 「接下来做什么」只看缺不缺请求格式（可用性主人的结论），不再看验证记录。
const base = {
  formatInProgress: false,
  capabilityKnown: true,
  hasTask: false,
  canAutoAdapt: true,
  canUseScript: true,
}
const missingFormat = { usable: false, reason: 'model_unpublished' } as const

describe('model adapter detail state', () => {
  it('does not call a media model ready while its input contract is unknown', () => {
    expect(resolveModelAdapterDetailState({ ...base, availability: missingFormat, capabilityKnown: false })).toMatchObject({
      tone: 'warning',
      state: 'needsCapability',
      status: { state: 'needsSetup' },
      primaryAction: 'editCapability',
      secondaryAction: 'autoConfigure',
    })
  })

  it('a usable model says 可使用 and offers nothing to do — no verified / untested split', () => {
    expect(resolveModelAdapterDetailState({ ...base, availability: { usable: true } })).toEqual({
      tone: 'success',
      state: 'status',
      status: { state: 'ready', tone: 'success', labelKey: 'onboardingProviders.modelStatus.ready' },
      primaryAction: 'none',
      secondaryAction: 'none',
    })
  })

  it('keeps slow automatic adaptation secondary when a request script is available', () => {
    expect(resolveModelAdapterDetailState({ ...base, availability: missingFormat })).toMatchObject({
      tone: 'warning',
      state: 'needsTransport',
      primaryAction: 'writeScript',
      secondaryAction: 'autoConfigure',
    })
  })

  it('reopens active work instead of starting a duplicate run', () => {
    expect(resolveModelAdapterDetailState({ ...base, availability: missingFormat, formatInProgress: true, hasTask: true, capabilityKnown: false }))
      .toMatchObject({ tone: 'active', state: 'adapting', status: { state: 'configuring' }, primaryAction: 'openTask', secondaryAction: 'none' })
  })

  it('opens a finished task to its real error instead of blindly retrying', () => {
    expect(resolveModelAdapterDetailState({ ...base, availability: missingFormat, hasTask: true }))
      .toMatchObject({ tone: 'warning', state: 'needsTransport', primaryAction: 'openTask', secondaryAction: 'none' })
  })

  it('a finished task on a model that is usable now leaves nothing to do', () => {
    expect(resolveModelAdapterDetailState({ ...base, availability: { usable: true }, hasTask: true }))
      .toMatchObject({ state: 'status', primaryAction: 'none' })
  })

  it('does not claim a saved script is enough when declared inputs are still incomplete', () => {
    expect(resolveModelAdapterDetailState({ ...base, availability: { usable: false, reason: 'capability_incomplete', missingFields: ['modes'] } as never, hasTask: true }))
      .toMatchObject({ state: 'needsCapability', primaryAction: 'editCapability' })
  })

  it('falls through to a manual request script when no automatic route exists', () => {
    expect(resolveModelAdapterDetailState({ ...base, availability: missingFormat, canAutoAdapt: false }).primaryAction).toBe('writeScript')
  })

  it.each([
    ['disabled', { usable: false, reason: 'model_disabled' }, 'disabled'],
    ['no key', { usable: false, reason: 'credential_missing' }, 'notConnected'],
    ['key locked', { usable: false, reason: 'credential_locked' }, 'needsSetup'],
  ] as const)('%s with a complete request format only reports the status', (_name, availability, state) => {
    expect(resolveModelAdapterDetailState({ ...base, availability })).toMatchObject({ state: 'status', status: { state }, primaryAction: 'none' })
  })
})

describe('formatMissing', () => {
  it.each([
    [undefined, true],
    [{ usable: true }, false],
    [{ usable: false, reason: 'model_unpublished' }, true],
    [{ usable: false, reason: 'capability_incomplete', missingFields: ['modes'] }, true],
    [{ usable: false, reason: 'model_disabled' }, false],
    [{ usable: false, reason: 'credential_missing' }, false],
  ] as const)('%j → %s', (availability, expected) => {
    expect(formatMissing(availability as never)).toBe(expected)
  })
})
