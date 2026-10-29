import { describe, expect, it } from 'vitest'
import { enOnboardingProviders, zhOnboardingProviders } from '../../i18n/locales/onboardingProviders'

describe('onboarding self-check copy keeps generation evidence separate', () => {
  it.each([
    ['zh', zhOnboardingProviders],
    ['en', enOnboardingProviders],
  ])('%s says self-check passed but not tried yet', (_locale, copy) => {
    const workspace = copy.workspace
    const verification = copy.adapterVerification
    const adapter = workspace.adapter
    const states = [
      adapter.title.readyVerified,
      adapter.body.readyVerified,
      adapter.title.verified,
      adapter.body.verified,
      verification.modelState.verified,
      verification.cardStatus.verified,
      verification.addedAllPassed,
    ].join(' ')
    expect(states).not.toMatch(/已验证|已测试|真实测试|verified|tested|real test/i)
    expect(verification.addedAllPassed).toMatch(/自检|self-check/i)
    expect(adapter.title.readyVerified).toMatch(/试跑|tried/i)
    expect(adapter.body.readyVerified).toMatch(/试跑|trial run/i)
    expect(verification.modelState.verified).toBe(verification.cardStatus.verified)
    expect(adapter.body.readyUntested).not.toMatch(/测试请求|test request/i)
  })
})
