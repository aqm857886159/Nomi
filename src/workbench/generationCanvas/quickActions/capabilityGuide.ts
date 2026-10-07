import type { TFunction } from 'i18next'

/**
 * 「这个动作要的能力此刻没有」时，菜单项给的那条**一步可走的路**（2026-10-06 用户拍板：不是只灰掉说原因）。
 * 项不灰，第二行说缺什么，点了直接去补；不派生、不花钱。
 */
export type QuickActionGuide = Readonly<{ description: string; onSelect: () => void }>

/** 能力名 → 去哪儿补。按能力说，不按模型名说（P4）。 */
export type MissingCapability = 'upscale' | 'imageEdit'

/**
 * 放大：目录里能做「不改内容地放大」的通用模型今天在 kie（Topaz / Recraft，见 electron/catalog/kieImages2026.ts 的
 * KIE_UPSCALE_MODELS），所以直接落到 kie 的接入页；文案明说要 kie 的 key——只接官方额度的用户目前没有放大能力，
 * 不指向一个不存在的东西。
 * 改图：任何一家能改图的图片模型都行，落到模型设置首页。
 */
export function capabilityGuide(capability: MissingCapability, t: TFunction): QuickActionGuide {
  if (capability === 'upscale') {
    return {
      description: t('generationCommon.quickActions.guides.upscaleAdd'),
      onSelect: () => window.dispatchEvent(new CustomEvent('nomi-open-settings', { detail: { tab: 'models', vendorKey: 'kie' } })),
    }
  }
  return {
    description: t('generationCommon.quickActions.guides.imageEditAdd'),
    onSelect: () => window.dispatchEvent(new CustomEvent('nomi-open-settings', { detail: { tab: 'models' } })),
  }
}
