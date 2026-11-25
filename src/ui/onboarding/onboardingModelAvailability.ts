import React from 'react'
import useSWR, { mutate } from 'swr'
import {
  builtinVendorKeyOfKey,
  isVendorOfBuiltin,
  type VendorIdentityEntry,
} from '../../../electron/shared/builtinVendorIdentity'
import { vendorFieldLossNoticeAt } from '../../../electron/shared/vendorFieldLossNotice'
import { getDesktopBridge } from '../../desktop/bridge'
import type { DreaminaStatus } from './DreaminaMemberCard'
import { projectModelSettingsCatalog } from './modelSettingsCatalogProjection'
import { DREAMINA_CONNECTION_KEY } from './onboardingDrawerConstants'
import { projectOnboardingConnections } from './onboardingDrawerConnections'
import type { OnboardingVendorMeta } from './useOnboardingDrawerCatalog'

export type ApimartCatalogCounts = {
  total: number
  image: number
  video: number
  audio: number
  text: number
}

export type OnboardingAvailabilitySnapshot = {
  loading: boolean
  hasUsableModelConnection: boolean
  apimartConnected: boolean
  apimartCounts: ApimartCatalogCounts
}

type ResolvedAvailability = Omit<OnboardingAvailabilitySnapshot, 'loading'>

const ONBOARDING_AVAILABILITY_SWR_KEY = 'nomi:onboarding-model-availability:v1'

const EMPTY_COUNTS: ApimartCatalogCounts = {
  total: 0,
  image: 0,
  video: 0,
  audio: 0,
  text: 0,
}

const EMPTY_AVAILABILITY: ResolvedAvailability = {
  hasUsableModelConnection: false,
  apimartConnected: false,
  apimartCounts: EMPTY_COUNTS,
}

/**
 * 按 `numbers.runtime-counts` 实时统计内置 APIMart 目录模型数：
 * 只数新节点能选的活跃模型（排除 `catalogLifecycle === 'legacy'` 退役模型与 `promptRefineOnly` 内部润色模型）。
 */
export function countApimartCatalogModels(
  storedModels: ReadonlyArray<Record<string, unknown>>,
): ApimartCatalogCounts {
  let image = 0
  let video = 0
  let audio = 0
  let text = 0
  for (const row of storedModels) {
    if (builtinVendorKeyOfKey(String(row.vendorKey || '')) !== 'apimart') continue
    const meta = (row.meta ?? {}) as Record<string, unknown>
    if (meta.catalogLifecycle === 'legacy') continue
    if (meta.promptRefineOnly === true) continue
    const kind = String(row.kind || '')
    if (kind === 'image') image += 1
    else if (kind === 'video') video += 1
    else if (kind === 'audio') audio += 1
    else if (kind === 'text') text += 1
  }
  return {
    total: image + video + audio + text,
    image,
    video,
    audio,
    text,
  }
}

export function buildVendorMetaMap(
  storedVendors: ReadonlyArray<Record<string, unknown>>,
): Map<string, OnboardingVendorMeta> {
  const metaMap = new Map<string, OnboardingVendorMeta>()
  for (const vendor of storedVendors) {
    const key = String(vendor.key || '')
    if (!key) continue
    metaMap.set(key, {
      name: String(vendor.name || key),
      hasApiKey: Boolean(vendor.hasApiKey),
      credentialMaterialSaved: vendor.credentialMaterialSaved === true,
      baseUrl: String(vendor.baseUrlHint || ''),
      enabled: vendor.enabled !== false,
      authType: String(vendor.authType || ''),
      customCallOnly: Boolean((vendor.meta as Record<string, unknown> | undefined)?.customCallOnly),
      fieldLossNoticeAt: vendorFieldLossNoticeAt(vendor),
      raw: vendor.meta,
    })
  }
  return metaMap
}

/**
 * 首屏主卡与收尾提示共用的唯一可用性判定：
 * 直接复用设置首页 `projectOnboardingConnections`（自动排除未填 Key 的内置供应商、未登录即梦与离线语音转写辅助），
 * 只要任一已接入家（含 APIMart 及其兄弟连接、别家 API、自定义中转、ComfyUI、本地模型、Codex 本地、已登录即梦）有可用模型，
 * 即视为老用户已有可用连接（`hasUsableModelConnection = true`），不出首屏主卡。
 */
export function deriveOnboardingConnectionAvailability({
  storedModels,
  storedVendors,
  dreaminaStatus = null,
}: {
  storedModels: ReadonlyArray<Record<string, unknown>>
  storedVendors: ReadonlyArray<Record<string, unknown>>
  dreaminaStatus?: DreaminaStatus | null
}): ResolvedAvailability {
  const vendorIdentities: VendorIdentityEntry[] = storedVendors.map((vendor) => ({
    key: typeof vendor.key === 'string' ? vendor.key : '',
    meta: vendor.meta,
  }))
  const vendorMeta = buildVendorMetaMap(storedVendors)
  const projected = projectModelSettingsCatalog([...storedModels])
  const { homeConnections } = projectOnboardingConnections({
    models: projected.models,
    vendorMeta,
    dreaminaStatus,
    localNames: { dreamina: 'Dreamina', codex: 'Codex', antigravity: 'Antigravity' },
    openPage: () => undefined,
  })

  const isConnectionUsable = (conn: (typeof homeConnections)[number]): boolean => {
    // 离线本地转写 sidecar（whisper.cpp，baseUrl=local://speech）在全新装机即默认 enabled:true + authType:none，
    // 它只是音频转写辅助而非用户已接入的生成/对话模型连接，不能把全新用户误判为老用户。
    if (isVendorOfBuiltin(vendorIdentities, conn.vendorKey, 'local-speech')) return false
    if (conn.vendorKey === DREAMINA_CONNECTION_KEY) return true
    if (conn.keyMissing) return false
    return conn.models.some((model) => model.availability?.usable === true)
  }

  const hasUsableModelConnection = homeConnections.some(isConnectionUsable)
  const apimartConnected = homeConnections.some(
    (conn) => isVendorOfBuiltin(vendorIdentities, conn.vendorKey, 'apimart') && isConnectionUsable(conn),
  )

  return {
    hasUsableModelConnection,
    apimartConnected,
    apimartCounts: countApimartCatalogModels(storedModels),
  }
}

async function fetchOnboardingModelAvailability(): Promise<ResolvedAvailability> {
  const bridge = getDesktopBridge()
  if (!bridge?.modelCatalog) return EMPTY_AVAILABILITY
  const [storedModels, storedVendors] = await Promise.all([
    bridge.modelCatalog.listModels() as Promise<Array<Record<string, unknown>>>,
    bridge.modelCatalog.listVendors() as Promise<Array<Record<string, unknown>>>,
  ])
  return deriveOnboardingConnectionAvailability({ storedModels, storedVendors })
}

let bridgeUnsubscribe: (() => void) | null = null
let windowListenerInstalled = false

function ensureCatalogChangeListeners(): void {
  if (typeof window === 'undefined') return
  if (!windowListenerInstalled) {
    windowListenerInstalled = true
    window.addEventListener('nomi-model-catalog-changed', () => {
      void mutate(ONBOARDING_AVAILABILITY_SWR_KEY)
    })
  }
  if (!bridgeUnsubscribe) {
    const onChanged = getDesktopBridge()?.modelCatalog?.onChanged
    if (typeof onChanged === 'function') {
      bridgeUnsubscribe = onChanged(() => {
        void mutate(ONBOARDING_AVAILABILITY_SWR_KEY)
      })
    }
  }
}

export async function refreshOnboardingModelAvailability(): Promise<void> {
  await mutate(ONBOARDING_AVAILABILITY_SWR_KEY)
}

export function useOnboardingModelAvailability(): OnboardingAvailabilitySnapshot {
  const hasBridge = Boolean(getDesktopBridge()?.modelCatalog)
  const { data } = useSWR<ResolvedAvailability>(
    hasBridge ? ONBOARDING_AVAILABILITY_SWR_KEY : null,
    fetchOnboardingModelAvailability,
    {
      revalidateOnMount: true,
      revalidateIfStale: false,
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
    },
  )

  React.useEffect(() => {
    ensureCatalogChangeListeners()
  }, [])

  if (!hasBridge) {
    return {
      loading: false,
      ...EMPTY_AVAILABILITY,
    }
  }

  if (!data) {
    return {
      loading: true,
      ...EMPTY_AVAILABILITY,
    }
  }

  return {
    loading: false,
    ...data,
  }
}
