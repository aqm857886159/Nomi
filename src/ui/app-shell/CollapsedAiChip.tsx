// 右槽互斥（视图 06）：拆解面板占住右槽时，让位的「生成」AI 栏收成顶栏这枚角标。
//
// 为什么落顶栏：顶栏是唯一跨创作/生成/预览三区常驻的 chrome，正是「切走了还能瞥见 Agent 有没有新动静」的
// 锚点（同 TaskCenter 落顶栏的理由，R-C-2）。点角标 = 还原右栏（互斥自动把拆解收成节点浮条）。
//
// 只在生成区、且拆解面板确实占着右槽（AI 栏因此收起）时出现——其余情况 AI 栏自己在右侧，无需这枚角标。
// 形态复刻现役 ghost 钮（h-[30px]）；「有新动静」示意复刻 TaskCenterButton 的数字徽标语法。
import React from 'react'
import { useTranslation } from 'react-i18next'
import { NomiLogoMark, WorkbenchButton } from '../../design'
import { useGenerationCanvasStore } from '../../workbench/generationCanvas/store/generationCanvasStore'
import type { WorkspaceMode } from '../../workbench/workbenchStore'
import { cn } from '../../utils/cn'

type Props = { workspaceMode: WorkspaceMode }

export default function CollapsedAiChip({ workspaceMode }: Props): JSX.Element | null {
  const { t } = useTranslation()
  const openNodeId = useGenerationCanvasStore((state) => state.videoDeconstructionOpenNodeId)
  const collapsed = useGenerationCanvasStore((state) => state.generationAiCollapsed)
  const messageCount = useGenerationCanvasStore((state) => state.generationAiMessages.length)
  const setCollapsed = useGenerationCanvasStore((state) => state.setGenerationAiCollapsed)

  // 只在生成区、拆解占槽、AI 栏因此收起时显示（三者同真才是「让位收顶栏」态）。
  if (workspaceMode !== 'generation' || !openNodeId || !collapsed) return null

  return (
    <WorkbenchButton
      className={cn(
        'nomi-appbar__ghost',
        'app-no-drag relative',
        'inline-flex items-center gap-1.5 h-[30px] px-2.5',
        'border border-transparent rounded-[var(--nomi-radius-sm)]',
        'bg-transparent text-[var(--nomi-ink-80)] font-inherit text-body-sm',
        'transition-[background,color] duration-[var(--nomi-transition-fast)]',
        'hover:bg-[var(--nomi-ink-05)] hover:text-[var(--nomi-ink)]',
      )}
      aria-label={t('appBar.generationCollapsedRestore')}
      data-generation-collapsed-chip="true"
      data-agent-topbar-badge="true"
      onClick={() => setCollapsed(false)}
    >
      <NomiLogoMark size={18} />
      <span>{t('appBar.generationCollapsedChip')}</span>
      {/* 有对话历史（收起前留下的动静）→ 冒 accent 数字徽标；纯空会话不冒（不制造假动静）。 */}
      {messageCount > 0 ? (
        <span
          className="absolute -right-0.5 -top-0.5 size-1.5 rounded-pill bg-nomi-accent"
          data-agent-badge-dot="true"
          aria-label={t('appBar.generationCollapsedUpdates', { count: messageCount })}
          title={t('appBar.generationCollapsedUpdates', { count: messageCount })}
        />
      ) : null}
    </WorkbenchButton>
  )
}
