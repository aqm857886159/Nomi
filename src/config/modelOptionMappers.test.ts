import { describe, expect, it } from 'vitest'
import { toCatalogModelOptions } from './modelOptionMappers'

/**
 * 这一条钉的是 2026-09-11 逮到的**少报**：目录价目此前被 `Math.floor` 到整数（历史「积分」
 * 假设），于是所有低于 1 元的价格一律变成 0——画布批量确认条印「预估约 0 金币」，
 * 而主进程按同一行算出来的是 0.30。
 *
 * 0 是唯一一个会被读成「这次不花钱」的数，所以它比不报价还坏。测的是**值本身**，
 * 不是「有没有价目」：只有前者才能在下一个人重新引入取整时红。
 */
describe('toCatalogModelOptions · 目录价目', () => {
  const row = (pricing: unknown): Parameters<typeof toCatalogModelOptions>[0][number] =>
    ({ modelKey: 'demo-image', vendorKey: 'demo', labelZh: '演示', pricing }) as never

  it('低于 1 元的价格原样带过来，不取整成 0', () => {
    const [option] = toCatalogModelOptions([row({ cost: 0.3, enabled: true, specCosts: [] })])
    expect(option?.pricing?.cost).toBe(0.3)
  })

  it('规格加价档同样不取整', () => {
    const [option] = toCatalogModelOptions([
      row({ cost: 0.3, enabled: true, specCosts: [{ specKey: 'size:1536x1024', cost: 0.2, enabled: true }] }),
    ])
    expect(option?.pricing?.specCosts?.[0]?.cost).toBe(0.2)
  })

  it('价格不是有限非负数时整行不给价目——诚实报「算不出」，不编一个 0', () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, -1, '0.3', null]) {
      const [option] = toCatalogModelOptions([row({ cost: bad, enabled: true, specCosts: [] })])
      expect(option?.pricing, `cost=${String(bad)}`).toBeUndefined()
    }
  })
})
