import { describe, expect, it } from 'vitest'
import { enRuntime, zhRuntime } from './runtime'
import { enOnboardingProviders, zhOnboardingProviders } from './onboardingProviders'
import { enAgentPanelV4, zhAgentPanelV4 } from './agentPanelV4'

describe('decision copy keeps acknowledgement separate from confirmation', () => {
  it.each([
    ['zh-CN', zhRuntime, zhOnboardingProviders, zhAgentPanelV4],
    ['en', enRuntime, enOnboardingProviders, enAgentPanelV4],
  ])('%s uses acknowledgement copy for notices and concrete actions elsewhere', (_locale, runtime, onboarding, agent) => {
    expect(runtime.design.gotIt).toBe(_locale === 'en' ? 'Got it' : '知道了')
    expect(runtime.design.confirm).toBe(_locale === 'en' ? 'Confirm' : '确认')
    expect(onboarding.comfyLocal.saveAddress).toBe(_locale === 'en' ? 'Save address' : '保存地址')
    expect(agent.consent.accept).toBe(_locale === 'en' ? 'I’m in' : '愿意')
  })
})
