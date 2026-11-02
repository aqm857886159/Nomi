import { describe, expect, it, vi } from 'vitest'
import { describeGenerationCost, generationCostContextForNode } from './spendConfirm'

const etaBridge = vi.hoisted(() => ({
  generationEtaStats: vi.fn(),
}))

vi.mock('../../../desktop/bridge', () => ({
  getDesktopBridge: () => ({ events: etaBridge }),
}))

describe('generation spend ETA copy', () => {
  it('uses the selected concurrency within each serial dependency wave', () => {
    const parallel = describeGenerationCost(6, 'video', { concurrency: 6, waveSizes: [6], etaStats: [] })
    const dependent = describeGenerationCost(6, 'video', { concurrency: 6, waveSizes: [1, 5], etaStats: [] })
    expect(parallel).toContain('5–20')
    expect(dependent).toContain('10–40')
  })
  it('uses historical P50/P90 as an interval', () => {
    const message = describeGenerationCost(2, 'video', {
      vendorKey: 'relay', modelKey: 'video-model',
      etaStats: [{ key: 'relay|video-model|video', vendorKey: 'relay', modelKey: 'video-model', kind: 'video', sampleCount: 4, p50Seconds: 480, p90Seconds: 1020 }],
    })
    expect(message).toContain('16–34')
    expect(message).not.toContain('预计约 1 分钟')
  })

  it('uses a cold-start interval when history is unavailable', () => {
    const message = describeGenerationCost(1, 'video', { vendorKey: 'new', modelKey: 'new-video', etaStats: [] })
    expect(message).toMatch(/预计约 .*–.* 分钟/)
  })

  it('matches history by the model alias used in generation events', () => {
    etaBridge.generationEtaStats.mockReturnValue({ stats: [{
      key: 'relay|video-model|video', vendorKey: 'relay', modelKey: 'video-model', kind: 'video',
      sampleCount: 2, p50Seconds: 120, p90Seconds: 600,
    }] })
    // 项目身份由发起确认的动作签发后显式传入。
    const context = generationCostContextForNode({ meta: {
      modelVendor: 'relay', modelKey: 'canonical-video-id', modelAlias: 'video-model',
    } }, 'eta-context-project')

    const message = describeGenerationCost(1, 'video', context)

    expect(context.projectId).toBe('eta-context-project')
    expect(etaBridge.generationEtaStats).toHaveBeenCalledWith('eta-context-project')
    expect(message).toContain('2–10')
    expect(message).not.toMatch(/预计约 5–20 分钟/)
  })
})

import i18n from '../../../i18n'
import { confirmGenerationResend, useSpendConfirmStore } from './spendConfirm'
it.each([
 ['zh-CN','image','再发一次这张图片？'],['zh-CN','video','再发一次这段视频？'],['zh-CN','audio','再发一次？'],
 ['en','image','Send this image again?'],['en','video','Send this video again?'],['en','model3d','Send it again?'],
])('G10: %s %s resend copy belongs to the spend owner', async (locale,kind,title) => {
 await i18n.changeLanguage(locale)
 const request=vi.spyOn(useSpendConfirmStore.getState(),'requestConfirm').mockResolvedValue(false)
 const disclosure={message:'hosting',rememberLabel:'remember'}
 expect(await confirmGenerationResend({kind,state:'unknown',hostingDisclosure:disclosure})).toBe(false)
 expect(request).toHaveBeenCalledWith(expect.objectContaining({title,kind:'generation',hostingDisclosure:disclosure,message:i18n.t('generationCommon.spend.resend.unknown')}))
 expect(request.mock.calls.at(-1)?.[0].message.split('\n')).toHaveLength(2)
 request.mockRestore();await i18n.changeLanguage('zh-CN')
})
