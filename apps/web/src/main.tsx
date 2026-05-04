import React from 'react'
import { createRoot } from 'react-dom/client'
import NomiRouterApp from './NomiRouterApp'
import { MantineProvider, MantineThemeProvider } from '@mantine/core'
import { Notifications } from '@mantine/notifications'
import './styles/index.css'
import { blockNonCanonicalDevEntry } from './auth/devEntryGuard'
import { installAuth401Interceptor } from './auth/fetch401Interceptor'
import { buildNomiTheme } from './design'

const DEFAULT_COLOR_SCHEME = 'light'

function primeColorSchemeAttribute() {
  if (typeof document === 'undefined') return
  document.documentElement.setAttribute('data-mantine-color-scheme', DEFAULT_COLOR_SCHEME)
}

primeColorSchemeAttribute()
const devEntryBlocked = blockNonCanonicalDevEntry()
if (!devEntryBlocked) installAuth401Interceptor()

function DynamicThemeProvider({ children }: { children: React.ReactNode }) {
  const theme = React.useMemo(() => buildNomiTheme(), [])

  return <MantineThemeProvider theme={theme}>{children}</MantineThemeProvider>
}

const container = devEntryBlocked ? null : document.getElementById('root')
if (!devEntryBlocked && !container) throw new Error('Root container not found')
const root = container ? createRoot(container) : null

root?.render(
  <React.StrictMode>
    <MantineProvider forceColorScheme={DEFAULT_COLOR_SCHEME} defaultColorScheme={DEFAULT_COLOR_SCHEME}>
      <DynamicThemeProvider>
        <Notifications position="top-right" zIndex={2000} />
        <NomiRouterApp />
      </DynamicThemeProvider>
    </MantineProvider>
  </React.StrictMode>
)
