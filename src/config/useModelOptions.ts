import { useEffect, useState } from 'react'
import type { ModelCatalogHealthDto, ProfileKind } from '../workbench/api/modelCatalogApi'
import type { ModelOption, NodeKind } from './models'
import {
  deriveModelCatalogStatus,
  normalizeCatalogLoadError,
  type ModelCatalogStatus,
} from './modelCatalogStatus'
import { MODEL_REFRESH_EVENT, getCatalogHealth, preloadModelOptions } from './modelCatalogCache'

// 重导出：实现已拆到兄弟模块（resolvers / mappers / status / cache），
// 但 useModelOptions.ts 对外公共导出面保持不变，外部 import 路径无需改动。
export {
  MODEL_REFRESH_EVENT,
  filterHiddenOptionsByKind,
  notifyModelOptionsRefresh,
  preloadModelOptions,
  resolveExecutableImageModel,
} from './modelCatalogCache'
export {
  deriveModelCatalogStatus,
  normalizeCatalogLoadError,
  type ModelCatalogStatus,
} from './modelCatalogStatus'
export {
  inferImageModelVendor,
  findModelOptionByIdentifier,
  getModelOptionRequestAlias,
  resolveExecutableImageModelFromOptions,
  type ResolvedExecutableImageModel,
} from './modelOptionResolvers'
export { toCatalogModelOptions } from './modelOptionMappers'

export type ModelOptionsState = {
  options: ModelOption[]
  error: Error | null
  healthError: Error | null
  loading: boolean
  health: ModelCatalogHealthDto | null
  status: ModelCatalogStatus
  statusMessage: string
}

/**
 * 拿到的永远是「现在就能跑」的那一份：没接入的供应商在 catalog 派生层就被
 * `keepRunnableVendorOptions` 挡掉了（2026-09-06 用户拍板），这里没有放宽口，调用方也不需要自己再滤。
 */
export function useModelOptionsState(kind?: NodeKind, requiredMode?: ProfileKind): ModelOptionsState {
  const [options, setOptions] = useState<ModelOption[]>([])
  const [error, setError] = useState<Error | null>(null)
  const [healthError, setHealthError] = useState<Error | null>(null)
  const [health, setHealth] = useState<ModelCatalogHealthDto | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshSeq, setRefreshSeq] = useState(0)

  useEffect(() => {
    setOptions([])
    setError(null)
    setHealthError(null)
    setHealth(null)
    setLoading(true)
  }, [kind, requiredMode])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const handler = () => setRefreshSeq((prev) => prev + 1)
    window.addEventListener(MODEL_REFRESH_EVENT, handler)
    return () => window.removeEventListener(MODEL_REFRESH_EVENT, handler)
  }, [])

  useEffect(() => {
    let canceled = false
    setLoading(true)
    ;(async () => {
      try {
        const catalogOptions = await preloadModelOptions(kind, requiredMode)
        if (!canceled) {
          setError(null)
          setOptions(catalogOptions)
        }
      } catch (caught: unknown) {
      if (!canceled) {
        setError(normalizeCatalogLoadError(caught))
        setOptions([])
        setHealthError(null)
        setHealth(null)
      }
      }
      try {
        const catalogHealth = await getCatalogHealth()
        if (!canceled) {
          setHealth(catalogHealth)
          setHealthError(null)
        }
      } catch (caught: unknown) {
        if (!canceled) {
          setHealth(null)
          setHealthError(normalizeCatalogLoadError(caught))
        }
      }
      if (!canceled) {
        setLoading(false)
      }
    })()

    return () => {
      canceled = true
    }
  }, [kind, requiredMode, refreshSeq])

  const derived = deriveModelCatalogStatus({ kind, options, health, error, healthError, loading })
  return {
    options,
    error,
    healthError,
    loading,
    health,
    status: derived.status,
    statusMessage: derived.message,
  }
}

export function useModelOptions(kind?: NodeKind, requiredMode?: ProfileKind): ModelOption[] {
  const state = useModelOptionsState(kind, requiredMode)
  if (state.error) throw state.error

  return state.options
}
