import React from 'react'

type Props = { children: React.ReactNode }
type State = { error: Error | null; info: string }
type DesktopReloadBridge = { nomiDesktop?: { app?: { hardReloadWindow?: () => void } } }

function reloadRendererWindow(): void {
  try {
    const hardReloadWindow = (window as unknown as DesktopReloadBridge).nomiDesktop?.app?.hardReloadWindow
    if (hardReloadWindow) {
      hardReloadWindow()
      return
    }
  } catch {
    /* fall back to browser reload */
  }
  window.location.reload()
}

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
    // 落到主进程崩溃日志（contextBridge 暴露的话）；否则至少 console。
    try {
      ;(window as unknown as { nomiDesktop?: { logRendererCrash?: (m: string) => void } }).nomiDesktop?.logRendererCrash?.(
        `${error.name}: ${error.message}\n${error.stack || ''}\n--- componentStack ---${detail}`,
      )
    } catch {
      /* ignore */
    }
    console.error('[nomi] renderer crashed:', error, detail)
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
          <h1 className="text-title font-nomi-display">出了点问题</h1>
          <p className="mt-2 text-body text-nomi-ink-soft">
            界面遇到一个错误。你可以重新加载继续，或复制错误信息反馈给我们。
          </p>
          <pre className="mt-3 max-h-40 overflow-auto rounded-nomi bg-nomi-bg p-3 text-caption text-nomi-ink-soft">
            {error.name}: {error.message}
          </pre>
          <div className="mt-4 flex gap-2">
            <button
              type="button"
              className="rounded-nomi bg-nomi-ink px-3 py-1.5 text-body-sm text-white"
              onClick={reloadRendererWindow}
            >
              重新加载
            </button>
            <button
              type="button"
              className="rounded-nomi border border-nomi-line px-3 py-1.5 text-body-sm"
              onClick={this.handleCopy}
            >
              复制错误信息
            </button>
          </div>
        </div>
      </div>
    )
  }
}
