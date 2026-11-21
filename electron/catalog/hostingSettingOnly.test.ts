import { setDesktopLocale } from '../desktopLocale'
import { desktopT } from '../desktopStrings'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { localizeAssetsForVendor, assertLocalAssetTransportReady, type IngestionCandidate } from './assetLocalization'
import { assetLocalizationOptions } from './assetTransportRuntime'
import { normalizeAutomationPolicySettings } from '../settings/automationPolicyContract'

const state = vi.hoisted(() => ({ policy: 'ask' as unknown }))
vi.mock('../settings/automationPolicySettings', () => ({
  readAutomationPolicySettings: () => ({ anonymousAssetHosting: state.policy, minimizeUploads: true }),
}))
const bytes = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex')
const url = 'nomi-local://asset/project/reference.png'
const read = () => ({ bytes, contentType: 'image/png', fileName: 'reference.png' })
const anonymous: IngestionCandidate = { ingestion: { strategy: 'upload-multipart', endpoint: 'http://127.0.0.1:1/anonymous', fileField: 'file', urlPath: 'url', visibility: 'public-anonymous' }, vendorKey: null, uploadApiKey: '' }
const relay: IngestionCandidate = { ...anonymous, vendorKey: 'nomi-relay', ingestion: { strategy: 'upload-multipart', endpoint: 'http://127.0.0.1:1/relay', fileField: 'file', urlPath: 'url', visibility: 'public-provider' } }

beforeEach(() => { state.policy = 'ask' })
describe('hosting is controlled only by main-process settings', () => {
  it.each(['ask', 'deny', undefined, 'unknown'])('setting %s never sends anonymously, including missing options', async policy => {
    state.policy = policy
    const upload = vi.fn(async () => ({ url: 'http://127.0.0.1/result.png' }))
    await expect(localizeAssetsForVendor({ ref: url }, () => [anonymous], read, vi.fn(), upload)).rejects.toThrow()
    expect(upload).not.toHaveBeenCalled()
    expect(() => assertLocalAssetTransportReady({ ref: url }, () => [anonymous], read)).toThrow()
  })
  it('ignores caller-supplied allow instead of treating it as settings', async () => {
    const upload = vi.fn(async () => ({ url: 'http://127.0.0.1/result.png' }))
    const options = assetLocalizationOptions({ key: 'custom' }, { anonymousAssetHostingConsent: 'allow' })
    await expect(localizeAssetsForVendor({ ref: url }, () => [anonymous], read, vi.fn(), upload, options)).rejects.toThrow()
    expect(upload).not.toHaveBeenCalled()
  })
  it('allow keeps fallback after relay failure, without a confirmation', async () => {
    state.policy = 'allow'
    const upload = vi.fn(async (endpoint: string) => {
      if (endpoint.endsWith('/anonymous')) return { url: 'http://127.0.0.1/result.png' }
      throw new Error('HTTP 503')
    })
    const other = { ...relay, ingestion: { ...relay.ingestion, endpoint: 'http://127.0.0.1:1/relay' } } as IngestionCandidate
    await expect(localizeAssetsForVendor({ ref: url }, () => [other, anonymous], read, vi.fn(), upload)).resolves.toMatchObject({ uploaded: 1 })
    expect(upload).toHaveBeenCalledTimes(2)
  })
  it.each(['zh-CN', 'en'])('channel failure copy names the relay and next action in %s', async locale => {
    setDesktopLocale(locale)
    const upload = vi.fn(async () => { throw new Error('HTTP 503') })
    const error = await localizeAssetsForVendor({ ref: url }, () => [relay, anonymous], read, vi.fn(), upload).catch((error: Error) => error)
    expect(error).toBeInstanceOf(Error)
    const firstLine = (error as Error).message.split('\n')[0]
    expect(firstLine).toContain(desktopT('assetUpload.relay'))
    expect(firstLine).toContain(locale === 'en' ? 'Settings' : '设置')
    expect(upload).toHaveBeenCalledTimes(1)
    setDesktopLocale('zh-CN')
  })
  it.each(['deny', 'unrecognized', null])('normalizes legacy or unknown %s to ask', policy => {
    expect(normalizeAutomationPolicySettings({ anonymousAssetHosting: policy }).anonymousAssetHosting).toBe('ask')
  })
  it.each(['zh-CN', 'en'])('keeps unavailable and short-lease channel failures readable in %s', async locale => {
    setDesktopLocale(locale)
    try {
      const short = { ...relay, ingestion: { ...relay.ingestion, ttlSeconds: 1 } } as IngestionCandidate
      for (const candidates of [[], [short]]) {
        const error = await localizeAssetsForVendor({ ref: url }, () => candidates, read, vi.fn(), vi.fn()).catch((error: Error) => error)
        expect((error as Error).message.split('\n')[0]).toContain(candidates.length
          ? desktopT('assetUpload.channelLeaseTooShort', { channel: '127.0.0.1:1' })
          : desktopT('assetUpload.noChannel'))
      }
    } finally { setDesktopLocale('zh-CN') }
  })
})
