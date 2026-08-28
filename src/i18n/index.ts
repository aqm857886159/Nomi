import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { resources } from './resources'
import { getDesktopBridge } from '../desktop/bridge'

export const SUPPORTED_LOCALES = ['zh-CN', 'en'] as const
export type AppLocale = (typeof SUPPORTED_LOCALES)[number]

export const DEFAULT_LOCALE: AppLocale = 'zh-CN'
export const LOCALE_STORAGE_KEY = 'nomi:locale:v1'

export function isAppLocale(value: unknown): value is AppLocale {
  return typeof value === 'string' && (SUPPORTED_LOCALES as readonly string[]).includes(value)
}

/** 已存储的用户语言偏好；从未存过（首启）返回 null，交由系统语言探测。 */
function readStoredLocaleRaw(): AppLocale | null {
  try {
    const stored = window.localStorage.getItem(LOCALE_STORAGE_KEY)
    return isAppLocale(stored) ? stored : null
  } catch {
    return null
  }
}

export function readStoredLocale(): AppLocale {
  return readStoredLocaleRaw() ?? DEFAULT_LOCALE
}

// 首启（无存储偏好）探测系统语言：中文系统留中文，其余一律给英文（#40 国际可达性——
// 非中文系统进中文界面等于换一种语言的「语言墙」，英文是唯一另一支持语言、也是国际通用兜底）。
// 仅真 Electron 经桥能拿到 OS locale；jsdom/无桥环境（含 vitest）返回 null → 回落默认中文，测试不受影响。
/**
 * OS locale 串 → 支持的双语枚举。判据是「是不是中文」：中文系统留中文，其余一律英文。
 *
 * 这条判据必须与主进程的 `normalizeDesktopLocale` **完全一致**——两边曾各写各的（这里「非 zh → en」、
 * 主进程「非 en → zh-CN」），于是土耳其语/德语系统上界面是英文、主进程以为是中文，Agent 被要求用中文
 * 作答（2026-08-28 实测）。两份实现由 `localeNormalize.equivalence.test.ts` 逐项钉死。
 */
export function normalizeSystemLocale(raw: string): AppLocale {
  return raw.trim().toLowerCase().startsWith('zh') ? 'zh-CN' : 'en'
}

function detectSystemLocale(): AppLocale | null {
  try {
    const raw = getDesktopBridge()?.i18n?.getSystemLocale?.()
    if (!raw) return null
    return normalizeSystemLocale(raw)
  } catch {
    return null
  }
}

function resolveInitialLocale(): AppLocale {
  if (typeof window === 'undefined') return DEFAULT_LOCALE
  return readStoredLocaleRaw() ?? detectSystemLocale() ?? DEFAULT_LOCALE
}

function syncDocumentLocale(locale: AppLocale): void {
  if (typeof document !== 'undefined') document.documentElement.lang = locale
}

function syncDesktopLocale(locale: AppLocale): void {
  if (typeof window !== 'undefined') getDesktopBridge()?.i18n?.setLocale(locale)
}

const initialLocale = resolveInitialLocale()

void i18n.use(initReactI18next).init({
  resources,
  lng: initialLocale,
  fallbackLng: DEFAULT_LOCALE,
  supportedLngs: [...SUPPORTED_LOCALES],
  nonExplicitSupportedLngs: false,
  interpolation: { escapeValue: false },
  returnNull: false,
  initAsync: false,
})

syncDocumentLocale(initialLocale)
syncDesktopLocale(initialLocale)

export function setAppLocale(locale: AppLocale): void {
  try {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, locale)
  } catch {
    // localStorage 不可用时仍允许本次会话切换。
  }
  syncDocumentLocale(locale)
  syncDesktopLocale(locale)
  void i18n.changeLanguage(locale)
}

export function getAppLocale(): AppLocale {
  return isAppLocale(i18n.resolvedLanguage) ? i18n.resolvedLanguage : DEFAULT_LOCALE
}

export default i18n
