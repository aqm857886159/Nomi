/**
 * 已知供应商目录（presentation + 推广元数据）。
 *
 * 设计意图（P4 通用第一）：接入卡片是"供应商接入卡"的通用形态，不是某家专属。
 * 这里只放**无法从 catalog 派生**的展示信息（logo 字形 / 副标题 / 推广话术 + 链接）。
 * 供应商显示名（vendor.name）和该家的模型清单都从 catalog **派生**，不在此硬编码——
 * 新增一家只加一条目录数据，不写新 UI（见 VendorOnboardCard）。
 *
 * 与 catalog 的绑定键：`vendorKey` 必须等于 seed 里的 vendor.key
 * （apimart → APIMART_VENDOR_SEED.key、kie → KIE_VENDOR_SEED.key）。
 */

export type KnownVendorPromo = {
  /** 卡片底部话术正文。 */
  text: string
  /** CTA 按钮文案。 */
  ctaLabel: string
  /**
   * 注册链接。当前先指官网；拿到专属 affiliate ?ref= 链接后替换这里即可，
   * 卡片代码无需改动（TODO: 用户拿回推广链接/优惠码后替换）。
   */
  url: string
}

export type KnownVendor = {
  /** 与 catalog vendor.key 一致。 */
  vendorKey: string
  /** brand logo 打包资源 URL；缺省回退到 glyph 字形。 */
  logo?: string
  /** 单字母 logo 字形（无 logo 时的回退）。 */
  glyph: string
  /** 卡片副标题。 */
  tagline: string
  /** 推广位；null = 不展示推广。 */
  promo: KnownVendorPromo | null
}

export const KNOWN_VENDORS: readonly KnownVendor[] = [
  {
    vendorKey: 'apimart',
    logo: new URL('../assets/vendor-logos/apimart.png', import.meta.url).href,
    glyph: 'A',
    tagline: '一个 key，解锁全部预置模型',
    promo: {
      text: '如果你愿意，可以用我们的链接注册；不愿意也可以直接去官方注册。',
      ctaLabel: '用我们的链接',
      url: 'https://apimart.ai/register?aff=t55VtP', // 专属推广链接
    },
  },
  {
    vendorKey: 'kie',
    logo: new URL('../assets/vendor-logos/kie.png', import.meta.url).href,
    glyph: 'K',
    tagline: '一个 key，解锁内置模型',
    promo: {
      text: '如果你愿意，可以用我们的链接注册；不愿意也可以直接去官方注册。',
      ctaLabel: '用我们的链接',
      url: 'https://kie.ai', // TODO: 替换为专属 ?ref 链接
    },
  },
] as const

const KNOWN_VENDOR_BY_KEY = new Map<string, KnownVendor>(
  KNOWN_VENDORS.map((vendor) => [vendor.vendorKey, vendor]),
)

export function getKnownVendor(vendorKey: string): KnownVendor | undefined {
  return KNOWN_VENDOR_BY_KEY.get(vendorKey)
}

export function isKnownVendor(vendorKey: string): boolean {
  return KNOWN_VENDOR_BY_KEY.has(vendorKey)
}
