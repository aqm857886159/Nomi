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

  // 暗色锁：导演台这类「本身就是暗房」的全屏面按下它，离开即释放。计数是因为可能嵌套/重挂。
  const [darkLocks, setDarkLocks] = React.useState(0)
  const acquireForcedDark = React.useCallback(() => {
    setDarkLocks((count) => count + 1)
    let released = false
    return () => {
      if (released) return
      released = true
      setDarkLocks((count) => Math.max(0, count - 1))
    }
  }, [])

  // 有效方案：锁优先。用户偏好与「天黑自动暗」照常在底下更新，释放后立刻回到它。
  const effectiveScheme: NomiColorScheme = darkLocks > 0 ? 'dark' : colorScheme

  React.useEffect(() => {
    applyNomiColorScheme(effectiveScheme)
  }, [effectiveScheme])

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

  // 对外给的是**有效方案**（Mantine / 组件按它渲染），setColorScheme 仍写用户偏好那一层。
  const value = React.useMemo<NomiColorSchemeContextValue>(() => ({
    colorScheme: effectiveScheme,
    isDark: effectiveScheme === 'dark',
    setColorScheme,
    toggleColorScheme: () => setColorScheme(effectiveScheme === 'dark' ? 'light' : 'dark'),
    acquireForcedDark,
  }), [acquireForcedDark, effectiveScheme, setColorScheme])

  return (
    <NomiColorSchemeContext.Provider value={value}>
      {children}
    </NomiColorSchemeContext.Provider>
  )
}
