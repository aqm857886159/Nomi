import { useEffect, useState } from 'react'
import type { ModelCatalogHealthDto, ProfileKind } from '../workbench/api/modelCatalogApi'
import type { ModelOption, NodeKind } from './models'
import {
  deriveModelCatalogStatus,
  normalizeCatalogLoadError,
  type ModelCatalogStatus,
} from './modelCatalogStatus'
import { MODEL_REFRESH_EVENT, getCatalogHealth, preloadModelOptions, type CatalogOptionScope } from './modelCatalogCache'

// 重导出：实现已拆到兄弟模块（resolvers / mappers / status / cache），
// 但 useModelOptions.ts 对外公共导出面保持不变，外部 import 路径无需改动。
export {
  MODEL_REFRESH_EVENT,
  filterHiddenOptionsByKind,
  notifyModelOptionsRefresh,
  preloadModelOptions,
  resolveExecutableImageModel,
  MODEL_PICKER_CATALOG_SCOPE,
  type CatalogOptionScope,
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
 * @param scope 缺省 = 只要「现在就能跑」的模型（见 modelCatalogCache 的 CatalogOptionScope）。
 *   只有把未配置的家灰显出来、并且点了会跳接入的选择器才传 `{ includeUnconfigured: true }`。
 */
export function useModelOptionsState(kind?: NodeKind, requiredMode?: ProfileKind, scope?: CatalogOptionScope): ModelOptionsState {
  const [options, setOptions] = useState<ModelOption[]>([])
  const [error, setError] = useState<Error | null>(null)
  const [healthError, setHealthError] = useState<Error | null>(null)
  const [health, setHealth] = useState<ModelCatalogHealthDto | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshSeq, setRefreshSeq] = useState(0)
  // 解构成标量再进依赖数组：`scope` 多半是调用点的字面量对象，每次渲染都是新引用，
  // 直接进依赖 = 每帧重取一次 catalog。
  const includeUnconfigured = scope?.includeUnconfigured === true

  useEffect(() => {
    setOptions([])
    setError(null)
    setHealthError(null)
    setHealth(null)
    setLoading(true)
  }, [kind, requiredMode, includeUnconfigured])

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
        const catalogOptions = await preloadModelOptions(kind, requiredMode, { includeUnconfigured })
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
  }, [kind, requiredMode, includeUnconfigured, refreshSeq])

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

export function useModelOptions(kind?: NodeKind, requiredMode?: ProfileKind, scope?: CatalogOptionScope): ModelOption[] {
  const state = useModelOptionsState(kind, requiredMode, scope)
  if (state.error) throw state.error

  return state.options
}
