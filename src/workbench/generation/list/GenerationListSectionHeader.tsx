// 分区标题（样张板 List）：一行——收起钮 + 标题 + 小字统计 + 这份分镜的视觉锚小胶囊 ··· 「生成全部」+ ⋯。
// 「生成全部」和画布分组框的同一个执行口（generationCanvas/components/groupGenerate），同一张付费确认——列表没有自己的批量路径。
// ⋯ 只有分镜分区有：打开这份分镜方案（留在创作页）。
import React, { type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { IconChevronDown, IconDots, IconPlayerPlay } from '@tabler/icons-react'
import { WorkbenchButton, WorkbenchIconButton } from '../../../design'
import { WorkbenchMenu, type WorkbenchMenuAnchorRect, type WorkbenchMenuNode } from '../../../design/menu'
import { cn } from '../../../utils/cn'
import { resolveLightweightNodePreview } from '../../generationCanvas/components/canvasNodeLevelOfDetail'
import { hasGroupGenerateCandidates, runGroupGenerate } from '../../generationCanvas/components/groupGenerate'
import { useGenerationCanvasStore } from '../../generationCanvas/store/generationCanvasStore'
import { useWorkbenchStore } from '../../workbenchStore'
import type { GenerationListAnchor, GenerationListSection } from './generationListModel'
import { sectionGenerateNodeIds } from './generationListSource'

function AnchorChip({ anchor, onOpen }: { anchor: GenerationListAnchor; onOpen: (nodeId: string) => void }): JSX.Element {
  const { t } = useTranslation()
  const node = useGenerationCanvasStore((state) => anchor.nodeId ? state.nodes.find((candidate) => candidate.id === anchor.nodeId) : undefined)
  const preview = node && anchor.ready ? resolveLightweightNodePreview(node) : null
  return (
    <button
      type="button"
      disabled={!anchor.nodeId}
      onClick={() => anchor.nodeId && onOpen(anchor.nodeId)}
      className={cn(
        'inline-flex h-6 shrink-0 items-center gap-1.5 rounded-pill bg-nomi-ink-05 py-0 pl-[3px] pr-2 text-caption enabled:hover:bg-nomi-ink-10 disabled:cursor-default',
        anchor.ready ? 'text-nomi-ink-80' : 'text-nomi-ink-60',
      )}
      data-list-anchor={anchor.key}
    >
      {preview?.kind === 'image'
        ? <img src={preview.src} alt="" className="size-[18px] shrink-0 rounded-full object-cover" />
        : <span className={cn('size-[18px] shrink-0 rounded-full bg-nomi-paper', anchor.ready ? 'ring-1 ring-nomi-line' : 'border border-dashed border-nomi-ink-30')} aria-hidden />}
      <span className="truncate">{anchor.name}</span>
      {anchor.ready ? null : <span className="text-nomi-ink-40">· {t('generationList.anchorPending')}</span>}
    </button>
  )
}

export function GenerationListSectionHeader({
  section,
  collapsed,
  onToggle,
  onOpenAnchor,
}: {
  section: GenerationListSection
  collapsed: boolean
  onToggle: () => void
  onOpenAnchor: (nodeId: string) => void
}): JSX.Element {
  const { t } = useTranslation()
  const setActiveStoryboardId = useWorkbenchStore((state) => state.setActiveStoryboardId)
  const setWorkspaceMode = useWorkbenchStore((state) => state.setWorkspaceMode)
  // 可用态与点击后真正派发的集合同一份推导（groupGenerate.eligibleGroupGenerateIds）。
  // 订阅画布 store 的任何变化（选择器读的是 store 现状），节点状态一变这颗钮的可用态跟着变。
  const canGenerate = useGenerationCanvasStore(() => section.kind !== 'ungrouped' && hasGroupGenerateCandidates(sectionGenerateNodeIds(section)))
  const count = section.cards.length
  const done = section.cards.filter((card) => card.status === 'done' || card.status === 'locked').length
  const title = section.kind === 'storyboard'
    ? t('generationList.storyboardSection', { title: section.title })
    : section.kind === 'group' ? section.title || t('generationList.untitled') : t('generationList.ungrouped')
  const subtitle = section.kind === 'storyboard'
    ? t('generationList.storyboardSubtitle', { count, done })
    : section.kind === 'group' ? t('generationList.groupSubtitle', { count }) : t('generationList.ungroupedSubtitle', { count })
  const triggerRef = React.useRef<HTMLSpanElement | null>(null)
  const [menuOpen, setMenuOpen] = React.useState(false)
  const [menuAnchor, setMenuAnchor] = React.useState<WorkbenchMenuAnchorRect>({ left: 0, top: 0, width: 0, height: 0 })
  const storyboard = section.storyboard
  const menuItems: WorkbenchMenuNode[] = storyboard ? [{
    kind: 'action', id: 'open-plan', label: t('generationList.openPlan'),
    onSelect: () => { setActiveStoryboardId(storyboard.designId, storyboard.documentId); setWorkspaceMode('storyboard') },
  }] : []
  return (
    <div className="flex h-8 min-w-0 items-center gap-2.5" data-section-header={section.key}>
      <button
        type="button"
        onClick={onToggle}
        className="group inline-flex max-w-[45%] shrink-0 items-center gap-1.5 rounded-nomi-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-nomi-accent"
        aria-label={collapsed ? t('generationList.expandSection') : t('generationList.collapseSection')}
        aria-expanded={!collapsed}
      >
        <IconChevronDown size={14} stroke={1.8} className={cn('shrink-0 text-nomi-ink-40 transition-transform group-hover:text-nomi-ink-80', collapsed && '-rotate-90')} />
        <h2 className="m-0 min-w-0 truncate text-body font-semibold text-nomi-ink">{title}</h2>
      </button>
      <span className="shrink-0 text-caption tabular-nums text-nomi-ink-40">{subtitle}</span>
      <span className="ml-1 flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden" data-section-anchors>
        {section.anchors.map((anchor) => <AnchorChip key={anchor.key} anchor={anchor} onOpen={onOpenAnchor} />)}
      </span>
      {section.kind !== 'ungrouped' ? (
        <WorkbenchButton
          size="sm"
          variant="default"
          disabled={!canGenerate}
          data-section-generate={section.key}
          title={canGenerate ? undefined : t('generationList.generateAllEmpty')}
          onClick={() => { runGroupGenerate(sectionGenerateNodeIds(section)) }}
        >
          <IconPlayerPlay size={13} stroke={1.8} aria-hidden /> {t('generationList.generateAll')}
        </WorkbenchButton>
      ) : null}
      {storyboard ? (
        <span ref={triggerRef} className="inline-flex">
          <WorkbenchIconButton
            icon={<IconDots size={16} stroke={1.8} />}
            label={t('generationList.moreActions')}
            size="sm"
            data-section-menu={section.key}
            onClick={() => {
              const rect = triggerRef.current?.getBoundingClientRect()
              if (rect) setMenuAnchor({ left: rect.left, top: rect.top, width: rect.width, height: rect.height })
              setMenuOpen((open) => !open)
            }}
          />
          <WorkbenchMenu
            open={menuOpen}
            onOpenChange={(next) => { if (!next) setMenuOpen(false) }}
            anchorRect={menuAnchor}
            gap={4}
            items={menuItems}
            ariaLabel={t('generationList.moreActions')}
          />
        </span>
      ) : null}
    </div>
  )
}
