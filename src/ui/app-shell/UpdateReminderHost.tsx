// 更新提醒的应用级宿主：弹窗常驻挂载（没被请求时什么都不渲染）。
//
// `floatingPill` 是过渡件：外壳线（feat/shell-redesign）把 <UpdatePill /> 摆进 40px 顶栏 / 项目库窗口栏、
// 把 <HotfixBanner /> <UpdatedCard /> 摆进项目库通知位之后，谁后合并谁删掉这个 prop 和下面这一段。
import React, { type JSX } from 'react'
import { UpdateDialog } from './UpdateDialog'
import { UpdatePill } from './UpdatePill'

export function UpdateReminderHost({ floatingPill = false }: { floatingPill?: boolean }): JSX.Element {
  return (
    <>
      {floatingPill ? (
        <div className="fixed right-4 top-[calc(var(--workbench-topbar-height,2.5rem)+0.75rem)] z-[140] empty:hidden rounded-pill border border-nomi-accent bg-nomi-accent-soft shadow-nomi-sm">
          <UpdatePill host="library" />
        </div>
      ) : null}
      <UpdateDialog />
    </>
  )
}
