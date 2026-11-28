import { builtinVendorKeyOfKey } from '../../../electron/shared/builtinVendorIdentity'
import { getLocalizedKnownVendors } from '../../config/knownVendors'
import { trackOnboardingStep } from '../../workbench/onboarding/onboardingState'

export const NOMI_OPEN_APIMART_CONNECT_EVENT = 'nomi-open-apimart-connect'

const APIMART_PROMO_URL =
  getLocalizedKnownVendors().find((entry) => builtinVendorKeyOfKey(entry.vendorKey) === 'apimart')?.promo?.url
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
  trackOnboardingStep({ step: 'setup_opened', providerClass: 'builtin' })
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
  trackOnboardingStep({ step: 'setup_opened', providerClass: 'custom' })
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
export const APIMART_CONNECTED_EVENT = 'nomi-apimart-connected'

const apimartOpenedAtKey = 'nomi:apimart:opened-at'

export function readApimartOpenedAt(): number {
  try {
    const at = Number(window.localStorage.getItem(apimartOpenedAtKey))
    return Number.isFinite(new Date(at).getTime()) && at > 0 ? at : 0
  } catch { return 0 }
}

export function persistApimartOpenedAt(at: number): void {
  try {
    if (at) window.localStorage.setItem(apimartOpenedAtKey, String(at))
    else window.localStorage.removeItem(apimartOpenedAtKey)
  } catch { /* Keep the in-memory timestamp when storage is unavailable. */ }
}
