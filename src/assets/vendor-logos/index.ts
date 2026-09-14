/**
 * 品牌图资产的唯一登记处。
 *
 * 为什么要有这一层（2026-09-14 根因）：在此之前「哪张图代表哪个品牌」散在三处各写一份
 * `new URL('../assets/vendor-logos/x.png', import.meta.url)`——
 *   · `src/config/knownVendors.ts`（供应商接入卡）
 *   · `src/config/modelProviderIdentity.ts`（模型标）
 *   · `src/ui/onboarding/onboardingDrawerConnections.ts`（本地接入行，当时只有字形没有图）
 * 三份互不认识，于是模型标那份用正则把 `dreamina*` 指到了豆包的图上：即梦（Dreamina）和豆包
 * 是字节旗下**两个不同产品、两套品牌**，界面上却挂了同一块牌子。收口成一张表之后，
 * 「加一家品牌」「改一张图」「同一家在不同界面用同一块牌子」都只剩这一个地方能写。
 *
 * 这里只登记**资产**，不登记供应商档案——档案（副标题/推广/凭证声明）仍住 knownVendors.ts。
 */

export const VENDOR_LOGOS = {
  agnes: new URL('./agnes.png', import.meta.url).href,
  apimart: new URL('./apimart.png', import.meta.url).href,
  comfyui: new URL('./comfyui.png', import.meta.url).href,
  doubao: new URL('./doubao.png', import.meta.url).href,
  dreamina: new URL('./dreamina.png', import.meta.url).href,
  elevenlabs: new URL('./elevenlabs.png', import.meta.url).href,
  fal: new URL('./fal.png', import.meta.url).href,
  kie: new URL('./kie.png', import.meta.url).href,
  meshy: new URL('./meshy.png', import.meta.url).href,
  minimax: new URL('./minimax.png', import.meta.url).href,
  modelscope: new URL('./modelscope.png', import.meta.url).href,
  replicate: new URL('./replicate.png', import.meta.url).href,
  runninghub: new URL('./runninghub.png', import.meta.url).href,
  runway: new URL('./runway.png', import.meta.url).href,
  volcengine: new URL('./volcengine.png', import.meta.url).href,
} as const

export type VendorLogoName = keyof typeof VENDOR_LOGOS

/**
 * 单色标 = 图里只有一个深色笔画、**没有品牌自带底板**（官方图的浅色底已抠成透明）。
 *
 * 这三家的官方标就是「深色笔画 + 中性浅底」：APIMart 黑 M、ElevenLabs 黑双竖条、Runway 黑 R。
 * 原样打包会在暗色模式下变成一整块刺眼亮方块（审计 §④ 记的就是这个）；抠成透明后又会黑压黑
 * 看不见。所以这一族必须在渲染时反相——判据登记在这里，渲染只有 `VendorLogoImage` 一个口子读它。
 * 带彩色底板的品牌图（Replicate 渐变、fal 粉底、ComfyUI 深紫…）不在此列，两种模式都原样显示。
 */
const MONOCHROME_LOGO_NAMES: readonly VendorLogoName[] = ['apimart', 'elevenlabs', 'runway']

const MONOCHROME_LOGO_SOURCES: ReadonlySet<string> = new Set(
  MONOCHROME_LOGO_NAMES.map((name) => VENDOR_LOGOS[name]),
)

/** 这张品牌图是不是「深色笔画 + 透明底」的单色标（= 暗色模式要反相）。 */
export function isMonochromeVendorLogo(src: string | undefined | null): boolean {
  return typeof src === 'string' && MONOCHROME_LOGO_SOURCES.has(src)
}
