import React, { type JSX } from 'react'
import { MantineProvider } from '@mantine/core'
import { ModalsProvider } from '@mantine/modals'
import { Notifications } from '@mantine/notifications'
import { I18nextProvider } from 'react-i18next'
import { RootErrorBoundary } from './ui/ErrorBoundary'
import { FEEDBACK_LAYER_Z_INDEX } from './ui/feedbackLayer'
import { TOAST_MAX_HEIGHT } from './ui/toastConstants'
import { buildNomiTheme, nomiCssVariablesResolver } from './theme/nomiTheme'
import { useNomiColorScheme } from './theme/colorScheme'
import i18n from './i18n'
import { currentWorkbenchFloatingTopOffset } from './ui/app-shell/windowChrome'

const nomiTheme = buildNomiTheme()

// 提示容器负责「任何一条提示都完整地待在窗口里」——宽和高各一条，都写在容器上，不让每个 producer 各自去适配。
// 宽：容器是 grid，隐式列默认是 auto，会一路长到内容的 min-content（一个不换行的长按钮就有几百 px），于是提示比 344px 的
//     容器还宽、伸出窗口右沿，× 跟着出窗（2026-09-29 走查：1280×800 与最小窗 1100×720 都是）。列必须是 minmax(0,1fr)：
//     让内容去适应列，而不是让列去适应内容。
// 高：Mantine 给每条提示内联 max-height（= notificationMaxHeight）并 overflow:hidden；写死 160 时，一句原因 + 一句建议
//     （英文界面更长）会被上下各削掉一截。上限改成 TOAST_MAX_HEIGHT（窗口高度里让得出来的那一半，limit=2 的两条叠起来也出不了窗口），
//     再长的话由 ToastMessage 自己在这个上限里滚动——不再有「被切掉、够不着」的字。

export function NomiAppProviders({ children }: { children: React.ReactNode }): JSX.Element {
  const { colorScheme } = useNomiColorScheme()
  const notificationTopOffset = currentWorkbenchFloatingTopOffset(12)

  return (
    <I18nextProvider i18n={i18n}>
      <MantineProvider theme={nomiTheme} cssVariablesResolver={nomiCssVariablesResolver} forceColorScheme={colorScheme} defaultColorScheme={colorScheme}>
        <ModalsProvider>
          <Notifications
            className="pointer-events-none [&[data-position=top-right]]:!right-3 [&[data-position=top-right]]:grid [&[data-position=top-right]]:grid-cols-[minmax(0,1fr)] [&[data-position=top-right]]:gap-2 [body:has([data-nomi-right-panel=model])_&]:!right-[344px] [body:has([data-nomi-right-panel=tasks])_&]:!right-[404px] [body:has([data-nomi-right-panel=director])_&]:!right-[calc(var(--nomi-director-side-width,320px)_+_24px)]"
            style={{ top: notificationTopOffset }}
            classNames={{ notification: 'pointer-events-auto !mt-0' }}
            position="top-right"
            zIndex={FEEDBACK_LAYER_Z_INDEX}
            containerWidth={344}
            limit={2}
            autoClose={3000}
            transitionDuration={140}
            notificationMaxHeight={TOAST_MAX_HEIGHT}
          />
          <RootErrorBoundary>
            {children}
          </RootErrorBoundary>
        </ModalsProvider>
      </MantineProvider>
    </I18nextProvider>
  )
}
