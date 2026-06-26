import React from 'react'
import { MantineProvider } from '@mantine/core'
import { ModalsProvider } from '@mantine/modals'
import { Notifications } from '@mantine/notifications'
import { RootErrorBoundary } from './ui/ErrorBoundary'
import { buildNomiTheme } from './theme/nomiTheme'
import { useNomiColorScheme } from './theme/colorScheme'

const nomiTheme = buildNomiTheme()

export function NomiAppProviders({ children }: { children: React.ReactNode }): JSX.Element {
  const { colorScheme } = useNomiColorScheme()

  return (
    <MantineProvider theme={nomiTheme} forceColorScheme={colorScheme} defaultColorScheme={colorScheme}>
      <ModalsProvider>
        <Notifications position="top-right" zIndex={2000} />
        <RootErrorBoundary>
          {children}
        </RootErrorBoundary>
      </ModalsProvider>
    </MantineProvider>
  )
}
