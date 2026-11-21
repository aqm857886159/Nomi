import { existsSync, readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../i18n'
import { enRuntime, zhRuntime } from '../../i18n/locales/runtime'
import { encodePromptExtractionSubject } from '../../../electron/shared/contracts/browserPromptExtraction'
import { UNCERTAIN_PRIOR_TRIAL_SPEND_INTENT } from '../../../electron/shared/contracts/modelTrialSpend'
import { useSpendConfirmStore } from '../generationCanvas/spend/spendConfirm'
import { handleCapabilityApply } from './capabilityApplyHandler'
import { dedicatedSpendCardFor } from './spendCardByIntent'

// 付费确认卡按 intent 分流（2026-10-27，docs/plan/2026-10-27-browser-extract-grant.md §3.4）：
// · 凭据验证（credential-probe）那张卡随 D-1117-delete-verification 删了：保存 key 不再发验证请求，表里没有这一格；
// · 浏览器「提取提示词」（prompt-extraction）走 promptExtractionSpendCard.ts：写清来源页、哪张图、哪个读图模型；
// · 分流是查表（spendCardByIntent.ts），热点文件 capabilityApplyHandler.ts 不再按 intent 长分支（最后一格钉住）。
// 第二格修前钉的是「提取落进通用卡：AI 助手想生成一个素材、挂在新节点上」，提取专用卡落地时翻成现在这样。
// 文案一律按词典键取值，不抄字面（check:test-copy-literals）。

const t = (key: string, values?: Record<string, string>) => i18n.t(`runtime.capability.${key}`, values)

beforeEach(() => { vi.restoreAllMocks() })

describe('付费确认卡按 intent 分流', () => {
  it('凭据验证的专用卡已删：表里没有 credential-probe 这一格，卡模块和词条也不在了', () => {
    expect(dedicatedSpendCardFor('credential-probe')).toBeUndefined()
    expect(existsSync(new URL('./credentialProbeSpendCard.ts', import.meta.url))).toBe(false)
    expect(zhRuntime.capability).not.toHaveProperty('credentialProbeTitle')
    expect(enRuntime.capability).not.toHaveProperty('confirmCredentialProbe')
  })

  it('浏览器提取：走自己的卡（用户发起），写清来源页、哪张图、哪个读图模型；没有节点行、没有产物行', async () => {
    const confirm = vi.spyOn(useSpendConfirmStore.getState(), 'requestConfirm').mockResolvedValue(false)
    await expect(handleCapabilityApply('spend.confirm', {
      intent: 'prompt-extraction', vendor: 'relay', modelKey: 'mystery-vl', callCount: 1,
      nodeId: 'browser-prompt-extraction-1',
      prompt: encodePromptExtractionSubject({ page: 'evil.example', image: 'harbor.jpg' }),
      legs: [{ role: 'vision', vendor: 'relay', modelKey: 'mystery-vl' }],
    })).resolves.toEqual({ confirmed: false })
    expect(confirm).toHaveBeenCalledTimes(1)
    const card = confirm.mock.calls[0][0]
    expect(card).toMatchObject({
      kind: 'generation',
      source: 'user',
      title: t('promptExtractionTitle'),
      message: t('promptExtractionMessage'),
      confirmLabel: t('confirmPromptExtraction'),
    })
    expect(card.details).toEqual([
      { label: t('promptExtractionPage'), value: 'evil.example' },
      { label: t('promptExtractionImage'), value: 'harbor.jpg' },
      { label: t('visionModelLine'), value: 'relay · mystery-vl' },
    ])
  })

  it('浏览器提取（截图）：「图片」那一行写页面截图', async () => {
    const confirm = vi.spyOn(useSpendConfirmStore.getState(), 'requestConfirm').mockResolvedValue(true)
    await expect(handleCapabilityApply('spend.confirm', {
      intent: 'prompt-extraction', vendor: 'relay', modelKey: 'mystery-vl',
      prompt: encodePromptExtractionSubject({ page: 'example.com', image: '' }),
    })).resolves.toEqual({ confirmed: true })
    expect(confirm.mock.calls[0][0].details).toContainEqual({ label: t('promptExtractionImage'), value: t('promptExtractionScreenshot') })
  })

  it('浏览器提取：说不清读哪张图（subject 解不开）就不问人，按没确认处理', async () => {
    const confirm = vi.spyOn(useSpendConfirmStore.getState(), 'requestConfirm').mockResolvedValue(true)
    await expect(handleCapabilityApply('spend.confirm', {
      intent: 'prompt-extraction', vendor: 'relay', modelKey: 'mystery-vl', prompt: 'a quiet harbor',
    })).resolves.toEqual({ confirmed: false })
    expect(confirm).not.toHaveBeenCalled()
  })

  it.each([
    { locale: 'zh-CN', dictionary: zhRuntime },
    { locale: 'en', dictionary: enRuntime },
  ])('试跑开新单而上一笔结果不确定（$locale）：同一张卡，message 明说可能多扣一次，不印节点行', async ({ locale, dictionary }) => {
    await i18n.changeLanguage(locale)
    try {
      const confirm = vi.spyOn(useSpendConfirmStore.getState(), 'requestConfirm').mockResolvedValue(true)
      await expect(handleCapabilityApply('spend.confirm', {
        intent: UNCERTAIN_PRIOR_TRIAL_SPEND_INTENT, vendor: 'relay', modelKey: 'mystery-paint', callCount: 1,
      })).resolves.toEqual({ confirmed: true })
      expect(confirm).toHaveBeenCalledTimes(1)
      const card = confirm.mock.calls[0][0]
      expect(card).toMatchObject({
        kind: 'generation',
        source: 'agent',
        title: dictionary.capability.spendTitle.replace('{{intent}}', dictionary.capability.intent.fallback),
        message: dictionary.modelTrial.uncertainPrior,
        confirmLabel: dictionary.capability.confirmGenerate,
      })
      expect(card.details).toEqual([{ label: dictionary.capability.model, value: 'relay · mystery-paint' }])
    } finally {
      await i18n.changeLanguage('zh-CN')
    }
  })

  it('试跑开新单的卡取消了就是没确认', async () => {
    vi.spyOn(useSpendConfirmStore.getState(), 'requestConfirm').mockResolvedValue(false)
    await expect(handleCapabilityApply('spend.confirm', {
      intent: UNCERTAIN_PRIOR_TRIAL_SPEND_INTENT, vendor: 'relay', modelKey: 'mystery-paint',
    })).resolves.toEqual({ confirmed: false })
  })

  it('热点文件不再按 intent 长分支：只剩拆解那一处比较，专用卡只经查表进来', () => {
    const source = readFileSync(new URL('./capabilityApplyHandler.ts', import.meta.url), 'utf8')
    expect(source.match(/intent\s*===\s*['"][^'"]+['"]/g)).toEqual(['intent === \'deconstruct\''])
    expect(source).not.toMatch(/import\s*\{[^}]*\bconfirm\w*Spend\b[^}]*\}\s*from/)
    expect(source).toMatch(/dedicatedSpendCardFor\(info\.intent\)/)
  })
})
