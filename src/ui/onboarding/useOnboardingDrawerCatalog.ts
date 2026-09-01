import React from 'react'
import type { Mapping } from '../../../electron/catalog/types'
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
  /**
   * 非 null = 盘上目录格式比本构建新，主进程已拒绝一切写回（防静默降级）。
   * 此时「启用供应商 / 存 key / 改地址 / 增删模型」全都不会生效，设置页必须明说，
   * 否则用户只看到点了没反应——这正是 2026-09-01 修的那类哑控件。
   */
  catalogReadOnly: { diskVersion: number; appVersion: number } | null
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
  const [catalogReadOnly, setCatalogReadOnly] = React.useState<{ diskVersion: number; appVersion: number } | null>(null)
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
    // 只读态单独一个 try：它失败绝不能连累主目录读取（否则整页模型清空 = 比没提示更糟）。
    // 版本号从主进程 health derive，不在渲染层重算版本比较——避免第二份真相源。
    try {
      const health = bridge.modelCatalog.health() as {
        writable?: boolean
        diskVersion?: number
        appVersion?: number
      } | null
      setCatalogReadOnly(
        health && health.writable === false
          ? { diskVersion: Number(health.diskVersion), appVersion: Number(health.appVersion) }
          : null,
      )
    } catch {
      setCatalogReadOnly(null)
    }
    try {
      const storedModels = bridge.modelCatalog.listModels() as Array<Record<string, unknown>>
      const storedVendors = bridge.modelCatalog.listVendors() as Array<Record<string, unknown>>
      const storedMappings = bridge.modelCatalog.listMappings() as Mapping[]
      const metaMap = new Map<string, OnboardingVendorMeta>()
      for (const vendor of storedVendors) {
        metaMap.set(String(vendor.key), {
          name: String(vendor.name || vendor.key),
          hasApiKey: Boolean(vendor.hasApiKey),
          baseUrl: String(vendor.baseUrlHint || ''),
          enabled: vendor.enabled !== false,
          authType: String(vendor.authType || ''),
          customCallOnly: Boolean((vendor.meta as Record<string, unknown> | undefined)?.customCallOnly),
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
    catalogReadOnly,
    reloadFromError,
    refresh,
  }
}
