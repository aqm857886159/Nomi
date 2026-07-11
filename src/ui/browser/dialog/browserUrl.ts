const HTTP_URL_RE = /^https?:\/\//i
const SCHEME_RE = /^[a-z][a-z\d+.-]*:/i
const IPV4_RE = /^(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?$/u

function encodeSearchQuery(query: string): string {
  return `https://www.bing.com/search?q=${encodeURIComponent(query)}`
}

function looksLikeHost(value: string): boolean {
  const host = value.split(/[/?#]/u, 1)[0] || ''
  if (host === 'localhost' || host.startsWith('localhost:')) return true
  if (IPV4_RE.test(host)) return true
  return host.includes('.') && !/\s/u.test(host)
}

export function normalizeBrowserInput(input: string): string {
  const value = input.trim()
  if (!value) return 'https://www.bing.com'
  if (HTTP_URL_RE.test(value)) return new URL(value).toString()
  if (looksLikeHost(value)) return new URL(`https://${value}`).toString()
  if (SCHEME_RE.test(value)) return encodeSearchQuery(value)
  return encodeSearchQuery(value)
}

export function browserUrlDisplayTitle(url: string): string {
  try {
    const parsed = new URL(url)
    if (parsed.hostname) return parsed.hostname.replace(/^www\./u, '')
  } catch {
    // Fall through to a compact fallback.
  }
  return url || '新标签页'
}
