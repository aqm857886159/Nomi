import {
  type IngestionResolver,
  type LocalizeAssetsOptions,
  type ReferenceLinkPolicy,
} from './assetLocalization'
import { localizeAssetsForVendor, resolveAssetIngestionWithFallback } from './assetLocalization'
import { decryptApiKeyRecord, type ApiKeyRecord } from './secrets'
import { readAutomationPolicySettings, type AutomationPolicySettings } from '../settings/automationPolicySettings'
import { probeProviderLink } from '../assets/providerMediaFetch'
import { outsidePaidDispatch } from '../outboundDispatchEvidence'
import type { Vendor } from './types'
import type { AssetIngestion } from './types'

type AssetCatalog = {
  vendors: Array<{ key?: string; assetIngestion?: AssetIngestion }>
  apiKeysByVendor: Record<string, ApiKeyRecord>
}

/** 探测使用这次生成所选连接的线路。 */
export function referenceLinkPolicy(target: Pick<Vendor, 'key' | 'network'>): ReferenceLinkPolicy {
  return {
    probe: (url) => probeProviderLink(url, { providerNetwork: target.network }),
  }
}

/**
 * 一次发送的素材本地化选项。`target` 是**这次要发给的那条连接**（必填：忘了传就编译不过）——
 * 试探走这条连接自己的线路（`vendor.network`）。所有发送入口都经这一个函数取选项，决定本身只在 `localizeAssetsForVendor`。
 */
export function assetLocalizationOptions(
  target: Pick<Vendor, 'key' | 'network'>,
  extras: Record<string, unknown> | undefined,
  settings: AutomationPolicySettings = readAutomationPolicySettings(),
): LocalizeAssetsOptions {
  return {
    minimizeUploads: settings.minimizeUploads,
    activeAssetUrls: Array.isArray(extras?.activeAssetUrls)
      ? extras.activeAssetUrls.filter((value): value is string => typeof value === 'string')
      : undefined,
    linkPolicy: referenceLinkPolicy(target),
  }
}

/**
 * 发送入口落地参考素材的唯一口。试探链接和上传文件都不是付费派发，放到付费账本外跑：否则带查询串的试探和上传会在账上留一笔，
 * 模型接口这时连不上，一笔没发也会被说成「结果未知」，用户要去任务中心放行才能重试。
 */
export function localizeForSend(...args: Parameters<typeof localizeAssetsForVendor>): ReturnType<typeof localizeAssetsForVendor> {
  return outsidePaidDispatch(() => localizeAssetsForVendor(...args))
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
