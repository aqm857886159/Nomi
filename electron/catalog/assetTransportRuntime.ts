import {
  type IngestionResolver,
  type LocalizeAssetsOptions,
  type ReferenceLinkPolicy,
} from './assetLocalization'
import { resolveAssetIngestionWithFallback } from './assetLocalization'
import { anonymousConsentFromUnknown } from './assetTransportPolicy'
import { decryptApiKeyRecord, type ApiKeyRecord } from './secrets'
import { readAutomationPolicySettings, type AutomationPolicySettings } from '../settings/automationPolicySettings'
import { probeProviderLink } from '../assets/providerMediaFetch'
import { isConnectionRefused } from './referenceLinkRefusals'
import type { Vendor } from './types'
import type { AssetIngestion } from './types'

type AssetCatalog = {
  vendors: Array<{ key?: string; assetIngestion?: AssetIngestion }>
  apiKeysByVendor: Record<string, ApiKeyRecord>
}

/** 窗内临时链接对这条连接怎么处置：拒绝过 → 一律上传；否则试探（走这条连接自己的线路）。发送入口与做片返工问同一个。 */
export function referenceLinkPolicy(target: Pick<Vendor, 'key' | 'network'>): ReferenceLinkPolicy {
  return {
    refused: isConnectionRefused(target.key),
    probe: (url) => probeProviderLink(url, { providerNetwork: target.network }),
  }
}

/**
 * 一次发送的素材本地化选项。`target` 是**这次要发给的那条连接**（必填：忘了传就编译不过）——
 * 窗内的临时链接发不发，取决于这条连接的模型拒绝过没有（记账见 referenceLinkRefusals），
 * 试探走这条连接自己的线路（`vendor.network`）。所有发送入口都经这一个函数取选项，决定本身只在 `localizeAssetsForVendor`。
 */
export function assetLocalizationOptions(
  target: Pick<Vendor, 'key' | 'network'>,
  extras: Record<string, unknown> | undefined,
  settings: AutomationPolicySettings = readAutomationPolicySettings(),
): LocalizeAssetsOptions {
  return {
    anonymousConsent: anonymousConsentFromUnknown(extras?.anonymousAssetHostingConsent ?? settings.anonymousAssetHosting),
    minimizeUploads: settings.minimizeUploads,
    activeAssetUrls: Array.isArray(extras?.activeAssetUrls)
      ? extras.activeAssetUrls.filter((value): value is string => typeof value === 'string')
      : undefined,
    linkPolicy: referenceLinkPolicy(target),
  }
}

export function assetIngestionResolver(vendor: Vendor, catalog: AssetCatalog, operationIngestion?: AssetIngestion): IngestionResolver {
  return (mediaKind) => resolveAssetIngestionWithFallback(
    vendor,
    catalog.vendors,
    (key) => decryptApiKeyRecord(catalog.apiKeysByVendor[key]),
    mediaKind,
    operationIngestion,
  )
}
