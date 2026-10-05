import { beforeEach, describe, expect, it, vi } from 'vitest'
import { confirmGenerationSpend, useSpendConfirmStore } from './spendConfirm'

const bridgeCalls = vi.hoisted(() => vi.fn())
vi.mock('../../../desktop/bridge', () => ({ getDesktopBridge: () => new Proxy({}, { get: (_target, key) => { bridgeCalls(String(key)); return undefined } }) }))

// 这两条走的是「会弹卡」的那条路（Agent 发起），验的是卡上**不印金额**（2026-09-26 用户拍板：官方额度上线前
// 隐藏价格维度）。发动机收敛第一刀第 3 步之后，这张卡也不再向主进程要报价（批准与记账在制作流程的 Run 里），
// 所以它碰不到任何价格；用户自己点单个节点不弹卡的那条路在 spendConfirmPolicy.test.ts。
describe('shared spend confirmation card', () => {
  beforeEach(() => { vi.restoreAllMocks(); bridgeCalls.mockReset() })
  it('prints no amount and never asks the desktop for a quote', async () => {
    const confirm = vi.spyOn(useSpendConfirmStore.getState(), 'requestConfirm').mockResolvedValue(true)
    expect(await confirmGenerationSpend([{ meta: { modelVendor: 'relay', modelKey: 'image' } }], {
      title: 'Generate', message: 'One image', initiator: 'agent',
    })).toBe(true)
    expect(confirm.mock.calls[0][0].details ?? []).toEqual([])
    expect(bridgeCalls).not.toHaveBeenCalled()
  })
  it('a declined card is a decline, with nothing printed either', async () => {
    const confirm = vi.spyOn(useSpendConfirmStore.getState(), 'requestConfirm').mockResolvedValue(false)
    expect(await confirmGenerationSpend([{ meta: { modelVendor: 'relay', modelKey: 'unpriced' } }], {
      title: 'Generate', message: 'One image', initiator: 'agent',
    })).toBe(false)
    expect(confirm.mock.calls[0][0].details ?? []).toEqual([])
  })
})
