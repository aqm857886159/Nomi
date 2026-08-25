import { describe, expect, it, vi } from 'vitest'
import { hasLocalAssetReference, resolveAssetUploadConsent } from './assetUploadConsent'

const node = (meta: Record<string, unknown> = {}) => ({ id: 'node-1', kind: 'video', meta })

// 这些用例原本测的是 requestAssetUploadConsent（会自己弹第二张卡的那个）。F16b 把它删了，
// 判据整体搬到 resolveAssetUploadConsent 上：同样的策略/KIE/本地素材组合，现在的正确答案是
// 「要不要在花钱卡里带披露块」（needsConfirmation），而不是「弹不弹卡」。行为覆盖一条没少。
describe('asset upload consent', () => {
  it('finds nomi-local references recursively', () => {
    expect(hasLocalAssetReference(node({ referenceVideoUrls: ['nomi-local://asset/p/clip.mp4'] }))).toBe(true)
    expect(hasLocalAssetReference(node({ referenceVideoUrls: ['https://cdn.example/clip.mp4'] }))).toBe(false)
  })

  it('does not interrupt a run with no local references', async () => {
    await expect(resolveAssetUploadConsent(node({ prompt: 'x' }), {
      readPolicy: async () => ({ anonymousAssetHosting: 'ask' }),
      listVendors: () => [],
    })).resolves.toMatchObject({ allowed: true, needsConfirmation: false })
  })

  it('asks once (inside the spend card) when KIE is unconfigured and a local asset is used', async () => {
    await expect(resolveAssetUploadConsent(node({ referenceVideoUrls: ['nomi-local://asset/p/clip.mp4'] }), {
      readPolicy: async () => ({ anonymousAssetHosting: 'ask' }),
      listVendors: () => [{ key: 'kie', enabled: true, hasApiKey: false, authType: 'bearer' }],
    })).resolves.toMatchObject({ allowed: true, needsConfirmation: true })
  })

  it('skips the disclosure when KIE is configured or the user disabled reminders', async () => {
    await expect(resolveAssetUploadConsent(node({ referenceVideoUrls: ['nomi-local://asset/p/clip.mp4'] }), {
      readPolicy: async () => ({ anonymousAssetHosting: 'ask' }),
      listVendors: () => [{ key: 'kie', enabled: true, hasApiKey: true, authType: 'bearer' }],
    })).resolves.toMatchObject({ allowed: true, needsConfirmation: false })
    await expect(resolveAssetUploadConsent(node({ referenceVideoUrls: ['nomi-local://asset/p/clip.mp4'] }), {
      readPolicy: async () => ({ anonymousAssetHosting: 'allow' }),
      listVendors: () => [],
    })).resolves.toMatchObject({ allowed: true, needsConfirmation: false })
  })

  it('blocks the run outright when the hosting policy is deny', async () => {
    await expect(resolveAssetUploadConsent(node({ referenceVideoUrls: ['nomi-local://asset/p/clip.mp4'] }), {
      readPolicy: async () => ({ anonymousAssetHosting: 'deny' }),
      listVendors: () => [],
    })).resolves.toMatchObject({ allowed: false })
  })

  it('treats a local ComfyUI target as needing no public host at all', async () => {
    await expect(resolveAssetUploadConsent(node({
      referenceVideoUrls: ['nomi-local://asset/p/clip.mp4'],
      modelVendor: 'comfyui-local',
    }), {
      readPolicy: async () => ({ anonymousAssetHosting: 'ask' }),
      listVendors: () => [],
    })).resolves.toMatchObject({ allowed: true, needsConfirmation: false })
  })

  it('hands back the remember callback so the merged card can persist the choice', async () => {
    const remember = vi.fn(async () => {})
    const resolution = await resolveAssetUploadConsent(node({ referenceVideoUrls: ['nomi-local://asset/p/clip.mp4'] }), {
      readPolicy: async () => ({ anonymousAssetHosting: 'ask' }),
      listVendors: () => [],
      remember,
    })
    expect(resolution.needsConfirmation).toBe(true)
    await resolution.remember()
    expect(remember).toHaveBeenCalledTimes(1)
  })
})
