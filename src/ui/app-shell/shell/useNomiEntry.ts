// 顶栏 Nomi 入口的数据那一层（NomiEntryTopbar 板 nomi-entry）：原料 → 长相 + 两句话；store 版再接上开 / 收。
// 画在 ShellNomiEntry.tsx（NomiEntryButton 只画）；顶栏、设计实验室、形态探针都从这里拿同一份，不各算各的。
import React from 'react'
import { useTranslation } from 'react-i18next'
import { useResidentActivityStore } from '../../../workbench/ai/residentActivity'
import { requestResidentComposerFocus } from '../../../workbench/ai/residentComposerFocus'
import { dockStatusLabel, type V4DockStatus } from '../../../workbench/ai/v4/agentPanelV4DockStatus'
import { useV4Labels } from '../../../workbench/ai/v4/agentPanelV4Labels'
import { collapseAgent, openAgent, useShownForm, type AgentFormSurface } from './agentFormStore'
import { nomiEntryLook, nomiEntryShortcutPrefix, nomiEntryTooltip, type NomiEntryLook } from './nomiEntryLook'

/** 入口此刻的原料：合并状态（悬停那句中段）、脸状态（不算待确认）、待确认数、未读数（含待确认那几条）、面板开没开、顶栏够不够宽。 */
export type NomiEntryState = {
  status: V4DockStatus | null
  face: V4DockStatus | null
  pendingCount: number
  unread: number
  open: boolean
  roomy: boolean
}

/** 原料 → 长相 + 胶囊那句 + 悬停 / 读屏那句。store 版（useNomiEntry）和设计实验室（NomiEntryPreview）共用这一份。 */
export function useNomiEntryView({ status, face, pendingCount, unread, open, roomy }: NomiEntryState): {
  look: NomiEntryLook
  label: string
  capsuleText: string
} {
  const { t } = useTranslation()
  const labels = useV4Labels()
  // 未读不含等你确认那几条（那几条已经在胶囊 / 角标里点名），同旧小球的算法。
  const unreadCount = Math.max(0, unread - pendingCount)
  const look = nomiEntryLook({ face, pendingCount, unreadCount, open, roomy })
  const mod = nomiEntryShortcutPrefix(typeof navigator !== 'undefined' ? navigator.platform : '')
  const capsuleText = t('appShell.agent.entryPending', { count: pendingCount })
  const label = nomiEntryTooltip(look, { pendingCount, unreadCount, open }, {
    open: t('appShell.agent.entryOpen', { shortcut: `${mod}J` }),
    collapse: t('appShell.agent.withShortcut', { label: t('agentPanelV4.collapsePanel'), shortcut: `${mod}\\` }),
    pending: () => capsuleText,
    status: status ? dockStatusLabel(status, pendingCount, labels.dock) : labels.dock.idle,
    unread: (count) => t('appShell.agent.entryUnread', { count }),
  })
  return { look, label, capsuleText }
}

/** 入口要的全部东西：长相、那一句、开没开、点一下做什么。只读 residentActivity 的角标投影和这一页的形态。 */
export function useNomiEntry(surface: AgentFormSurface, roomy: boolean): {
  look: NomiEntryLook
  label: string
  capsuleText: string
  pendingCount: number
  open: boolean
  toggle: () => void
} {
  const status = useResidentActivityStore((state) => state.dockStatus)
  const face = useResidentActivityStore((state) => state.dockFaceStatus)
  const pendingCount = useResidentActivityStore((state) => state.dockPendingCount)
  const unread = useResidentActivityStore((state) => state.dockUnreadCount)
  const open = useShownForm(surface) !== 'collapsed'
  const { look, label, capsuleText } = useNomiEntryView({ status, face, pendingCount, unread, open, roomy })
  const toggle = React.useCallback(() => {
    if (open) {
      collapseAgent(surface)
      return
    }
    openAgent(surface)
    requestResidentComposerFocus()
  }, [open, surface])
  return { look, label, capsuleText, pendingCount, open, toggle }
}
