// 「记住我的选择」真的写进策略了吗——**用生产代码自己组装的 onRemember** 验证。
//
// 为什么单开一条：现有覆盖有个洞。spendConfirmQueue.test 验的是「勾了就会调 onRemember」，
// 但那个 onRemember 是测试自己塞的 vi.fn()；走查那条则是 E2E 桥里**另写一份** onRemember。
// 两者都没碰生产的那份——也就是说，defaultDependencies().remember 哪天写坏了
// （比如把整份策略覆盖掉、或者键名打错），两条测试照样全绿，用户却发现「记住」根本没记住。
//
// 这里直接驱动 assetUploadConsent 生产路径拿到 resolution.remember 再调用它，
// 断言落到 automationPolicy.set 上的载荷：既 anonymousAssetHosting='allow'，
// 又**保留其余策略字段**（曾经的一类真 bug：set 时不 spread 旧值，把用户别的设置清空）。
import { describe, expect, it, vi, beforeEach } from 'vitest'

const policyGet = vi.fn()
const policySet = vi.fn(async () => {})
const listVendors = vi.fn(() => [] as Array<Record<string, unknown>>)

vi.mock('../../../desktop/bridge', () => ({
  getDesktopBridge: () => ({
    settings: { automationPolicy: { get: policyGet, set: policySet } },
    modelCatalog: { listVendors },
  }),
}))

const { resolveAssetUploadConsent } = await import('./assetUploadConsent')

const localNode = { id: 'n1', kind: 'video', meta: { referenceVideoUrls: ['nomi-local://asset/p/clip.mp4'] } }

describe('托管「记住我的选择」落盘（生产 onRemember）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    listVendors.mockReturnValue([])
  })

  it('勾选后把 anonymousAssetHosting 写成 allow，且不冲掉其它策略字段', async () => {
    policyGet.mockResolvedValue({ anonymousAssetHosting: 'ask', hardBudget: 42, maxAttemptsPerJob: 3 })

    const resolution = await resolveAssetUploadConsent(localNode)
    // 前提先立住：这就是「会弹披露块」的那个现场，否则下面的 remember 是在验一个不会发生的场景。
    expect(resolution.needsConfirmation).toBe(true)

    await resolution.remember()

    expect(policySet).toHaveBeenCalledTimes(1)
    expect(policySet).toHaveBeenCalledWith({
      anonymousAssetHosting: 'allow',
      hardBudget: 42,
      maxAttemptsPerJob: 3,
    })
  })

  it('记住之后再来一次同样的生成，就不再需要披露了（记住是真的生效，不只是写了个值）', async () => {
    // 第一次：ask → 需要披露。
    policyGet.mockResolvedValue({ anonymousAssetHosting: 'ask' })
    expect((await resolveAssetUploadConsent(localNode)).needsConfirmation).toBe(true)

    // 用户勾了「记住」→ 策略变 allow。
    policyGet.mockResolvedValue({ anonymousAssetHosting: 'allow' })
    const second = await resolveAssetUploadConsent(localNode)
    expect(second.allowed).toBe(true)
    expect(second.needsConfirmation).toBe(false)
  })
})
