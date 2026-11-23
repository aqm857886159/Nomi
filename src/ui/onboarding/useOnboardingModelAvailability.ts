import React from 'react'
import { getDesktopBridge } from '../../desktop/bridge'
import { vendorFieldLossNoticeAt } from '../../../electron/shared/vendorFieldLossNotice'
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

const EMPTY_COUNTS: ApimartCatalogCounts = {
  total: 0,
  image: 0,
  video: 0,
  audio: 0,
  text: 0,
}

/**
 * 按 `numbers.runtime-counts` 实时统计 APIMart 目录模型数：
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
    if (String(row.vendorKey || '') !== 'apimart') continue
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
 * 只要任一已接入家（含 APIMart、别家 API、自定义中转、ComfyUI、本地模型、Codex 本地、已登录即梦）有可用模型，
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
}): Omit<OnboardingAvailabilitySnapshot, 'loading'> {
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
    if (conn.vendorKey === 'local-speech') return false
    if (conn.vendorKey === DREAMINA_CONNECTION_KEY) return true
    if (conn.keyMissing) return false
    return conn.models.some((model) => model.availability?.usable === true)
  }

  const hasUsableModelConnection = homeConnections.some(isConnectionUsable)
  const apimartConnected = homeConnections.some(
    (conn) => conn.vendorKey === 'apimart' && isConnectionUsable(conn),
  )

  return {
    hasUsableModelConnection,
    apimartConnected,
    apimartCounts: countApimartCatalogModels(storedModels),
  }
}

let cachedSnapshot: OnboardingAvailabilitySnapshot | null = null
let inflightRead: Promise<OnboardingAvailabilitySnapshot> | null = null
const subscribers = new Set<(snapshot: OnboardingAvailabilitySnapshot) => void>()
let bridgeUnsubscribe: (() => void) | null = null
let windowListenerInstalled = false

function emitSnapshot(next: OnboardingAvailabilitySnapshot): void {
  cachedSnapshot = next
  for (const listener of subscribers) listener(next)
}

export function resetOnboardingAvailabilityCacheForTest(): void {
  cachedSnapshot = null
  inflightRead = null
}

/** 同步读取当前已落定的可用连接布尔值；尚未落定时返回 false。 */
export function hasCachedUsableModelConnection(): boolean {
  return cachedSnapshot?.hasUsableModelConnection === true
}

export async function refreshOnboardingModelAvailability(): Promise<OnboardingAvailabilitySnapshot> {
  const bridge = getDesktopBridge()
  if (!bridge?.modelCatalog) {
    const fallback: OnboardingAvailabilitySnapshot = {
      loading: false,
      hasUsableModelConnection: false,
      apimartConnected: false,
      apimartCounts: EMPTY_COUNTS,
    }
    emitSnapshot(fallback)
    return fallback
  }
  if (inflightRead) return inflightRead
  inflightRead = (async () => {
    try {
      const [storedModels, storedVendors] = await Promise.all([
        bridge.modelCatalog.listModels() as Promise<Array<Record<string, unknown>>>,
        bridge.modelCatalog.listVendors() as Promise<Array<Record<string, unknown>>>,
      ])
      const derived = deriveOnboardingConnectionAvailability({ storedModels, storedVendors })
      const resolved: OnboardingAvailabilitySnapshot = {
        loading: false,
        ...derived,
      }
      emitSnapshot(resolved)
      return resolved
    } catch {
      const fallback: OnboardingAvailabilitySnapshot = cachedSnapshot
        ? { ...cachedSnapshot, loading: false }
        : {
            loading: false,
            hasUsableModelConnection: false,
            apimartConnected: false,
            apimartCounts: EMPTY_COUNTS,
          }
      emitSnapshot(fallback)
      return fallback
    } finally {
      inflightRead = null
    }
  })()
  return inflightRead
}

function ensureGlobalListeners(): void {
  if (typeof window === 'undefined') return
  if (!windowListenerInstalled) {
    windowListenerInstalled = true
    window.addEventListener('nomi-model-catalog-changed', () => {
      void refreshOnboardingModelAvailability()
    })
  }
  if (!bridgeUnsubscribe) {
    const onChanged = getDesktopBridge()?.modelCatalog?.onChanged
    if (typeof onChanged === 'function') {
      bridgeUnsubscribe = onChanged(() => {
        void refreshOnboardingModelAvailability()
      })
    }
  }
}

export function useOnboardingModelAvailability(): OnboardingAvailabilitySnapshot {
  const [snapshot, setSnapshot] = React.useState<OnboardingAvailabilitySnapshot>(() => {
    if (cachedSnapshot) return cachedSnapshot
    const hasBridge = Boolean(getDesktopBridge()?.modelCatalog)
    return {
      loading: hasBridge,
      hasUsableModelConnection: false,
      apimartConnected: false,
      apimartCounts: EMPTY_COUNTS,
    }
  })

  React.useEffect(() => {
    ensureGlobalListeners()
    subscribers.add(setSnapshot)
    if (!cachedSnapshot || cachedSnapshot.loading) {
      void refreshOnboardingModelAvailability()
    } else {
      setSnapshot(cachedSnapshot)
    }
    return () => {
      subscribers.delete(setSnapshot)
    }
  }, [])

  return snapshot
}
