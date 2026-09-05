// 去重模型选择 view-model（单一真相，节点/镜卡共用 —— P1 消除三处选模型不一致）。
//
// 把平铺的 ModelOption[] 收成「按 canonical 身份去重」的两段式选择：
//   ① 模型下拉：同模型只一条，多家供应商在行尾排成一列 chip；选中=自动选最优供应商（写其 value）。
//   ② 供应商下拉：仅当选中模型有多家可用时出现，让用户锁定某家（写该家 value）。
// 节点仍存 (vendor, modelKey)，生成路径与失败换家逻辑不变 —— 去重纯发生在选择层。
import React from 'react'
import type { ModelOption } from '../../config/models'
import type { NomiSelectOption } from '../../design'
import i18n from '../../i18n'
import { dedupeModelOptions, sortDedupedModelsByVendorPreference, sortModelProviders, type DedupedModel } from '../../config/modelIdentity'
import { useVendorPreferenceOrder } from './useVendorPreference'
import { isModelRecentlyAiling } from '../generationCanvas/runner/modelHealthMemory'
import { translateModelDisplayText } from '../../i18n/modelDisplayText'
import { modelIdentityIcon, providerIdentityIcon } from '../../config/modelProviderIdentity'

import type { ModelProviderRef } from '../../config/modelIdentity'

const VENDOR_LABELS: Record<string, string> = {
  volcengine: '火山方舟',
  'volcengine-speech': '火山语音',
  modelscope: '魔搭',
  apimart: 'APIMart',
  kie: 'Kie',
  newapi: 'new-api',
  runninghub: 'RunningHub',
  agnes: 'Agnes',
  replicate: 'Replicate',
  dreamina: '即梦',
  'comfyui-local': '本地 ComfyUI',
}

/** 厂商显示名：内置短名映射（下拉附注要短）> option.vendorName（自定义中转的真名）> key 原样。
 *  短名优先：catalog 里内置家的 name 是接入卡全称（如「即梦会员（本地 CLI）」），当 trailing 太啰嗦。 */
function providerLabel(provider?: ModelProviderRef | null): string {
  if (!provider) return translateModelDisplayText('默认')
  const short = provider.vendor ? VENDOR_LABELS[provider.vendor.toLowerCase()] : undefined
  if (short) return translateModelDisplayText(short)
  const fromCatalog = provider.option.vendorName?.trim()
  if (fromCatalog) return translateModelDisplayText(fromCatalog)
  return translateModelDisplayText(provider.vendor || '默认')
}

/** 该模型是否「病」了：**每一家**供应商都在避让期才算。注入判据便于纯函数单测。 */
type AilingProbe = (identity: { modelKey: unknown; vendor: unknown }) => boolean

/**
 * 「病」= 该模型每一家供应商近 24h 都连败 ≥2（modelHealthMemory 记的本地实测经验，不是写死名单；
 * 服务商修好后成功一次即清零回位）。
 *
 * 必须是**供应商级**而不是模型级：下拉里一条 = 去重后的模型，底下可能挂 2-4 家。只要还有一家健康，
 * pickHealthiestProvider 就会走那家，整条不该被标病——否则 Nano Banana 挂三家里的一家就误伤整个模型。
 */
function isModelAiling(model: DedupedModel, isAiling: AilingProbe): boolean {
  if (model.providers.length === 0) return false
  return model.providers.every((p) => isAiling({ modelKey: p.option.modelKey || p.option.value, vendor: p.vendor }))
}

/** 病的沉到最后 + 灰化 + 右侧标注换成「最近多次失败」；健康的保持原有顺序不动。 */
export function buildModelSelectOptions(deduped: readonly DedupedModel[], isAiling: AilingProbe, orderedVendorKeys: readonly string[] = []): NomiSelectOption[] {
  const ordered = sortDedupedModelsByVendorPreference(deduped, orderedVendorKeys)
  let unconfiguredHeadingUsed = false
  const toOption = (m: DedupedModel): NomiSelectOption => {
    // 「模型来自哪家」的两种表达，**同一行上只用一种**（用户 2026-07-17 要求看得见，
    // 2026-09-06 要求别把模型名挤没）：
    //   · 多家 → 行尾一排供应商 chip（第一个 = 当前生效那家，点别的当场换家）；
    //   · 单家 → 一条厂商短名附注（chip 只有一个的话点它没有任何意义，纯噪音）。
    // 曾经两种一起上（chip + 「N 家」附注），窄下拉里把模型名压到 0 宽——同一件事说两遍，
    // 代价却是主语没了。
    const providers = sortModelProviders(m.providers, orderedVendorKeys)
    const uniqueProviders = providers.filter((provider, index, all) => all.findIndex((candidate) => (candidate.vendor || candidate.option.value) === (provider.vendor || provider.option.value)) === index)
    const configured = providers.some((p) => p.option.configured !== false)
    const multiVendor = uniqueProviders.length > 1
    const chips = multiVendor
      ? uniqueProviders.map((provider, index) => ({
          value: providerAddress(provider),
          label: providerLabel(provider),
          active: index === 0,
          dimmed: provider.option.configured === false,
        }))
      : undefined
    const origin = !configured
      ? i18n.t('generationCommon.parameters.unconfigured')
      : providerLabel(providers[0])
    const sectionLabel = !configured && !unconfiguredHeadingUsed ? i18n.t('generationCommon.parameters.unconfiguredGroup') : undefined
    if (sectionLabel) unconfiguredHeadingUsed = true
    if (!isModelAiling(m, isAiling)) return {
      value: m.canonicalId,
      label: m.label,
      icon: modelIdentityIcon(m),
      ...(multiVendor ? { chips } : { trailing: origin }),
      ...(!configured ? { dimmed: true } : {}),
      ...(sectionLabel ? { sectionLabel } : {}),
    }
    // 「最近多次失败」是行级判断（每一家都在避让期才成立），压过 chip 的换家提示——
    // 这一行现在没有一家能走，摆一排可点的 chip 是在骗人。
    return {
      value: m.canonicalId,
      label: m.label,
      icon: modelIdentityIcon(m),
      trailing: i18n.t('generationCommon.parameters.recentlyFailing'),
      trailingTone: 'danger',
      dimmed: true,
      ...(sectionLabel ? { sectionLabel } : {}),
    }
  }
  // 用户选**之前**就避开坏的，而不是撞了才知道。仍可点（手动选择永不拦，2026-07-30 拍板）。
  const healthy = ordered.filter((m) => !isModelAiling(m, isAiling))
  const ailing = ordered.filter((m) => isModelAiling(m, isAiling))
  return [...healthy, ...ailing].map(toOption)
}

/**
 * 批量下拉专用：把去重模型**按供应商摊平**——一家一行，右侧标注永远是那一家的短名。
 *
 * 为什么不能复用 buildModelSelectOptions（用户 2026-08-18 报「框选没法选不同供应商 → 一直生成失败」）：
 * 那份把多家折叠成一条（行尾 chip 标出各家），选中后由第二段供应商下拉锁家。但批量下拉是**一次性命令**
 * （无常驻值、永远显占位「统一模型」），第二段结构上出不来 → pickHealthiestProvider 替用户定死一家；
 * 那家在他账号上不通 = 每次都失败且无路可换。摊平后「哪家」直接在第一段选，不需要第二段。
 *
 * 病态判据与折叠版**不同口径**：折叠版问「是不是每家都病」（还有一家健康就不该误伤整条）；
 * 这里一行 = 一家，直接按那一家判。病的仍可点（手动选择永不拦，2026-07-30 拍板），只沉底 + 灰化。
 */
export function buildVendorExplicitModelOptions(
  deduped: readonly DedupedModel[],
  isAiling: AilingProbe,
  orderedVendorKeys: readonly string[] = [],
): NomiSelectOption[] {
  type Row = { option: NomiSelectOption; ailing: boolean; configured: boolean }
  const rows: Row[] = []
  for (const model of deduped) {
    // 一「模型 × 供应商」一行 —— 折叠维度必须是 vendor，不能是 (vendor, option.value)。
    // 走查实测（2026-08-18）：同一家会把多个 modelKey 挂到同一个显示名
    // （kie 的 nano-banana / nano-banana-kie；kie 的 gpt-image-2-text-to-image /
    // gpt-image-2-image-to-image），按后者折叠会渲出**两行长得一模一样**的选项——
    // 用户分不清只能瞎猜，比选不了供应商更糟。这里与既有 buildProviderSelectOptions 的
    // byVendor 折叠同口径：用户锁的是「走哪家」，不是走这家的哪个内部 modelKey。
    const byVendor = new Map<string, ModelProviderRef[]>()
    const providers = orderedVendorKeys.length > 0 ? sortModelProviders(model.providers, orderedVendorKeys) : model.providers
    for (const provider of providers) {
      const key = provider.vendor || provider.option.value
      const bucket = byVendor.get(key)
      if (bucket) bucket.push(provider)
      else byVendor.set(key, [provider])
    }
    const sickOf = (p: ModelProviderRef): boolean => isAiling({ modelKey: p.option.modelKey || p.option.value, vendor: p.vendor })
    for (const bucket of byVendor.values()) {
      // 这家有健康变体就走健康那个；全病才落回首个（整行标病）。
      const representative = bucket.find((p) => !sickOf(p)) ?? bucket[0]
      const sick = sickOf(representative)
      const configured = representative.option.configured !== false
      const value = providerAddress(representative)
      rows.push({
        ailing: sick,
        configured,
        option: sick
          ? {
              value,
              label: model.label,
              trailing: i18n.t('generationCommon.parameters.recentlyFailing'),
              trailingTone: 'danger',
              dimmed: true,
            }
          : {
              value,
              label: model.label,
              icon: modelIdentityIcon(model),
              trailing: configured ? providerLabel(representative) : i18n.t('generationCommon.parameters.unconfigured'),
              ...(configured ? {} : { dimmed: true }),
            },
      })
    }
  }
  // 三段：能跑的 → 最近连败的 → 没配 key 的。与折叠版同一套沉底口径（同一件事只有一种排法）。
  // 没配 key 的那段仍然列出来（点了跳接入，见 BulkModelPicker），但绝不许排在能跑的前面。
  const ordered = [
    ...rows.filter((row) => row.configured && !row.ailing),
    ...rows.filter((row) => row.configured && row.ailing),
    ...rows.filter((row) => !row.configured),
  ]
  let unconfiguredHeadingUsed = false
  return ordered.map((row) => {
    if (row.configured || unconfiguredHeadingUsed) return row.option
    unconfiguredHeadingUsed = true
    return { ...row.option, sectionLabel: i18n.t('generationCommon.parameters.unconfiguredGroup') }
  })
}

/** 该寻址串指向的那一家有没有配 key。批量下拉靠它把「点了跳接入」和「真的选中」分开。 */
export function providerIsConfigured(deduped: readonly DedupedModel[], addressValue: string): boolean {
  const provider = resolveProviderByAddress(deduped, addressValue)
  return provider ? provider.option.configured !== false : true
}

/** buildVendorExplicitModelOptions 的反查：复合寻址串 → 那一家供应商（认不出 → null，调用方不写）。 */
export function resolveProviderByAddress(
  deduped: readonly DedupedModel[],
  addressValue: string,
): ModelProviderRef | null {
  if (!addressValue) return null
  for (const model of deduped) {
    const hit = model.providers.find((p) => providerAddress(p) === addressValue)
    if (hit) return hit
  }
  return null
}

/** 换家优先于换模型：先只在健康供应商里挑；全病（用户明知故选）才回退全集，绝不空选。 */
export function pickHealthiestProvider(model: DedupedModel, isAiling: AilingProbe, orderedVendorKeys: readonly string[] = []): ModelProviderRef | null {
  const healthy = sortModelProviders(model.providers.filter((provider) => !isAiling({ modelKey: provider.option.modelKey || provider.option.value, vendor: provider.vendor })), orderedVendorKeys)
  return healthy[0] || sortModelProviders(model.providers, orderedVendorKeys)[0] || null
}

// ── 供应商锁定下拉的寻址 ──
// 下拉项的 value 不能用裸 option.value：两个中转站可以提供同名模型（modelKey 相同），
// 裸值会让两项撞值——选哪家都分不清、当前锁定哪家也显示不出。用 vendor+value 复合串寻址。
const PROVIDER_ADDRESS_SEP = '\u0000'

export function providerAddress(p: ModelProviderRef): string {
  return `${p.vendor || ''}${PROVIDER_ADDRESS_SEP}${p.option.value}`
}

/** 供应商下拉选项：按 vendor 折叠（用户锁的是「走哪家」），value=复合寻址串。仅多家时非空。 */
export function buildProviderSelectOptions(model: DedupedModel | null, orderedVendorKeys: readonly string[] = []): Array<NomiSelectOption & { vendor?: string }> {
  if (!model || model.providers.length <= 1) return []
  const byVendor = new Map<string, NomiSelectOption & { vendor?: string }>()
  let unconfiguredHeadingUsed = false
  for (const p of sortModelProviders(model.providers, orderedVendorKeys)) {
    const key = p.vendor || p.option.value
    if (!byVendor.has(key)) byVendor.set(key, {
      value: providerAddress(p),
      label: providerLabel(p),
      icon: providerIdentityIcon(p.vendor, p.option.vendorName),
      vendor: p.vendor,
      ...(p.option.configured === false ? {
        trailing: i18n.t('generationCommon.parameters.unconfigured'),
        dimmed: true,
        ...(!unconfiguredHeadingUsed ? { sectionLabel: i18n.t('generationCommon.parameters.unconfiguredGroup') } : {}),
      } : {}),
    })
    if (p.option.configured === false) unconfiguredHeadingUsed = true
  }
  return byVendor.size > 1 ? [...byVendor.values()] : []
}

/** 当前生效供应商的复合寻址串：优先 (value, vendor) 双键命中；vendor 缺失/没命中回退首个同 value 家。 */
export function resolveProviderSelectValue(
  model: DedupedModel | null,
  value: string,
  vendor?: string | null,
): string {
  if (!model) return value
  const sameValue = model.providers.filter((p) => p.option.value === value)
  if (sameValue.length === 0) return value
  const locked = vendor ? sameValue.find((p) => p.vendor === vendor) : undefined
  return providerAddress(locked || sameValue[0])
}

export interface DedupedModelSelectView {
  /** 去重后的模型下拉选项（value=canonicalId；多家的行尾带供应商 chip）。 */
  modelOptions: NomiSelectOption[]
  /** 当前选中模型的 canonicalId（无则空串）。 */
  modelValue: string
  /** 选模型：解析最优供应商后回写其 (option.value, vendor) 给原 onChange。 */
  onModelPick: (canonicalId: string) => void
  /** 点模型行尾供应商 chip：这次直接使用该家，未配置则打开接入页。 */
  onModelProviderPick: (canonicalId: string, addressValue: string) => void
  /** 供应商下拉选项（仅多家时非空）。value=vendor+option.value 复合寻址串（同名 modelKey 跨厂商不撞值）。 */
  providerOptions: NomiSelectOption[]
  /** 当前锁定/生效供应商的复合寻址串。 */
  providerValue: string
  /** 锁定某家供应商：解析寻址串后回写该家 (option.value, vendor)。 */
  onProviderPick: (addressValue: string) => void
  /** Exact enabled catalog variants for the selected supplier; no synthetic model IDs. */
  variantOptions: NomiSelectOption[]
  variantValue: string
  onVariantPick: (addressValue: string) => void
  /** 当前选中的去重模型（供上层取档案/变体等）。 */
  selectedModel: DedupedModel | null
}

/**
 * @param modelOptions 该 kind 下全部已接入模型（平铺）
 * @param value        当前节点存的 option.value（某具体供应商的 modelKey）
 * @param onChange     原选模型回调（接收 option.value + 该家 vendor，写 node.meta 的 vendor+modelKey）
 * @param vendor       当前节点存的供应商 key（同名 modelKey 跨厂商时区分锁定哪家；缺省=首家）
 */
export function useDedupedModelSelect(
  modelOptions: readonly ModelOption[],
  value: string,
  onChange: (value: string, vendor?: string) => void,
  vendor?: string | null,
): DedupedModelSelectView {
  const deduped = React.useMemo(() => dedupeModelOptions([...modelOptions]), [modelOptions])
  const orderedVendorKeys = useVendorPreferenceOrder()

  const selectedModel = React.useMemo(
    () => deduped.find((m) => m.providers.some((p) => p.option.value === value && (!vendor || p.vendor === vendor))) || null,
    [deduped, value, vendor],
  )

  const modelOptionsView = React.useMemo<NomiSelectOption[]>(
    () => buildModelSelectOptions(deduped, isModelRecentlyAiling, orderedVendorKeys),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- i18n.language：切语言要重算 trailing 文案
    [deduped, i18n.language, orderedVendorKeys],
  )

  const onModelPick = React.useCallback(
    (canonicalId: string) => {
      const model = deduped.find((m) => m.canonicalId === canonicalId)
      if (!model) return
      // Reopening/reselecting the family must not reset a saved reasoning tier.
      const current = model.providers.find((p) => p.option.value === value && (!vendor || p.vendor === vendor))
      if (current) { onChange(current.option.value, current.vendor); return }
      const best = pickHealthiestProvider(model, isModelRecentlyAiling, orderedVendorKeys)
      const preferred = model.providers.find((p) => p.vendor === best?.vendor && p.option.variant?.defaultVariant) || best
      if (preferred && preferred.option.configured !== false) onChange(preferred.option.value, preferred.vendor)
      else if (typeof window !== 'undefined') window.dispatchEvent(new Event('nomi-open-model-catalog'))
    },
    [deduped, onChange, value, vendor, orderedVendorKeys],
  )

  const onModelProviderPick = React.useCallback(
    (canonicalId: string, addressValue: string) => {
      const model = deduped.find((candidate) => candidate.canonicalId === canonicalId)
      const picked = model?.providers.find((provider) => providerAddress(provider) === addressValue)
      if (!picked) return
      if (picked.option.configured === false) {
        if (typeof window !== 'undefined') window.dispatchEvent(new Event('nomi-open-model-catalog'))
        return
      }
      onChange(picked.option.value, picked.vendor)
    },
    [deduped, onChange],
  )

  const providerOptionsView = React.useMemo<NomiSelectOption[]>(
    () => buildProviderSelectOptions(selectedModel, orderedVendorKeys),
    [selectedModel, orderedVendorKeys],
  )

  const onProviderPick = React.useCallback(
    (addressValue: string) => {
      const picked = selectedModel?.providers.find((p) => providerAddress(p) === addressValue)
      if (picked?.option.configured === false) { if (typeof window !== 'undefined') window.dispatchEvent(new Event('nomi-open-model-catalog')); return }
      if (picked) onChange(picked.option.value, picked.vendor)
    },
    [selectedModel, onChange],
  )

  const providerValue = resolveProviderSelectValue(selectedModel, value, vendor)
  const selectedProvider = selectedModel?.providers.find((p) => providerAddress(p) === providerValue)
  const variantOptions = selectedProvider?.option.variant
    ? (selectedModel?.providers || [])
        .filter((p) => p.vendor === selectedProvider.vendor && p.option.variant)
        .map((p) => ({ value: providerAddress(p), label: p.option.variant!.variantLabel }))
    : []
  const onVariantPick = (addressValue: string): void => {
    if (variantOptions.some((option) => option.value === addressValue)) onProviderPick(addressValue)
  }

  return {
    modelOptions: modelOptionsView,
    modelValue: selectedModel?.canonicalId || '',
    onModelPick,
    onModelProviderPick,
    providerOptions: providerOptionsView,
    providerValue,
    onProviderPick,
    variantOptions,
    variantValue: selectedProvider ? providerAddress(selectedProvider) : '',
    onVariantPick,
    selectedModel,
  }
}
