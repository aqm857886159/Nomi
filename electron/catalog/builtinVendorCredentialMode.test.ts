import { describe, expect, it, vi } from 'vitest'

import { credentialModeForVendor } from './builtinVendorSeeds'
import { publicVendor } from './customConfigStore'

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (value: string) => Buffer.from(value, 'utf8'),
    decryptString: () => '',
  },
}))

const vendor = (key: string) => ({
  key,
  name: key,
  enabled: true,
  authType: 'bearer' as const,
  createdAt: '',
  updatedAt: '',
})

describe('public vendor credential mode', () => {
  it('marks the shipped APIMart contract as direct-key', () => {
    expect(credentialModeForVendor('apimart')).toBe('direct-key')
  })

  it('defaults other built-in vendors to certification', () => {
    expect(credentialModeForVendor('kie')).toBe('certification')
  })

  it('does not assign a mode to custom vendor keys', () => {
    expect(credentialModeForVendor('custom-user-vendor')).toBeUndefined()
  })

  it('derives the mode on the public vendor projection without persisting it', () => {
    const source = vendor('apimart')
    expect(publicVendor(source).credentialMode).toBe('direct-key')
    expect(publicVendor(vendor('kie')).credentialMode).toBe('certification')
    expect(publicVendor(vendor('custom-user-vendor')).credentialMode).toBeUndefined()
    expect(Object.prototype.hasOwnProperty.call(source, 'credentialMode')).toBe(false)
    expect(publicVendor({ ...vendor('custom-user-vendor'), credentialMode: 'direct-key' } as never).credentialMode)
      .toBeUndefined()
  })
})
