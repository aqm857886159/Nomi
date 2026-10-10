import { useEffect, useState } from 'react'
import type { ModelCatalogHealthDto } from '../workbench/api/modelCatalogApi'
import type { ModelOption, NodeKind } from './models'
import {
  deriveModelCatalogStatus,
  normalizeCatalogLoadError,
  type ModelCatalogStatus,
} from './modelCatalogStatus'
import {
  MODEL_REFRESH_EVENT,
  getCatalogHealth,
  peekCatalogModelOptions,
  preloadModelOptions,
  type ModelQueryMode,
} from './modelCatalogCache'

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
 * `keepUsableModelRows` 挡掉了（2026-09-06 用户拍板），这里没有放宽口，调用方也不需要自己再滤。
 */
export function useModelOptionsState(kind?: NodeKind, requiredMode?: ModelQueryMode): ModelOptionsState {
  // 同步首值：缓存里有就直接当初始 state（选中节点时 composer 重新挂载也拿得到），
  // 免得第一帧画「无模型·配置模型」（2026-10-11 走查第 4 条）。
  const [options, setOptions] = useState<ModelOption[]>(() => peekCatalogModelOptions(kind, requiredMode) ?? [])
  const [error, setError] = useState<Error | null>(null)
  const [healthError, setHealthError] = useState<Error | null>(null)
  const [health, setHealth] = useState<ModelCatalogHealthDto | null>(null)
  const [loading, setLoading] = useState(() => peekCatalogModelOptions(kind, requiredMode) === null)
  const [refreshSeq, setRefreshSeq] = useState(0)

  useEffect(() => {
    const cached = peekCatalogModelOptions(kind, requiredMode)
    if (cached) {
      // 有缓存就别归零：归零会让界面退回到「无模型」那一帧。
      setOptions(cached)
      setLoading(false)
      return
    }
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
    // 已有缓存值时**不要**翻回 loading：那会把真实芯片换成骨架（同一类闪烁的另一面）。
    if (!peekCatalogModelOptions(kind, requiredMode)) setLoading(true)
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

export function useModelOptions(kind?: NodeKind, requiredMode?: ModelQueryMode): ModelOption[] {
  const state = useModelOptionsState(kind, requiredMode)
  if (state.error) throw state.error

  return state.options
}
