import { beforeEach, describe, expect, it, vi } from 'vitest'

const toastMock = vi.hoisted(() => vi.fn())

vi.mock('../ui/toast', () => ({ toast: toastMock }))

import { providerSwitchToastId, showInfoToast } from './showInfoToast'

describe('provider recovery toast identity', () => {
  beforeEach(() => vi.clearAllMocks())

  it('keeps the same transition on one stable toast id', () => {
    const id = providerSwitchToastId(['node-1', 'broken-vendor', 'old-model', 'healthy-vendor', 'new-model'])

    showInfoToast('switched', id)
    showInfoToast('switched', providerSwitchToastId(['node-1', 'broken-vendor', 'old-model', 'healthy-vendor', 'new-model']))

    expect(toastMock).toHaveBeenNthCalledWith(1, 'switched', 'info', id)
    expect(toastMock).toHaveBeenNthCalledWith(2, 'switched', 'info', id)
    expect(id).toContain('provider-disconnected-switched:node-1')
  })

  it('separates distinct provider recovery transitions', () => {
    expect(providerSwitchToastId(['node-1', 'old-vendor', 'old-model', 'new-vendor', 'new-model']))
      .not.toBe(providerSwitchToastId(['node-2', 'old-vendor', 'old-model', 'new-vendor', 'new-model']))
  })
})
