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
export type MissingCapability = 'imageEdit'

/** 「缺能力时不给下一步、只置灰说原因」的用户拍板例外；其它能力一律要有下一步。 */
export const CAPABILITY_GUIDE_EXCEPTIONS = {
  upscale: '用户 2026-10-07 拍板：目前没有放大模型可接，没有时「高清」置灰、悬停说原因，不跳转',
} as const

const GUIDE_KEYS: Record<MissingCapability, string> = {
  // 改图：任何一家能改图的图片模型都行，落到模型设置首页。
  imageEdit: 'generationCommon.quickActions.guides.imageEditAdd',
}

export function capabilityGuide(capability: MissingCapability, t: TFunction): QuickActionGuide {
  return {
    description: t(GUIDE_KEYS[capability]),
    onSelect: () => window.dispatchEvent(new CustomEvent('nomi-open-settings', { detail: { tab: 'models' } })),
  }
}
