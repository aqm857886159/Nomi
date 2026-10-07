import {
  type IngestionResolver,
  type LocalizeAssetsOptions,
} from './assetLocalization'
import { resolveAssetIngestionWithFallback } from './assetLocalization'
import { anonymousConsentFromUnknown } from './assetTransportPolicy'
import { decryptApiKeyRecord, type ApiKeyRecord } from './secrets'
import { readAutomationPolicySettings, type AutomationPolicySettings } from '../settings/automationPolicySettings'
import type { Vendor } from './types'
import type { AssetIngestion } from './types'

type AssetCatalog = {
  vendors: Array<{ key?: string; assetIngestion?: AssetIngestion }>
  apiKeysByVendor: Record<string, ApiKeyRecord>
}

export function assetLocalizationOptions(
  extras: Record<string, unknown> | undefined,
  settings: AutomationPolicySettings = readAutomationPolicySettings(),
): LocalizeAssetsOptions {
  return {
    anonymousConsent: anonymousConsentFromUnknown(extras?.anonymousAssetHostingConsent ?? settings.anonymousAssetHosting),
    minimizeUploads: settings.minimizeUploads,
    activeAssetUrls: Array.isArray(extras?.activeAssetUrls)
      ? extras.activeAssetUrls.filter((value): value is string => typeof value === 'string')
      : undefined,
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
