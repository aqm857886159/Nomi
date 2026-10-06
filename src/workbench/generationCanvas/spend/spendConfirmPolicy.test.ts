import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  confirmGenerationSpend,
  spendConfirmationRequirement,
  useSpendConfirmStore,
  type SpendInitiator,
} from './spendConfirm'

const paidNode = { meta: { modelVendor: 'relay', modelKey: 'image' } }

describe('spendConfirmationRequirement（唯一判据）', () => {
  // 列：说明 / 发起方 / 一下跑几份 / 首次匿名托管告知 / 要不要确认。金额不在判据里（Nomi 现在不计算价格）。
  it.each<[string, SpendInitiator, number, boolean, boolean]>([
    ['reported case: I click ↑ on one node', 'user', 1, false, false],
    ['storyboard row 「生成镜 N」, one shot', 'user', 1, false, false],
    ['×2 on one node', 'user', 2, false, true],
    ['batch of four', 'user', 4, false, true],
    ['Agent, single run', 'agent', 1, false, true],
    ['Agent, batch', 'agent', 3, false, true],
    ['first hosted run discloses', 'user', 1, true, true],
  ])('%s', (_label, initiator, runCount, hostingDisclosure, expected) => {
    expect(spendConfirmationRequirement({ initiator, runCount, hostingDisclosure })).toBe(expected)
  })
})

// 发动机收敛第一刀第 3 步：这张卡只回答「他同意没有」——批准与记账在制作流程的 Run 里（单节点 ↑ 是那一下点击，
// 批量卡点了确认是主进程为卡上每一镜开的出价）。它不再向主进程要报价、不再交出报价号去铸令牌。
describe('confirmGenerationSpend 走判据', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('reported case: a single user run skips the card and starts', async () => {
    const card = vi.spyOn(useSpendConfirmStore.getState(), 'requestConfirm')
    expect(await confirmGenerationSpend([paidNode], { title: 'Generate', message: 'One image', initiator: 'user' })).toBe(true)
    expect(card).not.toHaveBeenCalled()
  })

  it('×2 on the same node asks once', async () => {
    const card = vi.spyOn(useSpendConfirmStore.getState(), 'requestConfirm').mockResolvedValue(true)
    expect(await confirmGenerationSpend([paidNode, paidNode], { title: 'Generate', message: 'Two images', initiator: 'user' })).toBe(true)
    expect(card).toHaveBeenCalledTimes(1)
  })

  it('declining a card that had to be shown is a decline', async () => {
    const card = vi.spyOn(useSpendConfirmStore.getState(), 'requestConfirm').mockResolvedValue(false)
    expect(await confirmGenerationSpend([paidNode, paidNode], { title: 'Generate', message: 'Two videos', initiator: 'user' })).toBe(false)
    expect(card).toHaveBeenCalledTimes(1)
  })

  it('an Agent-initiated single run still asks', async () => {
    const card = vi.spyOn(useSpendConfirmStore.getState(), 'requestConfirm').mockResolvedValue(true)
    await confirmGenerationSpend([paidNode], { title: 'Generate', message: 'One image', initiator: 'agent' })
    expect(card).toHaveBeenCalledTimes(1)
  })

  it('local ComfyUI spends nothing: no card even for a batch', async () => {
    const card = vi.spyOn(useSpendConfirmStore.getState(), 'requestConfirm')
    const local = { meta: { modelVendor: 'comfyui-local', modelKey: 'flux' } }
    expect(await confirmGenerationSpend([local, local], { title: 'Generate', message: 'Two images', initiator: 'user' })).toBe(true)
    expect(card).not.toHaveBeenCalled()
  })
})
