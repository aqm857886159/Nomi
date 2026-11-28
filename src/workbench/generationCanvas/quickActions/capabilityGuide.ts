import type { TFunction } from 'i18next'

/**
 * 「这个动作要的能力此刻没有」时，菜单项给的那条**一步可走的路**（2026-10-06 用户拍板：不是只灰掉说原因）。
 * 项不灰，第二行说缺什么，点了直接去补；不派生、不花钱。
 */
export type QuickActionGuide = Readonly<{ description: string; onSelect: () => void }>

/**
 * 能力名 → 去哪儿补。按能力说，不按模型名说（P4）。
 * 放大不在这里：2026-10-07 用户拍板，没有放大模型时「高清」置灰、悬停说原因、不跳转（见 CAPABILITY_GUIDE_EXCEPTIONS）。
 */
export type MissingCapability = 'imageEdit' | 'layerSplit'

/** 入口要的能力（`QuickActionRequirement`）→ 缺了给哪条路。不在这张表里的只能是 CAPABILITY_GUIDE_EXCEPTIONS 里的例外。 */
export const GUIDE_FOR_REQUIREMENT = {
  'image-edit': 'imageEdit',
  'layer-split': 'layerSplit',
} as const satisfies Record<string, MissingCapability>

/** 「缺能力时不给下一步、只置灰说原因」的用户拍板例外；其它能力一律要有下一步。 */
export const CAPABILITY_GUIDE_EXCEPTIONS = {
  upscale: '用户 2026-10-07 拍板：目前没有放大模型可接，没有时「高清」置灰、悬停说原因，不跳转',
} as const

/** 能补上这件能力的那一家（目录算出来的，不写死厂商名）：第二行点它的名字，点了直接打开它的接入页。 */
export type GuideVendor = Readonly<{ vendorKey: string; vendorName: string }>

const GUIDE_KEYS: Record<MissingCapability, { add: string; connect?: string }> = {
  // 改图：任何一家能改图的图片模型都行，落到模型设置首页。
  imageEdit: { add: 'generationCommon.quickActions.guides.imageEditAdd' },
  // 图层分离（D-1126-se-missing-model-guide）：目录里算得出谁能拆 → 点名去接那一家、打开它的接入页；一家都算不出 → 退回通用的去添加。
  layerSplit: { add: 'generationCommon.quickActions.guides.layerSplitAdd', connect: 'generationCommon.quickActions.guides.layerSplitConnect' },
}

function openModelSettings(vendorKey?: string): void {
  window.dispatchEvent(new CustomEvent('nomi-open-settings', { detail: { tab: 'models', ...(vendorKey ? { vendorKey } : {}) } }))
}

export function capabilityGuide(capability: MissingCapability, t: TFunction, vendors: readonly GuideVendor[] = []): QuickActionGuide {
  const keys = GUIDE_KEYS[capability]
  const target = keys.connect ? vendors[0] : undefined
  if (target && keys.connect) {
    return {
      description: t(keys.connect, { vendors: vendors.map((vendor) => vendor.vendorName).join(' / ') }),
      onSelect: () => openModelSettings(target.vendorKey),
    }
  }
  return { description: t(keys.add), onSelect: () => openModelSettings() }
}
