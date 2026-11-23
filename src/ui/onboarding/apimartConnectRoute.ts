import { getLocalizedKnownVendors } from '../../config/knownVendors'

export const NOMI_OPEN_APIMART_CONNECT_EVENT = 'nomi-open-apimart-connect'

const APIMART_PROMO_URL =
  getLocalizedKnownVendors().find((entry) => entry.vendorKey === 'apimart')?.promo?.url
  ?? 'https://apimart.ai/register?aff=t55VtP'

export const APIMART_REGISTER_URL = APIMART_PROMO_URL

export const APIMART_MIRROR_DOMAINS = ['apib.ai', 'aiuxu.com', 'aishuch.com'] as const

export function buildApimartMirrorUrl(domain: (typeof APIMART_MIRROR_DOMAINS)[number]): string {
  const inviteQuery = new URL(APIMART_REGISTER_URL).search
  return `https://${domain}/register${inviteQuery}`
}

export const ONBOARDING_DEMO_RUNTIME_URLS = {
  seedanceVideo: 'nomi-local://runtime/onboarding-demo/seedance-2.0.mp4',
  seedancePoster: 'nomi-local://runtime/onboarding-demo/seedance-2.0-poster.jpg',
  nanoBanana2: 'nomi-local://runtime/onboarding-demo/nano-banana-2.jpg',
  nanoBanana: 'nomi-local://runtime/onboarding-demo/shot-4.jpg',
} as const

export const ONBOARDING_DEMO_WORKS = [
  { id: 'seedance', modelLabel: 'Seedance 2.0', imageUrl: ONBOARDING_DEMO_RUNTIME_URLS.seedancePoster },
  { id: 'nano-banana-2', modelLabel: 'Nano Banana 2', imageUrl: ONBOARDING_DEMO_RUNTIME_URLS.nanoBanana2 },
  { id: 'nano-banana', modelLabel: 'Nano Banana', imageUrl: ONBOARDING_DEMO_RUNTIME_URLS.nanoBanana },
] as const

/** 打开「连接 APIMart」整窗大页（E0 唯一入口事件；已打开时只聚焦，不开第二个）。 */
export function openApimartConnect(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(NOMI_OPEN_APIMART_CONNECT_EVENT))
  }
}

export type OpenModelSettingsOptions = {
  scrollToNetwork?: boolean
}

let pendingScrollToNetwork = false

export function consumePendingModelNetworkScroll(): boolean {
  const next = pendingScrollToNetwork
  pendingScrollToNetwork = false
  return next
}

/** 打开「设置 › 模型」首页（别家服务 / 隐藏模型 / 网络代理深链共用）。 */
export function openModelSettingsHome(options?: OpenModelSettingsOptions): void {
  if (options?.scrollToNetwork) pendingScrollToNetwork = true
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('nomi-open-settings', { detail: { tab: 'models' } }))
  }
}

/** 系统默认浏览器打开外链（electron windowNavigation 统一转 shell.openExternal），带 1 秒防连点。 */
export function openExternalUrlWithDebounce(
  url: string,
  lastOpenedAtRef: { current: number },
  debounceMs = 1000,
  now = Date.now(),
): boolean {
  if (now - lastOpenedAtRef.current < debounceMs) return false
  lastOpenedAtRef.current = now
  if (typeof window !== 'undefined') {
    window.open(url, '_blank', 'noopener')
  }
  return true
}
