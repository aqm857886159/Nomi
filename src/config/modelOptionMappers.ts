import type { ModelCatalogModelDto } from '../workbench/api/modelCatalogApi'
import type { ModelOption, ModelOptionPricing } from './models'
import { archetypeParameterControls } from './modelArchetypes'
import { ANTIGRAVITY_VENDOR_KEY } from '../../electron/shared/antigravity'
import { getAntigravityModelVariant } from '../../electron/shared/antigravityModelVariants'

// 目录价目 → 渲染层价目。**原样搬运，不做第二次归一**。
//
// 这里曾经自作主张 `Math.max(0, Math.floor(cost))`、并把「不是数字」落成 0。三样都会让卡上的数
// 和主进程真正要扣的数岔开（主进程只把目录字段原样喂给算式）：向下取整少报几分、负数/NaN 被抹成
// 「¥0」——而 0 恰好是唯一会被读成「这次不花钱」的那个数。价目合不合法由那条唯一算式判
// （`electron/shared/contracts/shotPricingRule.ts`：非有限或为负 → 诚实地报「算不出」）。
function toCatalogModelPricing(pricing: ModelCatalogModelDto['pricing']): ModelOptionPricing | undefined {
  if (!pricing) return undefined
  const specCosts = Array.isArray(pricing.specCosts)
    ? pricing.specCosts
        .map((spec) => {
          const specKey = typeof spec?.specKey === 'string' ? spec.specKey.trim() : ''
          if (!specKey) return null
          return { specKey, cost: spec.cost, enabled: spec.enabled }
        })
        .filter((spec): spec is ModelOptionPricing['specCosts'][number] => spec !== null)
    : []
  return { cost: pricing.cost, enabled: pricing.enabled, specCosts }
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
