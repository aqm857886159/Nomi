import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../i18n'
import { encodePromptExtractionSubject } from '../../../electron/shared/contracts/browserPromptExtraction'
import { useSpendConfirmStore } from '../generationCanvas/spend/spendConfirm'
import { handleCapabilityApply } from './capabilityApplyHandler'

// 付费确认卡按 intent 分流（2026-10-27，docs/plan/2026-10-27-browser-extract-grant.md §3.4）：
// · 凭据验证（credential-probe）走自己的卡模块 credentialProbeSpendCard.ts：用户自己点的、不挂节点；
// · 浏览器「提取提示词」（prompt-extraction）走 promptExtractionSpendCard.ts：写清来源页、哪张图、哪个读图模型；
// · 分流是查表（spendCardByIntent.ts），热点文件 capabilityApplyHandler.ts 不再按 intent 长分支（最后一格钉住）。
// 第一格写于改分流之前（特征测试），改成查表之后一字未改仍绿 = 凭据验证的行为没变。
// 第二格修前钉的是「提取落进通用卡：AI 助手想生成一个素材、挂在新节点上」，提取专用卡落地时翻成现在这样。
// 文案一律按词典键取值，不抄字面（check:test-copy-literals）。

const t = (key: string, values?: Record<string, string>) => i18n.t(`runtime.capability.${key}`, values)

beforeEach(() => { vi.restoreAllMocks() })

describe('付费确认卡按 intent 分流', () => {
  it('凭据验证：走自己的卡（用户发起、一行模型一行次数），不印节点行', async () => {
    const confirm = vi.spyOn(useSpendConfirmStore.getState(), 'requestConfirm').mockResolvedValue(true)
    await expect(handleCapabilityApply('spend.confirm', {
      intent: 'credential-probe', vendor: 'apimart', modelKey: 'gpt-image-2', callCount: 1,
    })).resolves.toEqual({ confirmed: true })
    expect(confirm).toHaveBeenCalledTimes(1)
    const card = confirm.mock.calls[0][0]
    expect(card).toMatchObject({
      kind: 'generation',
      source: 'user',
      title: t('credentialProbeTitle', { vendor: 'apimart' }),
      confirmLabel: t('confirmCredentialProbe'),
    })
    expect(card.details).toEqual([
      { label: t('model'), value: 'apimart · gpt-image-2' },
      { label: t('callCount'), value: '1' },
    ])
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

  it('热点文件不再按 intent 长分支：只剩拆解那一处比较，专用卡只经查表进来', () => {
    const source = readFileSync(new URL('./capabilityApplyHandler.ts', import.meta.url), 'utf8')
    expect(source.match(/intent\s*===\s*['"][^'"]+['"]/g)).toEqual(['intent === \'deconstruct\''])
    expect(source).not.toMatch(/import\s*\{[^}]*\bconfirm\w*Spend\b[^}]*\}\s*from/)
    expect(source).toMatch(/dedicatedSpendCardFor\(info\.intent\)/)
  })
})
