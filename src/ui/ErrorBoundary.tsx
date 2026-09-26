import React from 'react'
import i18n from '../i18n'
import { reloadRendererWindow } from '../desktop/bridge'
import { logRendererCrash } from '../desktop/rendererLog'

type Props = { children: React.ReactNode }
type State = { error: Error | null; info: string }

/**
 * 根 ErrorBoundary（多维审计 P0-8）：渲染层任意抛错时，给可读兜底 + 可复制错误，
 * 而不是整屏白让用户/维护者盲修。错误同时打到主进程崩溃日志（若桥可用）。
 */
export class RootErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null, info: '' }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    const detail = info.componentStack || ''
    this.setState({ info: detail })
    // 落到主进程崩溃日志（桌面端）+ DevTools；组件栈只留组件名。
    logRendererCrash('root-boundary', error, detail)
  }

  private handleCopy = (): void => {
    const { error, info } = this.state
    const text = `${error?.name}: ${error?.message}\n${error?.stack || ''}\n--- componentStack ---${info}`
    void navigator.clipboard?.writeText(text).catch(() => undefined)
  }

  render(): React.ReactNode {
    const { error } = this.state
    if (!error) return this.props.children
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-nomi-bg p-8 text-nomi-ink">
        <div className="max-w-lg rounded-nomi border border-nomi-line bg-white p-6 shadow-nomi-md">
          <h1 className="text-title font-nomi-display">{i18n.t('errors.rootTitle')}</h1>
          <p className="mt-2 text-body text-nomi-ink-60">
            {i18n.t('errors.rootDescription')}
          </p>
          <pre className="mt-3 max-h-40 overflow-auto rounded-nomi bg-nomi-bg p-3 text-caption text-nomi-ink-60">
            {error.name}: {error.message}
          </pre>
          <div className="mt-4 flex gap-2">
            <button
              type="button"
              className="rounded-nomi bg-nomi-ink px-3 py-1.5 text-body-sm text-white"
              onClick={reloadRendererWindow}
            >
              {i18n.t('common.reload')}
            </button>
            <button
              type="button"
              className="rounded-nomi border border-nomi-line px-3 py-1.5 text-body-sm"
              onClick={this.handleCopy}
            >
              {i18n.t('errors.copyDetails')}
            </button>
          </div>
        </div>
      </div>
    )
  }
}
