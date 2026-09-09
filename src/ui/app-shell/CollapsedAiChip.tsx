import React from 'react'
import { useTranslation } from 'react-i18next'
import { useResidentActivityStore } from '../../workbench/ai/residentActivity'
import { useWorkbenchStore, type WorkspaceMode } from '../../workbench/workbenchStore'
import { dockStatusLabel } from '../../workbench/ai/v4/agentPanelV4DockStatus'
import { useV4Labels } from '../../workbench/ai/v4/agentPanelV4Labels'
import { AgentTopbarChip } from './AgentTopbarChip'
import { agentTopbarChipBadge } from './agentTopbarChipBadge'

type Props = { workspaceMode: WorkspaceMode }

export default function CollapsedAiChip(_props: Props): JSX.Element | null {
  const { t } = useTranslation()
  const labels = useV4Labels()

  // ① 主路：常驻面板收起。状态与计数由面板算好投过来（面板不在顶栏这棵子树里）。
  const dockStatus = useResidentActivityStore((state) => state.dockStatus)
  const dockPendingCount = useResidentActivityStore((state) => state.dockPendingCount)
  const dockUnreadCount = useResidentActivityStore((state) => state.dockUnreadCount)
  const expandResident = useWorkbenchStore((state) => state.setProjectAgentDockCollapsed)

  if (dockStatus) {
    // tooltip 用人话说清是哪一档（「等你确认 1 条」/「Nomi 正在做」/「有一步没成」），
    // 角标本身只有点与数字两种长相——五档图形分不清，五句话分得清。
    const tooltip = `${labels.dock.open} · ${dockStatusLabel(dockStatus, dockPendingCount, labels.dock)}`
    return (
      <AgentTopbarChip
        reason="resident-collapsed"
        label={t('appBar.agentChip')}
        tooltip={tooltip}
        status={dockStatus}
        badge={agentTopbarChipBadge(dockUnreadCount, dockPendingCount, dockStatus === 'failed')}
        settleKey={`${dockUnreadCount}:${dockPendingCount}:${dockStatus}`}
        onOpen={() => expandResident(false)}
      />
    )
  }

  return null
}
