// 顶栏右簇「浏览器」与「设置」之间那一格：**Agent 不在右槽时的那颗角标**。
//
// 09-01 定稿 §11.2「缩小三档」的收起态落在这一格，§11.4 写死了怎么落：
// 「收起角标 = CollapsedAiChip 泛化（从「生成+互斥」三条件放宽到「面板收起」一条件），
//  同格互斥不双显」。所以这里**不是**新加一颗角标，而是把原来那颗放宽——
// 一个组件、一格、一颗钮，两个理由：
//
//  1. `resident-collapsed`：常驻 Agent 面板被用户收起了（四个面通用，这是主路）；
//  2. `deconstruction-exclusive`：过渡期互斥——拆解面板占住生成区右槽，让位的「生成」AI 栏
//     收到这儿（屏 C）。
//
// 为什么必须是同一个组件而不是两个各自返 null 的组件：那样「同格只出一颗」就变成一句
// 靠自觉维持的话，两个组件的显示条件哪天各自漂一点就会双显。写成一个组件、一条 if/else，
// 双显在结构上就不可能发生。
//
// 长相住在 `AgentTopbarChip.tsx`（设计实验室要能脱离宿主把各档截出来）；这里只做判断。
import React from 'react'
import { useTranslation } from 'react-i18next'
import { useGenerationCanvasStore } from '../../workbench/generationCanvas/store/generationCanvasStore'
import { useResidentActivityStore } from '../../workbench/ai/residentActivity'
import { useWorkbenchStore, type WorkspaceMode } from '../../workbench/workbenchStore'
import { dockStatusLabel } from '../../workbench/ai/v4/agentPanelV4DockStatus'
import { useV4Labels } from '../../workbench/ai/v4/agentPanelV4Labels'
import { AgentTopbarChip } from './AgentTopbarChip'
import { agentTopbarChipBadge } from './agentTopbarChipBadge'

type Props = { workspaceMode: WorkspaceMode }

export default function CollapsedAiChip({ workspaceMode }: Props): JSX.Element | null {
  const { t } = useTranslation()
  const labels = useV4Labels()

  // ① 主路：常驻面板收起。状态与计数由面板算好投过来（面板不在顶栏这棵子树里）。
  const dockStatus = useResidentActivityStore((state) => state.dockStatus)
  const dockPendingCount = useResidentActivityStore((state) => state.dockPendingCount)
  const dockUnreadCount = useResidentActivityStore((state) => state.dockUnreadCount)
  const expandResident = useWorkbenchStore((state) => state.setProjectAgentDockCollapsed)

  // ② 过渡期互斥：拆解占槽，生成 AI 栏让位收到顶栏。
  const openNodeId = useGenerationCanvasStore((state) => state.videoDeconstructionOpenNodeId)
  const generationCollapsed = useGenerationCanvasStore((state) => state.generationAiCollapsed)
  const generationMessageCount = useGenerationCanvasStore((state) => state.generationAiMessages.length)
  const expandGeneration = useGenerationCanvasStore((state) => state.setGenerationAiCollapsed)

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

  // 三者同真才是「让位收顶栏」态；其余情况 AI 栏自己在右侧，无需这枚角标。
  if (workspaceMode !== 'generation' || !openNodeId || !generationCollapsed) return null

  // 数字粒本身是 `aria-hidden`（它是那句话的图形版，不是第二条信息），所以条数得写进这句话里，
  // 否则读屏用户只听得到「展开」听不到「有几条」。
  const generationTooltip = generationMessageCount > 0
    ? `${t('appBar.generationCollapsedRestore')} · ${t('appBar.generationCollapsedUpdates', { count: generationMessageCount })}`
    : t('appBar.generationCollapsedRestore')

  return (
    <AgentTopbarChip
      reason="deconstruction-exclusive"
      label={t('appBar.generationCollapsedChip')}
      tooltip={generationTooltip}
      status="idle"
      // 有对话历史（收起前留下的动静）→ 冒角标；纯空会话不冒（不制造假动静）。
      // 这条没有「待你确认」可言，所以待决恒 0：一条历史一颗点，多条才写数字。
      badge={agentTopbarChipBadge(generationMessageCount, 0)}
      settleKey={generationMessageCount}
      onOpen={() => expandGeneration(false)}
    />
  )
}
