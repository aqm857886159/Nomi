import type { ModelCatalogModelDto } from '../workbench/api/modelCatalogApi'
import type { ModelOption, ModelOptionPricing } from './models'
import { archetypeParameterControls } from './modelArchetypes'
import { ANTIGRAVITY_VENDOR_KEY } from '../../electron/shared/antigravity'
import { getAntigravityModelVariant } from '../../electron/shared/antigravityModelVariants'

/**
 * 目录里那一行的价目 → 渲染层认识的形状。
 *
 * **不取整**（2026-09-11 修）：目录存的是金额（`pricing.cost: 0.3` 就是三毛），
 * 这里原本 `Math.floor` 到整数，理由是「它是积分」——于是所有**低于 1 的价格一律变成 0**，
 * 画布批量确认条印出「预估约 0 金币」，而主进程按同一行算出来的是 0.30。
 * 一个会被读成「这次不花钱」的 0，比不报价还坏（`shotPricingRule.ts` 的第二条不变量）。
 *
 * 价格不是有限非负数时**整行不给价目**（回 `undefined`），让算式诚实地报「算不出」；
 * 原本落成 0 是在编一个数。
 */
function toCatalogModelPricing(pricing: ModelCatalogModelDto['pricing']): ModelOptionPricing | undefined {
  if (!pricing) return undefined
  if (typeof pricing.cost !== 'number' || !Number.isFinite(pricing.cost) || pricing.cost < 0) return undefined
  const specCosts = Array.isArray(pricing.specCosts)
    ? pricing.specCosts
        .map((spec) => {
          const specKey = typeof spec?.specKey === 'string' ? spec.specKey.trim() : ''
          if (!specKey) return null
          // 加价档本身算不出就当**没有这一档**（不加钱），而不是当 0 分之后继续报一个整价：
          // 前者少算的是一个我们确实不知道的加价，后者是把不知道说成知道。
          if (typeof spec.cost !== 'number' || !Number.isFinite(spec.cost) || spec.cost < 0) return null
          return {
            specKey,
            cost: spec.cost,
            enabled: typeof spec.enabled === 'boolean' ? spec.enabled : true,
          }
        })
        .filter((spec): spec is ModelOptionPricing['specCosts'][number] => spec !== null)
    : []
  return {
    cost: pricing.cost,
    enabled: typeof pricing.enabled === 'boolean' ? pricing.enabled : true,
    specCosts,
  }
}

export function toCatalogModelOptions(items: ModelCatalogModelDto[]): ModelOption[] {
  if (!Array.isArray(items)) return []
  // 去重键必须带 vendor：modelKey 只在单个供应商内唯一，两个中转站可以各自提供同名模型
  // （如都叫 gpt-image-2）。裸 modelKey 去重会把后进数组那家整条吞掉——store 是 newest-first，
  // 表现为「先接的厂商被最新添加的厂商覆盖」。跨厂商的同模型合并是 dedupeModelOptions 的职责
  // （canonical 身份 → providers[] 多家可用），不在这层做。
  const seen = new Set<string>()
  const out: ModelOption[] = []
  for (const item of items) {
    const alias = typeof item?.modelAlias === 'string' ? item.modelAlias.trim() : ''
    const modelKey = typeof item?.modelKey === 'string' ? item.modelKey.trim() : ''
    const value = modelKey || alias
    const vendor = typeof item?.vendorKey === 'string' ? item.vendorKey : undefined
    const dedupeKey = `${vendor || ''}::${value}`
    if (!value || seen.has(dedupeKey)) continue
    seen.add(dedupeKey)
    const labelZh = typeof item?.labelZh === 'string' ? item.labelZh.trim() : ''
    const label = labelZh || alias || value
    // 认得的模型（按模型身份，供应商无关）→ 用内置档案的控件覆盖 meta.parameterControls，
    // 这样现有渲染路径不变就能渲染档案控件；认不出则保持原 meta（走通用 flat 解析）。
    const archControls = archetypeParameterControls({ modelKey: modelKey || value, modelAlias: alias, vendorKey: vendor, meta: item?.meta })
    let meta = archControls
      ? { ...(item?.meta && typeof item.meta === 'object' ? item.meta : {}), parameterControls: archControls }
      : item?.meta
    const variant = vendor === ANTIGRAVITY_VENDOR_KEY ? getAntigravityModelVariant(value) : undefined
    if (vendor === ANTIGRAVITY_VENDOR_KEY) {
      // Exact discovered IDs remain separate catalog rows. Unknown identities must not merge by label.
      meta = {
        ...(meta && typeof meta === 'object' ? meta : {}),
        canonicalModelId: variant ? `${vendor}:family:${variant.familyKey}` : `${vendor}:model:${value}`,
      }
    }
    out.push({
      value,
      label,
      vendor,
      modelKey: modelKey || value,
      modelAlias: alias || null,
      kind: item.kind,
      meta,
      pricing: toCatalogModelPricing(item?.pricing),
      ...(variant ? { variant } : {}),
    })
  }
  return out
}
