import React from 'react'
import type { Mapping } from '../../../electron/catalog/types'
import type { ModelCatalogVendorCredentialMode } from '../../api/desktopClient'
import { notifyModelOptionsRefresh } from '../../config/useModelOptions'
import { getDesktopBridge } from '../../desktop/bridge'
import type { DreaminaStatus } from './DreaminaMemberCard'
import type { ChipModel } from './ModelChipGroups'
import { projectModelSettingsCatalog } from './modelSettingsCatalogProjection'

export type OnboardingVendorMeta = {
  name: string
  hasApiKey: boolean
  baseUrl: string
  enabled: boolean
  authType: string
  customCallOnly: boolean
  /** Derived by the desktop catalog; absent for custom vendors (fail closed). */
  credentialMode?: ModelCatalogVendorCredentialMode
}

const MAX_BRIDGE_RETRIES = 5
const BRIDGE_RETRY_MS = 400
const DREAMINA_UNCHECKED_STATUS: DreaminaStatus = {
  installed: false,
  loggedIn: false,
  totalCredit: null,
  vipLevel: '',
  notMaestroVip: false,
}

export function useOnboardingDrawerCatalog(): {
  models: ChipModel[]
  mappings: Mapping[]
  vendorMeta: Map<string, OnboardingVendorMeta>
  customCallScripts: Map<string, string>
  dreaminaStatus: DreaminaStatus | null
  loaded: boolean
  bridgeMissing: boolean
  reloadFromError: () => void
  refresh: () => void
} {
  const [models, setModels] = React.useState<ChipModel[]>([])
  const [mappings, setMappings] = React.useState<Mapping[]>([])
  const [vendorMeta, setVendorMeta] = React.useState<Map<string, OnboardingVendorMeta>>(new Map())
  const [customCallScripts, setCustomCallScripts] = React.useState<Map<string, string>>(new Map())
  const [dreaminaStatus, setDreaminaStatus] = React.useState<DreaminaStatus | null>(null)
  const [loaded, setLoaded] = React.useState(false)
  const [bridgeMissing, setBridgeMissing] = React.useState(false)
  const bridgeRetries = React.useRef(0)
  const [version, setVersion] = React.useState(0)

  React.useEffect(() => {
    const bridge = getDesktopBridge()
    if (!bridge) {
      if (bridgeRetries.current < MAX_BRIDGE_RETRIES) {
        bridgeRetries.current += 1
        const timer = setTimeout(() => setVersion((value) => value + 1), BRIDGE_RETRY_MS)
        return () => clearTimeout(timer)
      }
      setBridgeMissing(true)
      setLoaded(true)
      return
    }
    bridgeRetries.current = 0
    setBridgeMissing(false)
    try {
      const storedModels = bridge.modelCatalog.listModels() as Array<Record<string, unknown>>
      const storedVendors = bridge.modelCatalog.listVendors() as Array<Record<string, unknown>>
      const storedMappings = bridge.modelCatalog.listMappings() as Mapping[]
      const metaMap = new Map<string, OnboardingVendorMeta>()
      for (const vendor of storedVendors) {
        const credentialMode: ModelCatalogVendorCredentialMode | undefined =
          vendor.credentialMode === 'direct-key' || vendor.credentialMode === 'certification'
            ? vendor.credentialMode
            : undefined
        metaMap.set(String(vendor.key), {
          name: String(vendor.name || vendor.key),
          hasApiKey: Boolean(vendor.hasApiKey),
          baseUrl: String(vendor.baseUrlHint || ''),
          enabled: vendor.enabled !== false,
          authType: String(vendor.authType || ''),
          customCallOnly: Boolean((vendor.meta as Record<string, unknown> | undefined)?.customCallOnly),
          ...(credentialMode ? { credentialMode } : {}),
        })
      }
      const projectedCatalog = projectModelSettingsCatalog(storedModels)
      setCustomCallScripts(projectedCatalog.fallbackScripts)
      setVendorMeta(metaMap)
      setModels(projectedCatalog.models)
      setMappings(storedMappings)
    } catch {
      setVendorMeta(new Map())
      setModels([])
      setMappings([])
    }
    setLoaded(true)
    let alive = true
    const dreamina = bridge.dreamina
    if (dreamina) {
      setDreaminaStatus((current) => current ?? DREAMINA_UNCHECKED_STATUS)
      dreamina.status()
        .then((status) => { if (alive) setDreaminaStatus(status as DreaminaStatus) })
        .catch(() => { if (alive) setDreaminaStatus((current) => current ?? DREAMINA_UNCHECKED_STATUS) })
    } else {
      setDreaminaStatus(null)
    }
    return () => { alive = false }
  }, [version])

  const reloadFromError = React.useCallback(() => {
    bridgeRetries.current = 0
    setBridgeMissing(false)
    setLoaded(false)
    setVersion((value) => value + 1)
  }, [])

  const refresh = React.useCallback(() => {
    notifyModelOptionsRefresh('all')
    setVersion((value) => value + 1)
    window.dispatchEvent(new CustomEvent('nomi-model-catalog-changed'))
  }, [])

  return {
    models,
    mappings,
    vendorMeta,
    customCallScripts,
    dreaminaStatus,
    loaded,
    bridgeMissing,
    reloadFromError,
    refresh,
  }
}
