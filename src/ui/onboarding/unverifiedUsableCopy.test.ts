import { describe, expect, it } from 'vitest'
import { enOnboardingProviders, zhOnboardingProviders } from '../../i18n/locales/onboardingProviders'
import { enModelSetup, zhModelSetup } from '../../i18n/locales/modelSetup'

// 用户 2026-11-13：没验证的 key 也能用，验证只作提醒（docs/plan/2026-11-17-unverified-usable.md）。
// 模型设置和接入流程里，任何一句都不许再说「验证（通过）后才能选 / 才能用」。
const GATED_ON_VERIFICATION = [
  /(验证|复验|检查|自检)(通过|成功|完成)?(之)?后[^。；，]{0,6}(才|再)/,
  /(通过|完成)(验证|复验|自检)(之)?后[^。；，]{0,6}(才|再|就能|即可)/,
  /(验证|复验)(通过|成功)(才|方可)/,
  /(未|没)(验证|复验)[^。；]{0,8}(不能|不可|无法)(选|用|使用)/,
  /只有[^。；]{0,10}(验证|通过)/,
  /(验证|认证)?通过的[^。；]{0,6}(才|会)[^。；]{0,8}(出现|变为可用|可用|可选)/,
  /\b(only\s+)?(verified|passing|certified)\s+(models?|modes?)\s+(will\s+)?(appear|become|are\s+(available|selectable|usable))/i,
  /\b(after|once|until)\s+(?:it\s+is\s+|it's\s+|being\s+|successful\s+|a\s+successful\s+)?verif[a-z]*\b[^.;]{0,40}\b(can|select|use|usable|available|appear)/i,
  /\b(use|used|select|selected|usable|available|appear)\b[^.;]{0,20}\b(only\s+)?(after|once|until)\s+(?:it\s+is\s+|it's\s+|being\s+|successful\s+|a\s+successful\s+)?verif/i,
  /\bverify\b[^.;]{0,20}\bbefore\s+(you\s+can\s+)?(use|select)/i,
]

function strings(value: unknown, at: string, out: Array<[string, string]>): Array<[string, string]> {
  if (typeof value === 'string') out.push([at, value])
  else if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) strings(child, `${at}.${key}`, out)
  return out
}

describe('model setup copy never makes verification a gate for use', () => {
  it.each([
    ['zh onboardingProviders', zhOnboardingProviders],
    ['en onboardingProviders', enOnboardingProviders],
    ['zh modelSetup', zhModelSetup],
    ['en modelSetup', enModelSetup],
  ])('%s', (_name, copy) => {
    const offending = strings(copy, '', []).filter(([, text]) => GATED_ON_VERIFICATION.some((pattern) => pattern.test(text)))
    expect(offending).toEqual([])
  })
})

// 协调 2026-11-17：「没验成但能用」只有一个词「未验证」；旧的「验证没通过，仍可使用」「未通过」徽标词条整条删掉，不留并行。
describe('the retired "verification failed" status words stay deleted', () => {
  it.each([
    ['zh', zhOnboardingProviders, /验证没通过|仍可使用/],
    ['en', enOnboardingProviders, /verification failed|still usable/i],
  ] as const)('%s', (_name, copy, pattern) => {
    expect(strings(copy, '', []).filter(([, text]) => pattern.test(text))).toEqual([])
    expect(copy.drawer.home).not.toHaveProperty('verificationFailedUsable')
    expect(copy.adapterVerification.cardStatus).not.toHaveProperty('failed')
  })
})
