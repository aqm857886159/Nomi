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

// D-1117-delete-verification（用户 2026-11-17 拍板，协调 2026-11-18 Q6–Q9）：验证整段删了，状态词只剩
// 可使用 / 配置中 / 待设置 / 已关闭 / 待接入。这两个命名空间里任何一句都不许再说验证状态、验证按钮或「未试跑」，
// 白名单为零。范围外的验证 / 试跑（ComfyUI 候选工作流试跑、即梦会员资格、调用脚本试跑、外部助手认证会话）
// 用的是别的词（「试跑成功」「真实验证」「验证码」），不在下面的词表里——要扫到它们，得先有人拍板把它们也删。
const RETIRED_VERIFICATION_WORDS = {
  // 「未通过」只禁独立成词的那枚旧徽标；拉列表的「未通过鉴权」是拉列表自己的报错，留着。
  zh: /未验证|尚未验证|验证没通过|仍可使用|^未通过$|未通过自检|没通过自检|自检未通过|自检通过|未试跑|继续验证|重新验证|保存验证|停止验证|验证中|验证完成|验证已停止|验证超时|复验|家连不上/,
  // 「unreachable」只禁旧的「N 家连不上」那种连接状态；网络代理那几句说的是海外地址，不是模型连接。
  en: /not (yet )?verified|unverified|verification (failed|complete|stopped|timed out)|still usable|self-check (passed|failed)|checks? (passed|failed)|not tried yet|not generation-tested|untried|continue verification|verify again|save verify|stop verification|\bverifying\b|re-?check(ed)? passed|\{\{count\}\} unreachable/i,
} as const

describe('the retired verification status words stay deleted (zero allowlist)', () => {
  it.each([
    ['zh onboardingProviders', zhOnboardingProviders, RETIRED_VERIFICATION_WORDS.zh],
    ['en onboardingProviders', enOnboardingProviders, RETIRED_VERIFICATION_WORDS.en],
    ['zh modelSetup', zhModelSetup, RETIRED_VERIFICATION_WORDS.zh],
    ['en modelSetup', enModelSetup, RETIRED_VERIFICATION_WORDS.en],
  ] as const)('%s', (_name, copy, pattern) => {
    expect(strings(copy, '', []).filter(([, text]) => pattern.test(text))).toEqual([])
  })

  it('the retired keys themselves are gone, not just reworded', () => {
    for (const copy of [zhOnboardingProviders, enOnboardingProviders]) {
      expect(copy.vendorCard).not.toHaveProperty('modelsAvailable')
      expect(copy.drawer.home).not.toHaveProperty('verificationFailedUsable')
      expect(copy.drawer.home).not.toHaveProperty('verificationFailedUsableHint')
      expect(copy.drawer.home).not.toHaveProperty('unreachableCount')
      expect(copy.adapterVerification).not.toHaveProperty('cardStatus')
      expect(copy.workspace.adapter).not.toHaveProperty('title')
      for (const key of ['offlineTitle', 'recheckedTitle', 'continueVerification', 'pendingTitle', 'probeRequest']) {
        expect(copy.keyOnly).not.toHaveProperty(key)
      }
    }
    for (const copy of [zhModelSetup, enModelSetup]) {
      for (const key of ['testConnection', 'testAndSaveHint', 'diagnostics', 'connected', 'connectionFailed']) {
        expect(copy).not.toHaveProperty(key)
      }
    }
  })
})
