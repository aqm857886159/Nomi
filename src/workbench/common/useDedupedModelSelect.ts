// 去重模型选择 view-model（单一真相，节点/镜卡共用 —— P1 消除三处选模型不一致）。
//
// 把平铺的 ModelOption[] 收成「按 canonical 身份去重」的两段式选择：
//   ① 模型下拉：同模型只一条，>1 家供应商标「N 家」；选中=自动选最优供应商（写其 value）。
//   ② 供应商下拉：仅当选中模型有多家可用时出现，让用户锁定某家（写该家 value）。
// 节点仍存 (vendor, modelKey)，生成路径与失败换家逻辑不变 —— 去重纯发生在选择层。
import React from 'react'
import type { ModelOption } from '../../config/models'
import type { NomiSelectOption } from '../../design'
import { dedupeModelOptions, resolveBestProvider, type DedupedModel } from '../../config/modelIdentity'

const VENDOR_LABELS: Record<string, string> = {
  volcengine: '火山方舟',
  modelscope: '魔搭',
  apimart: 'APIMart',
  kie: 'Kie',
  newapi: 'new-api',
}

function vendorLabel(vendor?: string): string {
  if (!vendor) return '默认'
  return VENDOR_LABELS[vendor.toLowerCase()] || vendor
}

export interface DedupedModelSelectView {
  /** 去重后的模型下拉选项（value=canonicalId，trailing 标「N 家」）。 */
  modelOptions: NomiSelectOption[]
  /** 当前选中模型的 canonicalId（无则空串）。 */
  modelValue: string
  /** 选模型：解析最优供应商后回写其 option.value 给原 onChange。 */
  onModelPick: (canonicalId: string) => void
  /** 供应商下拉选项（仅多家时非空）。value=该供应商 option.value。 */
  providerOptions: NomiSelectOption[]
  /** 当前锁定/生效的供应商 option.value。 */
  providerValue: string
  /** 锁定某家供应商：直接回写该家 option.value。 */
  onProviderPick: (optionValue: string) => void
  /** 当前选中的去重模型（供上层取档案/变体等）。 */
  selectedModel: DedupedModel | null
}

/**
 * @param modelOptions 该 kind 下全部已接入模型（平铺）
 * @param value        当前节点存的 option.value（某具体供应商的 modelKey）
 * @param onChange     原选模型回调（接收 option.value，写 node.meta 的 vendor+modelKey）
 */
export function useDedupedModelSelect(
  modelOptions: readonly ModelOption[],
  value: string,
  onChange: (value: string) => void,
): DedupedModelSelectView {
  const deduped = React.useMemo(() => dedupeModelOptions([...modelOptions]), [modelOptions])

  const selectedModel = React.useMemo(
    () => deduped.find((m) => m.providers.some((p) => p.option.value === value)) || null,
    [deduped, value],
  )

  const modelOptionsView = React.useMemo<NomiSelectOption[]>(
    () =>
      deduped.map((m) => ({
        value: m.canonicalId,
        label: m.label,
        trailing: m.providers.length > 1 ? `${m.providers.length} 家` : undefined,
      })),
    [deduped],
  )

  const onModelPick = React.useCallback(
    (canonicalId: string) => {
      const model = deduped.find((m) => m.canonicalId === canonicalId)
      if (!model) return
      const best = resolveBestProvider(model)
      if (best) onChange(best.option.value)
    },
    [deduped, onChange],
  )

  const providerOptionsView = React.useMemo<NomiSelectOption[]>(() => {
    if (!selectedModel || selectedModel.providers.length <= 1) return []
    // 同一供应商对同一模型若有多条（多 modelKey），锁定列表按 vendor 折叠成一行（取首条）——
    // 用户锁的是「走哪家」，不该看到同名供应商重复。
    const byVendor = new Map<string, NomiSelectOption>()
    for (const p of selectedModel.providers) {
      const key = p.vendor || p.option.value
      if (!byVendor.has(key)) byVendor.set(key, { value: p.option.value, label: vendorLabel(p.vendor) })
    }
    return byVendor.size > 1 ? [...byVendor.values()] : []
  }, [selectedModel])

  return {
    modelOptions: modelOptionsView,
    modelValue: selectedModel?.canonicalId || '',
    onModelPick,
    providerOptions: providerOptionsView,
    providerValue: value,
    onProviderPick: onChange,
    selectedModel,
  }
}
