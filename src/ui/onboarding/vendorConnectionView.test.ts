import { describe, expect, it } from 'vitest'
import { vendorConnectionPill, VENDOR_CONNECTION_PILL_LABEL_MEMBERS } from './vendorConnectionView'

describe('vendorConnectionPill — 连接状态 → 卡片胶囊', () => {
  it('连通 = 绿点常态', () => {
    expect(vendorConnectionPill({ state: 'reachable' })).toEqual({
      status: 'ok',
      labelKey: 'onboardingProviders.vendorCard.connection.reachable',
    })
  })

  it('连不上 = 红底红字（需要用户行动，值得跳出来）', () => {
    expect(vendorConnectionPill({ state: 'unreachable', reason: 'HTTP 401' }).status).toBe('error')
  })

  it('检查中 = 安静的灰点，不抢眼', () => {
    expect(vendorConnectionPill({ state: 'checking' }).status).toBe('todo')
  })

  it('不支持预检 = 只说「已保存」，不是错误也不喊红', () => {
    expect(vendorConnectionPill({ state: 'unsupported' })).toEqual({
      status: 'todo',
      labelKey: 'onboardingProviders.vendorCard.connection.saved',
    })
  })

  it('「未测试」「暂不支持自动测试」这两条死路文案不再出现在任何状态里', () => {
    const keys = (['reachable', 'unreachable', 'checking', 'unsupported'] as const).map(
      (state) => vendorConnectionPill({ state }).labelKey,
    )
    expect(keys.some((k) => /Untested|TestUnavailable/i.test(k))).toBe(false)
  })

  it('pins the complete runtime label member set for the i18n gate', () => {
    expect([...VENDOR_CONNECTION_PILL_LABEL_MEMBERS]).toEqual(['reachable', 'unreachable', 'checking', 'saved'])
  })
})
