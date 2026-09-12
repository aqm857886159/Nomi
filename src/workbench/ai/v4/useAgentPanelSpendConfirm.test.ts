import { describe, expect, it, vi } from 'vitest'
import { hasPendingSpendCapability, isOptionalSpendSurfaceUnavailable } from './useAgentPanelSpendConfirm'
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
  it('recognizes the explicit unavailable-capability error from an uninstalled core', () => {
    expect(isOptionalSpendSurfaceUnavailable(Object.assign(new Error('core unavailable'), { code: 'spend_confirm_surface_unavailable' }))).toBe(true)
  })
  it('keeps unrelated host failures visible', () => {
    expect(isOptionalSpendSurfaceUnavailable(new Error('Error invoking remote method'))).toBe(false)
  })
})
