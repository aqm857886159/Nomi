import { beforeEach, describe, expect, it, vi } from 'vitest'

const { toastMock, dispatchEventMock } = vi.hoisted(() => ({
  toastMock: vi.fn(),
  dispatchEventMock: vi.fn(),
}))

vi.mock('../../ui/toast', () => ({ toast: toastMock }))

import { handleCapabilityApply } from './capabilityApplyHandler'

describe('MCP desktop effects', () => {
  beforeEach(() => {
    toastMock.mockReset()
    vi.stubGlobal('window', { dispatchEvent: dispatchEventMock })
    dispatchEventMock.mockReset()
  })

  it('opens the model settings route through the existing settings event', async () => {
    await expect(handleCapabilityApply('integration.open-credentials', { sessionId: 'integration-1' }))
      .resolves.toEqual({ opened: true })
    expect(dispatchEventMock).toHaveBeenCalledWith(expect.objectContaining({
      type: 'nomi-open-settings',
    }))
    const event = dispatchEventMock.mock.calls[0][0] as CustomEvent<{ tab: string }>
    expect(event.detail).toEqual({ tab: 'models' })
  })

  it('names every repaired assistant in the restart toast', async () => {
    await expect(handleCapabilityApply('host-config.repaired', { clients: ['Claude Code', 'Codex'] }))
      .resolves.toEqual({ notified: true })
    expect(toastMock).toHaveBeenCalledTimes(1)
    expect(toastMock.mock.calls[0][1]).toBe('info')
    // 名单来自修复结果，不是这里写死的一个「Claude Code」——Cursor / Codex / 自建 profile
    // 走的是同一个修复函数，只提示其中一个等于对其余的用户什么都没说。
    expect(String(toastMock.mock.calls[0][0])).toContain('Claude Code、Codex')
  })

  it('stays silent when the repair named nobody', async () => {
    // 空名单 = 没有任何配置被改写。真到了这一步说明上游的 changed 闸漏了，
    // 这里也不能弹一句「已修复 的 Nomi 接入配置」——那比不提示更糟。
    await expect(handleCapabilityApply('host-config.repaired', {})).resolves.toEqual({ notified: false })
    expect(toastMock).not.toHaveBeenCalled()
  })
})
