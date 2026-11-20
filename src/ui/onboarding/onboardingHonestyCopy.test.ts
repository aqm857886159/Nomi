import { describe, expect, it } from 'vitest'
import { enOnboardingProviders, zhOnboardingProviders } from '../../i18n/locales/onboardingProviders'

// D-1117-delete-verification：格式任务零网络，只看说明卡形状。它的结论只能说「请求格式就绪 / 还缺」，
// 不许冒充「验过 / 测过 / 真实调用成功」——那是第一次真实生成才知道的事。
describe('format-run copy says format readiness, never verification or generation evidence', () => {
  it.each([
    ['zh', zhOnboardingProviders],
    ['en', enOnboardingProviders],
  ])('%s', (_locale, copy) => {
    const verification = copy.adapterVerification
    const { count, ...statusWords } = copy.modelStatus
    const claims = [
      ...Object.values(statusWords),
      ...Object.values(count),
      copy.workspace.adapter.body.ready,
      verification.modelState.verified,
      verification.addedAllPassed,
      verification.stage.completed,
    ].join(' ')
    expect(claims).not.toMatch(/已验证|已测试|真实测试|自检|实际调用|verified|tested|real test|self-check|actual request/i)
    expect(verification.modelState.verified).toMatch(/请求格式|request format/i)
    expect(verification.modelState.failed).toBe(verification.failedBadge)
    expect(copy.modelStatus.ready).toMatch(/^(可使用|Ready to use)$/)
  })
})
