import React from 'react'
import { getDesktopBridge } from '../../desktop/bridge'
import type { DesktopAppInfo, DesktopUpdateEvent } from '../../desktop/bridge'

// 版本号 + 检查更新 + 一键更新（功能需求1/2/3）的渲染层状态机。
// UI 纯 derive 自 phase，不在组件里 hardcode 文案分支（单一真相源）。

export type UpdaterPhase =
  | 'idle'
  | 'checking'
  | 'up-to-date'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'error'

export type Updater = {
  phase: UpdaterPhase
  appInfo: DesktopAppInfo | null
  latestVersion: string | null
  notes: string
  percent: number
  errorMessage: string
  /** 桌面端且主进程暴露了 update 桥才支持检查/更新（Web 预览态只显示版本号）。 */
  supported: boolean
  /** 能否就地自动安装；未签名 mac 为 false → UI 走「前往下载」手动兜底（真相源在主进程 appInfo）。 */
  canAutoInstall: boolean
  /** Preview/RC side-by-side builds do not subscribe to the stable updater feed. */
  canCheckUpdates: boolean
  check: () => void
  download: () => void
  install: () => void
  openDownload: () => void
  reset: () => void
}

export type UpdaterReducerState = {
  phase: UpdaterPhase
  latestVersion: string | null
  notes: string
  percent: number
  errorMessage: string
}

type State = UpdaterReducerState

export const UPDATER_INITIAL_STATE: State = { phase: 'idle', latestVersion: null, notes: '', percent: 0, errorMessage: '' }


export type UpdaterVisibilityInput = {
  phase: UpdaterPhase
  hasRunningTask: boolean
}

/** The update remains pending while production work is running; show only a quiet badge. */
export function shouldShowUpdaterDialog({ phase, hasRunningTask }: UpdaterVisibilityInput): boolean {
  if (hasRunningTask) return false
  return phase === 'available' || phase === 'downloading' || phase === 'downloaded' || phase === 'error'
}


const INITIAL = UPDATER_INITIAL_STATE

export function reduceUpdaterState(state: State, event: DesktopUpdateEvent): State {
  switch (event.type) {
    case 'checking':
      return { ...INITIAL, phase: 'checking' }
    case 'up-to-date':
      return { ...INITIAL, phase: 'up-to-date' }
    case 'available':
      return { ...INITIAL, phase: 'available', latestVersion: event.version, notes: event.notes }
    case 'progress':
      return { ...state, phase: 'downloading', percent: event.percent }
    case 'downloaded':
      return { ...state, phase: 'downloaded', latestVersion: event.version || state.latestVersion }
    case 'error':
      return { ...state, phase: 'error', errorMessage: event.message }
    default:
      return state
  }
}

export function useUpdater(): Updater {
  const bridge = getDesktopBridge()
  const update = bridge?.update
  const supported = Boolean(update)

  const [appInfo, setAppInfo] = React.useState<DesktopAppInfo | null>(null)
  const [state, setState] = React.useState<State>(INITIAL)

  React.useEffect(() => {
    let alive = true
    void update?.appInfo().then((info) => {
      if (alive) setAppInfo(info)
    }).catch(() => undefined)
    const off = update?.onEvent((event) => setState((prev) => reduceUpdaterState(prev, event)))
    return () => {
      alive = false
      off?.()
    }
  }, [update])

  // 「已是最新」短暂提示后自动回落到 idle（与样张一致）。
  React.useEffect(() => {
    if (state.phase !== 'up-to-date') return
    const timer = window.setTimeout(() => setState(INITIAL), 2500)
    return () => window.clearTimeout(timer)
  }, [state.phase])

  const check = React.useCallback(() => {
    setState({ ...INITIAL, phase: 'checking' })
    void update?.check().catch(() => undefined)
  }, [update])

  const download = React.useCallback(() => {
    setState((prev) => ({ ...prev, phase: 'downloading', percent: 0 }))
    void update?.download().catch(() => undefined)
  }, [update])

  const install = React.useCallback(() => {
    void update?.install().catch(() => undefined)
  }, [update])

  const openDownload = React.useCallback(() => {
    void update?.openDownload().catch(() => undefined)
  }, [update])

  const reset = React.useCallback(() => setState(INITIAL), [])

  // 未签名 mac 无法就地装；appInfo 未到位时按桌面默认（true），到位后以主进程口径为准。
  const canAutoInstall = appInfo?.canAutoInstall ?? true
  const canCheckUpdates = appInfo?.canCheckUpdates ?? true

  return {
    phase: state.phase,
    appInfo,
    latestVersion: state.latestVersion,
    notes: state.notes,
    percent: state.percent,
    errorMessage: state.errorMessage,
    supported,
    canAutoInstall,
    canCheckUpdates,
    check,
    download,
    install,
    openDownload,
    reset,
  }
}
