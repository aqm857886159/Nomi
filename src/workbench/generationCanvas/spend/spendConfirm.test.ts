import { createGenerationNode } from '../model/graphOps'
import { describe, expect, it, vi } from 'vitest'
import { describeGenerationCost, generationCostContextForNode, withGenerationEtaStats } from './spendConfirm'

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

  it('matches history by the model alias used in generation events', async () => {
    etaBridge.generationEtaStats.mockResolvedValue({ ok: true, stats: [{
      key: 'relay|video-model|video', vendorKey: 'relay', modelKey: 'video-model', kind: 'video',
      sampleCount: 2, p50Seconds: 120, p90Seconds: 600,
    }] })
    // 项目身份由发起确认的动作签发后显式传入。
    const context = generationCostContextForNode({ meta: {
      modelVendor: 'relay', modelKey: 'canonical-video-id', modelAlias: 'video-model',
    } }, 'eta-context-project')

    const message = describeGenerationCost(1, 'video', await withGenerationEtaStats(context))

    expect(context.projectId).toBe('eta-context-project')
    expect(etaBridge.generationEtaStats).toHaveBeenCalledWith('eta-context-project')
    expect(message).toContain('2–10')
    expect(message).not.toMatch(/预计约 5–20 分钟/)
  })
})

import i18n from '../../../i18n'
import { confirmGenerationResend, useSpendConfirmStore, generationNodeLedger } from './spendConfirm'
it.each([
 ['zh-CN','image','image'],['zh-CN','video','video'],['zh-CN','audio','other'],
 ['en','image','image'],['en','video','video'],['en','model3d','other'],
])('G10: %s %s resend copy belongs to the spend owner', async (locale,kind,titleKind) => {
 await i18n.changeLanguage(locale)
 const request=vi.spyOn(useSpendConfirmStore.getState(),'requestConfirm').mockResolvedValue(false)
 expect(await confirmGenerationResend({kind,resultUnknown:true})).toBe(false)
 expect(request).toHaveBeenCalledWith(expect.objectContaining({title:i18n.t(`generationCommon.spend.resend.title.${titleKind}`),kind:'generation',message:i18n.t('generationCommon.spend.resend.unknown')}))
 expect(request.mock.calls.at(-1)?.[0].message.split('\n')).toHaveLength(2)
 request.mockRestore();await i18n.changeLanguage('zh-CN')
})

it.each([
 ['zh-CN',{resolution:'1080p',credits:'21.6',unit:'credits'},{confirmCredits:'21.6',confirmCostUnit:'credits'}],
 ['en',{resolution:'1080p',credits:'≈¥15.6',unit:'cny'},{confirmCredits:'≈¥15.6',confirmCostUnit:'cny'}],
 ['zh-CN',{resolution:'1080p'},{}],
] as const)('second HD (%s): the price rides only on the primary button, in the send-pill unit; the body has no digits beyond the resolution', async (locale,secondSampleFinal,price) => {
 await i18n.changeLanguage(locale)
 const request=vi.spyOn(useSpendConfirmStore.getState(),'requestConfirm').mockResolvedValue(false)
 expect(await confirmGenerationResend({kind:'video',resultUnknown:false,secondSampleFinal})).toBe(false)
 const pending=request.mock.calls.at(-1)?.[0]
 expect(pending).toMatchObject({kind:'generation',confirmLabel:i18n.t('generationCommon.sample.secondFinal.confirm'),...price})
 if(!('credits' in secondSampleFinal)) expect(pending).not.toHaveProperty('confirmCredits')
 expect(String(pending?.message).replace(/1080p/g,'')).not.toMatch(/\d|积分|credit/i)
 request.mockRestore();await i18n.changeLanguage('zh-CN')
})

it.each(['image','video','audio','model3d','asset'] as const)('the moved %s ledger decision retains local and remote spend semantics',kind=>{
 const node={...createGenerationNode({id:'ledger-case',kind}),meta:{modelVendor:'relay'}}
 expect(generationNodeLedger(node)).toBe('run')
 expect(generationNodeLedger({...node!,meta:{modelVendor:'comfyui-local'}})).toBe('run')
 expect(generationNodeLedger({...node!,meta:{modelVendor:'comfyui-local-studio'}})).toBe('run')
 expect(generationNodeLedger({...node!,kind:'text'})).toBeUndefined()
})
