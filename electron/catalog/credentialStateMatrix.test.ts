import { describe, expect, it, vi } from 'vitest'
import type { CatalogState, Model, Vendor } from './types'

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (plain: string) => Buffer.from(plain, 'utf8'),
    decryptString: (value: Buffer) => {
      const text = value.toString('utf8')
      if (text === 'FAIL') throw new Error('decrypt failed')
      return text
    },
  },
}))
vi.mock('../logging/logger', () => ({
  logError: () => undefined,
  logWarn: () => undefined,
}))

import { apiKeyDecryptStatus, credentialRecordCounts } from './secrets'
import { createCatalogAvailability } from './catalogModelAvailability'
import { resolveCredentialCopy } from '../../src/ui/onboarding/credentialPresentation'

const b64 = (value: string) => Buffer.from(value, 'utf8').toString('base64')
const vendor = (over: Partial<Vendor> = {}): Vendor => ({
  key: 'relay', name: 'Relay', enabled: true, authType: 'bearer', createdAt: 't', updatedAt: 't', ...over,
})
const model = (over: Partial<Model> = {}): Model => ({
  vendorKey: 'relay', modelKey: 'model', labelZh: 'Model', kind: 'text', enabled: true,
  meta: { adapter: { state: 'verified', modes: [] } }, createdAt: 't', updatedAt: 't', ...over,
})
const state = (record: CatalogState['apiKeysByVendor']['relay'], over: Partial<Vendor> = {}): CatalogState => ({
  version: 12, vendors: [vendor(over)], models: [model()], mappings: [], apiKeysByVendor: record ? { relay: record } : {},
} as CatalogState)

describe('credential lifecycle matrix: material, verification, enablement, and copy stay separate', () => {
  it.each([
    {
      name: 'no material', record: undefined, vendor: { enabled: true }, hasApiKey: false, status: 'missing', usable: false,
      copy: 'savedTitle',
    },
    {
      name: 'offline pending and disabled', record: { vendorKey: 'relay', apiKey: b64('pending'), enc: 'safeStorage', enabled: false, verificationPending: true, createdAt: 't', updatedAt: 't' },
      vendor: { enabled: false }, hasApiKey: true, status: 'ok', usable: false, copy: 'offlineTitle',
    },
    {
      name: 'verified and enabled', record: { vendorKey: 'relay', apiKey: b64('verified'), enc: 'safeStorage', enabled: true, createdAt: 't', updatedAt: 't' },
      vendor: { enabled: true }, hasApiKey: true, status: 'ok', usable: true, copy: 'publishedTitle',
    },
    {
      name: 'material exists but cannot decrypt', record: { vendorKey: 'relay', apiKey: b64('FAIL'), enc: 'safeStorage', enabled: true, createdAt: 't', updatedAt: 't' },
      vendor: { enabled: true }, hasApiKey: false, status: 'locked', usable: false, copy: 'savedTitle',
    },
  ] as const)('$name', ({ record, vendor: vendorPatch, hasApiKey, status, usable, copy }) => {
    expect(credentialRecordCounts(record)).toBe(record !== undefined)
    expect(apiKeyDecryptStatus(record)).toBe(status)
    const current = state(record, vendorPatch)
    const projectedHasApiKey = apiKeyDecryptStatus(record) === 'ok'
    expect(projectedHasApiKey).toBe(hasApiKey)
    expect(createCatalogAvailability(current).of(current.models[0]!)).toEqual(usable ? { usable: true } : expect.objectContaining({ usable: false }))
    expect(resolveCredentialCopy({ hasApiKey, verificationPending: record?.verificationPending === true, curatedModelsPublished: usable })).toMatchObject({
      titleKey: `onboardingProviders.keyOnly.${copy}`,
    })
  })
})
