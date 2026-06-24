import React from 'react'
import {
  applyNomiColorScheme,
  getTimeBasedColorScheme,
  hasStoredColorScheme,
  NomiColorSchemeContext,
  normalizeColorScheme,
  persistColorScheme,
  resolveInitialColorScheme,
  type NomiColorScheme,
  type NomiColorSchemeContextValue,
} from './colorScheme'

export function NomiColorSchemeProvider({ children }: { children: React.ReactNode }): JSX.Element {
  const [colorScheme, setColorSchemeState] = React.useState<NomiColorScheme>(() => resolveInitialColorScheme())

  const setColorScheme = React.useCallback((scheme: NomiColorScheme) => {
    const normalized = normalizeColorScheme(scheme)
    persistColorScheme(normalized) // 显式选择即写盘——OS 偏好从此不再覆盖。
    setColorSchemeState(normalized)
  }, [])

  React.useEffect(() => {
    applyNomiColorScheme(colorScheme)
  }, [colorScheme])

  // 天黑自动暗：仅在用户未显式选过时，每分钟核对本地时间窗——App 开着跨过傍晚/清晨会自动切。
  React.useEffect(() => {
    if (typeof window === 'undefined') return
    const id = window.setInterval(() => {
      if (hasStoredColorScheme()) return
      setColorSchemeState((prev) => {
        const next = getTimeBasedColorScheme()
        return next === prev ? prev : next
      })
    }, 60_000)
    return () => window.clearInterval(id)
  }, [])

  const value = React.useMemo<NomiColorSchemeContextValue>(() => ({
    colorScheme,
    isDark: colorScheme === 'dark',
    setColorScheme,
    toggleColorScheme: () => setColorScheme(colorScheme === 'dark' ? 'light' : 'dark'),
  }), [colorScheme, setColorScheme])

  return (
    <NomiColorSchemeContext.Provider value={value}>
      {children}
    </NomiColorSchemeContext.Provider>
  )
}
