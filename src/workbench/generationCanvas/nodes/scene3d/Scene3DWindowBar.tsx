import React from 'react'
import { NomiBrand } from '../../../../design'
import { WindowControls } from '../../../../ui/app-shell/WindowControls'
import { handleWindowTitlebarDoubleClick } from '../../../../ui/app-shell/windowTitlebarDoubleClick'

// 仅 win32 自绘标题栏：mac/Linux 原生 chrome 自带窗口控制，不自绘不重复（同 WorkbenchShell 平台分流）。
// win32 下全屏 3D 场景此前盖住自绘标题栏（没有 logo 和最小化/最大化/关闭）——PR#33 修复，
// 抽成独立组件让 Scene3DFullscreen 守 800 行门（R9）。非 win32 渲染 null。
const isWindows = window.nomiDesktop?.platform === 'win32'

export function Scene3DWindowBar(): JSX.Element | null {
  if (!isWindows) return null
  return (
    <div
      className="app-drag relative z-[2] flex h-8 w-full shrink-0 items-center border-b border-[var(--workbench-border)] bg-[var(--workbench-surface-solid)]"
      onDoubleClick={handleWindowTitlebarDoubleClick}
    >
      <div className="app-no-drag inline-flex h-full items-center pl-4 pr-3">
        <NomiBrand markSize={18} wordSize={14} />
      </div>
      <div className="h-full min-w-0 flex-1" aria-hidden="true" />
      <WindowControls className="app-no-drag" />
    </div>
  )
}
