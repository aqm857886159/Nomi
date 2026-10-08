import { describe, expect, it, vi, afterEach } from 'vitest'
import { installProbe } from './pageProbe.mjs'

describe('pageProbe does not track removed completion receipts', () => {
  afterEach(() => vi.unstubAllGlobals())
  it('installs without a completion receipt ledger', () => {
    vi.stubGlobal('window', { addEventListener() {} })
    vi.stubGlobal('document', { querySelector: () => null, querySelectorAll: () => [], documentElement: {} })
    vi.stubGlobal('MutationObserver', class { observe() {} })
    vi.stubGlobal('requestAnimationFrame', () => 0)
    vi.stubGlobal('setInterval', () => 0)
    vi.stubGlobal('getComputedStyle', () => ({}))
    installProbe()
    expect(window.__nomiFullWalk.completionReceipts).toBeUndefined()
  })
})
