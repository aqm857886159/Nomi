// 生成渠道（chatfire）的 API Key / baseUrl 读写（localStorage）。从 GenerationCanvas.tsx 抽出。
export const GENERATION_PROVIDER = 'chatfire'
export const GENERATION_DEFAULT_BASE_URL = 'https://api.chatfire.site'

export function readProviderSetting(key: 'apiKey' | 'baseUrl'): string {
  if (typeof window === 'undefined') return key === 'baseUrl' ? GENERATION_DEFAULT_BASE_URL : ''
  try {
    const storageKey = key === 'apiKey' ? 'api-keys-by-provider' : 'base-urls-by-provider'
    const value = JSON.parse(window.localStorage.getItem(storageKey) || '{}') as Record<string, unknown>
    const configured = typeof value[GENERATION_PROVIDER] === 'string' ? value[GENERATION_PROVIDER].trim() : ''
    if (configured) return configured
  } catch {
    // ignore invalid local settings
  }
  if (key === 'apiKey') {
    try {
      return window.localStorage.getItem('tapcanvas_public_api_key')?.trim() || ''
    } catch {
      return ''
    }
  }
  return GENERATION_DEFAULT_BASE_URL
}

export function writeProviderSettings(apiKey: string, baseUrl: string) {
  if (typeof window === 'undefined') return
  const nextKey = apiKey.trim()
  const nextBaseUrl = baseUrl.trim() || GENERATION_DEFAULT_BASE_URL
  const apiKeys = JSON.parse(window.localStorage.getItem('api-keys-by-provider') || '{}') as Record<string, string>
  const baseUrls = JSON.parse(window.localStorage.getItem('base-urls-by-provider') || '{}') as Record<string, string>
  if (nextKey) apiKeys[GENERATION_PROVIDER] = nextKey
  else delete apiKeys[GENERATION_PROVIDER]
  baseUrls[GENERATION_PROVIDER] = nextBaseUrl
  window.localStorage.setItem('api-keys-by-provider', JSON.stringify(apiKeys))
  window.localStorage.setItem('base-urls-by-provider', JSON.stringify(baseUrls))
}
