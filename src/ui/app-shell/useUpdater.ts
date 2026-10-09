import React from 'react'
import { getDesktopBridge } from '../../desktop/bridge'
import type { DesktopAppInfo } from '../../desktop/bridge'
import { UPDATER_INITIAL_STATE, type UpdaterState } from '../../../electron/shared/updateReminder'
import { closeUpdateDialog, openUpdateDialog, retainUpdateSync, useUpdateStore } from './updateStore'

// 更新提醒对外的唯一状态 hook：顶栏胶囊 / 弹窗 / 横幅 / 已更新卡 / 设置→关于都读它。
// UI 纯 derive 自主进程的更新状态（单一真相源），不在组件里 hardcode 平台或文案分支。

export type { UpdaterPhase } from '../../../electron/shared/updateReminder'

export type Updater = UpdaterState & {
  appInfo: DesktopAppInfo | null
  /** 桌面端且主进程暴露了 update 桥才支持检查/更新（Web 预览态只显示版本号）。 */
  supported: boolean
  /** 能否就地自动安装；未签名 mac 为 false → UI 走「前往下载」手动兜底（真相源在主进程 appInfo）。 */
  canAutoInstall: boolean
  /** Preview/RC side-by-side builds do not subscribe to the stable updater feed. */
  canCheckUpdates: boolean
  dialogOpen: boolean
  openDialog: () => void
  closeDialog: () => void
  check: () => void
  download: () => void
  install: () => void
  openDownload: () => void
  /** 失败后的「重试」：重做失败的那一步（下载失败直接重下，不用先重新检查），一次点击生效。 */
  retry: () => void
}

export function useUpdater(): Updater {
  const bridge = getDesktopBridge()
  const update = bridge?.update
  const supported = Boolean(update)
  const updater = useUpdateStore((state) => state.updater)
  const dialogOpen = useUpdateStore((state) => state.dialogOpen)
  const [appInfo, setAppInfo] = React.useState<DesktopAppInfo | null>(null)

  React.useEffect(() => retainUpdateSync(update), [update])
  React.useEffect(() => {
    let alive = true
    void update?.appInfo().then((info) => { if (alive) setAppInfo(info) }).catch(() => undefined)
    return () => { alive = false }
  }, [update])

  // 「已是最新」短暂提示后自动回落到 idle。
  React.useEffect(() => {
    if (updater.phase !== 'up-to-date') return
    const timer = window.setTimeout(() => useUpdateStore.setState({ updater: UPDATER_INITIAL_STATE }), 2500)
    return () => window.clearTimeout(timer)
  }, [updater.phase])

  const check = React.useCallback(() => {
    useUpdateStore.setState((prev) => ({ updater: { ...prev.updater, phase: 'checking', errorMessage: '', errorStage: null, errorReason: null } }))
    void update?.check().catch(() => undefined)
  }, [update])
  const download = React.useCallback(() => {
    useUpdateStore.setState((prev) => ({ updater: { ...prev.updater, phase: 'downloading', percent: 0, errorMessage: '', errorStage: null, errorReason: null } }))
    void update?.download().catch(() => undefined)
  }, [update])
  const install = React.useCallback(() => { void update?.install().catch(() => undefined) }, [update])
  const openDownload = React.useCallback(() => {
    void update?.openDownload().then((result) => {
      if (result.ok) useUpdateStore.setState({ macStepsShown: true })
    }).catch(() => undefined)
  }, [update])
  const retry = React.useCallback(() => {
    const stage = useUpdateStore.getState().updater.errorStage
    if (stage === 'download') download()
    else if (stage === 'install') install()
    else check()
  }, [check, download, install])

  // 未签名 mac 无法就地装；appInfo 未到位时按桌面默认（true），到位后以主进程口径为准。
  return {
    ...updater,
    appInfo,
    supported,
    canAutoInstall: appInfo?.canAutoInstall ?? true,
    canCheckUpdates: appInfo?.canCheckUpdates ?? true,
    dialogOpen,
    openDialog: openUpdateDialog,
    closeDialog: closeUpdateDialog,
    check,
    download,
    install,
    openDownload,
    retry,
  }
}
