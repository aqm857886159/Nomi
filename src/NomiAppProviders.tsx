import React from 'react'
import { MantineProvider } from '@mantine/core'
import { ModalsProvider } from '@mantine/modals'
import { Notifications } from '@mantine/notifications'
import { I18nextProvider } from 'react-i18next'
import { RootErrorBoundary } from './ui/ErrorBoundary'
import { FEEDBACK_LAYER_Z_INDEX } from './ui/feedbackLayer'
import { buildNomiTheme, nomiCssVariablesResolver } from './theme/nomiTheme'
import { useNomiColorScheme } from './theme/colorScheme'
import i18n from './i18n'
import { currentWorkbenchFloatingTopOffset } from './ui/app-shell/windowChrome'

const nomiTheme = buildNomiTheme()

export function NomiAppProviders({ children }: { children: React.ReactNode }): JSX.Element {
  const { colorScheme } = useNomiColorScheme()
  const notificationTopOffset = currentWorkbenchFloatingTopOffset(12)

  return (
    <I18nextProvider i18n={i18n}>
      <MantineProvider theme={nomiTheme} cssVariablesResolver={nomiCssVariablesResolver} forceColorScheme={colorScheme} defaultColorScheme={colorScheme}>
        <ModalsProvider>
          <Notifications
            className="pointer-events-none [&[data-position=top-right]]:!right-3 [&[data-position=top-right]]:grid [&[data-position=top-right]]:gap-2 [body:has([data-nomi-right-panel=model])_&]:!right-[344px] [body:has([data-nomi-right-panel=tasks])_&]:!right-[404px] [body:has([data-nomi-right-panel=director])_&]:!right-[calc(var(--nomi-director-side-width,320px)_+_24px)]"
            style={{ top: notificationTopOffset }}
            classNames={{ notification: 'pointer-events-auto !mt-0' }}
            position="top-right"
            zIndex={FEEDBACK_LAYER_Z_INDEX}
            containerWidth={344}
            limit={2}
            autoClose={3000}
            transitionDuration={140}
            notificationMaxHeight={160}
          />
          <RootErrorBoundary>
            {children}
          </RootErrorBoundary>
        </ModalsProvider>
      </MantineProvider>
    </I18nextProvider>
  )
}
