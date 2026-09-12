import { describe, expect, it, vi } from 'vitest'
import { hasPendingSpendCapability } from './useAgentPanelSpendConfirm'
import { getDesktopBridge } from '../../../desktop/bridge'

vi.mock('../../../desktop/bridge', () => ({ getDesktopBridge: vi.fn() }))

describe('spend surface capability guard', () => {
  it('reports unavailable without pendingSpend capability', () => {
    vi.mocked(getDesktopBridge).mockReturnValue({ productionRuns: {} } as never)
    expect(hasPendingSpendCapability()).toBe(false)
  })
  it('reports available when pendingSpend exists', () => {
    vi.mocked(getDesktopBridge).mockReturnValue({ productionRuns: { pendingSpend: vi.fn() } } as never)
    expect(hasPendingSpendCapability()).toBe(true)
  })
})
