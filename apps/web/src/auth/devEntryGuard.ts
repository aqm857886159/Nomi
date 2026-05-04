type DevEntryGuardEnv = Record<string, string | boolean | undefined>

export const NOMI_CANONICAL_DEV_ORIGIN = 'http://localhost:5173'

export function shouldBlockNonCanonicalDevEntry(currentHref: string, env: DevEntryGuardEnv): boolean {
  if (env.DEV !== true) return false
  let current: URL
  try {
    current = new URL(currentHref)
  } catch {
    return false
  }
  return current.hostname === '127.0.0.1' && current.port === '5173'
}

function buildCanonicalUrl(currentHref: string): string {
  const target = new URL(currentHref)
  target.protocol = 'http:'
  target.hostname = 'localhost'
  target.port = '5173'
  return target.toString()
}

export function blockNonCanonicalDevEntry(): boolean {
  if (typeof window === 'undefined' || typeof document === 'undefined') return false
  const env = ((import.meta as unknown) as { env?: DevEntryGuardEnv }).env || {}
  if (!shouldBlockNonCanonicalDevEntry(window.location.href, env)) return false

  const target = buildCanonicalUrl(window.location.href)
  const root = document.getElementById('root')
  if (root) {
    root.innerHTML = [
      '<main class="nomi-dev-entry-guard">',
      '<h1 class="nomi-dev-entry-guard__title">Nomi 只允许一个本地入口</h1>',
      '<p class="nomi-dev-entry-guard__body">当前地址是 127.0.0.1:5173。为避免项目存储分裂，请使用 localhost:5173。</p>',
      `<a class="nomi-dev-entry-guard__link" href="${target}">打开 ${NOMI_CANONICAL_DEV_ORIGIN}</a>`,
      '</main>',
    ].join('')
  }
  console.error(`[nomi] non-canonical dev entry blocked. Use ${target}`)
  return true
}
