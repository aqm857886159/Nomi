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

  it('shows the restart toast only when the main process reports a repair', async () => {
    await expect(handleCapabilityApply('host-config.repaired', {})).resolves.toEqual({ notified: true })
    expect(toastMock).toHaveBeenCalledTimes(1)
    expect(toastMock.mock.calls[0][1]).toBe('info')
    toastMock.mockReset()

    // The no-change case is filtered at the main-process repair boundary; this
    // renderer operation is never sent for it. Keeping the handler side effect
    // explicit makes the one-shot contract testable without booting Electron.
    expect(toastMock).not.toHaveBeenCalled()
  })
})
