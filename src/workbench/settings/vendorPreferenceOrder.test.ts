import { describe, expect, it } from 'vitest'
import { orderConfiguredVendors } from './vendorPreferenceOrder'

describe('orderConfiguredVendors', () => {
  it('keeps saved configured entries first and appends new entries stably', () => {
    const entries = [{ vendorKey: 'apimart', name: 'APIMart' }, { vendorKey: 'kie', name: 'Kie' }, { vendorKey: 'volcengine', name: 'Volcengine' }]
    expect(orderConfiguredVendors(entries, ['volcengine', 'missing', 'volcengine'])).toEqual([
      entries[2], entries[0], entries[1],
    ])
  })
})
