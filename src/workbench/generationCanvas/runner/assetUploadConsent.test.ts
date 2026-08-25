import { describe, expect, it, vi } from 'vitest'
import { hasLocalAssetReference, requestAssetUploadConsent, resolveAssetUploadConsent } from './assetUploadConsent'

const node = (meta: Record<string, unknown> = {}) => ({ id: 'node-1', kind: 'video', meta })

describe('asset upload consent', () => {
  it('finds nomi-local references recursively', () => {
    expect(hasLocalAssetReference(node({ referenceVideoUrls: ['nomi-local://asset/p/clip.mp4'] }))).toBe(true)
    expect(hasLocalAssetReference(node({ referenceVideoUrls: ['https://cdn.example/clip.mp4'] }))).toBe(false)
  })

  it('does not interrupt a run with no local references', async () => {
    const confirm = vi.fn()
    await expect(requestAssetUploadConsent(node({ prompt: 'x' }), {
      readPolicy: async () => ({ anonymousAssetHosting: 'ask' }),
      listVendors: () => [],
      confirm,
    })).resolves.toBe(true)
    expect(confirm).not.toHaveBeenCalled()
  })

  it('explains the free KIE video path before allowing an anonymous fallback', async () => {
    const confirm = vi.fn().mockResolvedValue(true)
    await expect(requestAssetUploadConsent(node({ referenceVideoUrls: ['nomi-local://asset/p/clip.mp4'] }), {
      readPolicy: async () => ({ anonymousAssetHosting: 'ask' }),
      listVendors: () => [{ key: 'kie', enabled: true, hasApiKey: false, authType: 'bearer' }],
      confirm,
    })).resolves.toBe(true)
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({
      title: expect.stringContaining('KIE'),
      message: expect.stringContaining('免费'),
      confirmLabel: expect.stringContaining('继续'),
    }))
  })

  it('skips the prompt when KIE is configured or the user disabled reminders', async () => {
    const confirm = vi.fn()
    await expect(requestAssetUploadConsent(node({ referenceVideoUrls: ['nomi-local://asset/p/clip.mp4'] }), {
      readPolicy: async () => ({ anonymousAssetHosting: 'ask' }),
      listVendors: () => [{ key: 'kie', enabled: true, hasApiKey: true, authType: 'bearer' }],
      confirm,
    })).resolves.toBe(true)
    await expect(requestAssetUploadConsent(node({ referenceVideoUrls: ['nomi-local://asset/p/clip.mp4'] }), {
      readPolicy: async () => ({ anonymousAssetHosting: 'allow' }),
      listVendors: () => [],
      confirm,
    })).resolves.toBe(true)
    expect(confirm).not.toHaveBeenCalled()
  })

  it('stops the run when the disclosure is declined', async () => {
    const confirm = vi.fn().mockResolvedValue(false)
    await expect(requestAssetUploadConsent(node({ referenceVideoUrls: ['nomi-local://asset/p/clip.mp4'] }), {
      readPolicy: async () => ({ anonymousAssetHosting: 'ask' }),
      listVendors: () => [],
      confirm,
    })).resolves.toBe(false)
  })

  it('resolves the merged-card disclosure without opening a second dialog', async () => {
    const confirm = vi.fn()
    const remember = vi.fn(async () => {})
    await expect(resolveAssetUploadConsent(node({ referenceVideoUrls: ['nomi-local://asset/p/clip.mp4'] }), {
      readPolicy: async () => ({ anonymousAssetHosting: 'ask' }),
      listVendors: () => [],
      confirm,
      remember,
    })).resolves.toMatchObject({ allowed: true, needsConfirmation: true })
    expect(confirm).not.toHaveBeenCalled()
  })
})
