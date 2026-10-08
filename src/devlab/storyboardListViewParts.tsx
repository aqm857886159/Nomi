// 列表视图的零件：卡、分组头（带「生成整组」）、视觉锚条、检查器。
// 没有批量条、卡上没有勾选（2026-10-08 用户：模型在节点创建时就选好了，批量走编组的「生成整组」）。
// 检查器正文 = 现役 NodeGenerationComposer（host="panel"）——和画布节点、Agent 付费卡是同一张生成框；
// 卡上提示词 = 现役 PromptEditor（只读），chip 编号从同一份参考边推出。
import React, { type JSX } from 'react'
import { IconDots, IconExternalLink, IconEye, IconLink, IconMovie, IconChevronDown, IconPlayerPlay, IconTag, IconX } from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'
import { DesignBadge, DesignSegmentedControl, WorkbenchButton, WorkbenchIconButton } from '../design'
import PromptEditor from '../workbench/assets/PromptEditor'
import NodeGenerationComposer from '../workbench/generationCanvas/nodes/NodeGenerationComposer'
import { ToolbarButton, TOOLBAR_ICON } from '../workbench/generationCanvas/nodes/NodeFloatingToolbar'
import { currentReferenceMedia } from '../workbench/generationCanvas/nodes/mentionCandidates'
import { useGenerationCanvasStore } from '../workbench/generationCanvas/store/generationCanvasStore'
import { shotArt } from './listViewArt'
import { SuggestionLayer, type Suggestion } from './referencePromptKit'
import {
  ANCHOR_IDS,
  listCopy,
  REFS,
  refName,
  statusLabel,
  statusTone,
  type ListCard,
  type ListSection,
  type ListViewLocale,
  type ListViewState,
} from './storyboardListViewData'

export function MediaBox({ card, height = 104 }: { card: ListCard; height?: number }): JSX.Element {
  if (card.kind === 'director') {
    return (
      <div className="grid place-items-center rounded-nomi-sm bg-nomi-ink text-nomi-paper" style={{ height }}>
        <IconMovie size={28} stroke={1.5} />
      </div>
    )
  }
  return (
    <div className="relative flex items-center justify-center overflow-hidden rounded-nomi-sm bg-nomi-ink-05" style={{ height }}>
      <div
        className="relative max-h-full max-w-full overflow-hidden rounded-nomi-sm"
        style={
          card.ratio === '9:16'
            ? { height: '100%', aspectRatio: '9 / 16' }
            : { width: '100%', maxHeight: '100%', aspectRatio: card.ratio.replace(':', '/') }
        }
      >
        <img className="absolute inset-0 size-full object-contain" src={card.art} alt="" />
        <span className="absolute right-1.5 top-1.5 rounded-nomi-sm bg-nomi-ink/60 px-1.5 py-0.5 text-micro font-medium text-nomi-paper">
          {card.ratio}
        </span>
      </div>
    </div>
  )
}

function AnchorChip({ card, locale }: { card: ListCard; locale: ListViewLocale }): JSX.Element | null {
  const t = listCopy[locale]
  if (!card.anchor) return null
  const pending = !REFS[card.anchor].ready
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-pill px-1.5 py-0.5 text-micro ${pending ? 'bg-nomi-ink-05 text-nomi-ink-60' : 'bg-nomi-accent-soft text-nomi-accent'}`}
    >
      <IconTag size={11} stroke={1.7} />
      {pending ? `${refName(card.anchor, locale)} · ${t.pending}` : refName(card.anchor, locale)}
    </span>
  )
}

/** 状态标签：句首大写、不全大写（Mantine Badge 默认 uppercase，这里按设计系统状态标签写法关掉）。 */
export function StatusTag({ card, locale }: { card: ListCard; locale: ListViewLocale }): JSX.Element {
  return (
    <DesignBadge size="xs" tone={statusTone(card.status)} tt="none" fw={500}>
      {statusLabel(card.status, locale)}
    </DesignBadge>
  )
}

/** 卡上那一行提示词：现役 PromptEditor 只读渲染，chip 与检查器、画布同一颗。 */
export function CardPrompt({
  card,
  suggestions = [],
}: {
  card: ListCard
  suggestions?: Suggestion[]
}): JSX.Element {
  const node = useGenerationCanvasStore((state) => state.nodes.find((candidate) => candidate.id === card.id))
  const referencesKey = useGenerationCanvasStore((state) =>
    node ? JSON.stringify(currentReferenceMedia(node, state.nodes, state.edges)) : '[]',
  )
  const references = React.useMemo(() => JSON.parse(referencesKey), [referencesKey])
  const rootRef = React.useRef<HTMLDivElement>(null)
  return (
    <div ref={rootRef} className="relative mt-1.5 min-w-0" data-card-prompt={card.id}>
      <PromptEditor
        value={node?.prompt ?? ''}
        onChange={() => undefined}
        editable={false}
        mentionReferences={references}
        className="pointer-events-none [&_.ProseMirror]:!min-h-0 [&_.ProseMirror_p]:line-clamp-1"
      />
      {suggestions.length ? (
        <SuggestionLayer rootRef={rootRef} suggestions={suggestions} openKey={null} onOpenChange={() => undefined} onPick={() => undefined} />
      ) : null}
    </div>
  )
}

function ConnectionButton({
  active,
  locale,
  mediaHeight,
  onClick,
}: {
  active: boolean
  locale: ListViewLocale
  mediaHeight: number
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void
}): JSX.Element {
  const t = listCopy[locale]
  return (
    <button
      type="button"
      onClick={onClick}
      title={active ? t.connectPrevious : t.connect}
      aria-pressed={active}
      className={`absolute -left-8 z-10 inline-flex size-6 -translate-y-1/2 items-center justify-center rounded-pill border text-micro shadow-nomi-sm ${active ? 'border-nomi-accent bg-nomi-accent text-nomi-paper' : 'border-nomi-line bg-nomi-paper text-nomi-ink-40 hover:text-nomi-ink'}`}
      style={{ top: 10 + mediaHeight / 2 }}
    >
      <IconLink size={12} stroke={1.7} />
    </button>
  )
}

export function ListCardView({
  card,
  locale,
  index,
  mediaHeight,
  suggestions,
  onSelect,
  onConnect,
}: {
  card: ListCard
  locale: ListViewLocale
  index: number
  mediaHeight: number
  suggestions?: Suggestion[]
  /** 点卡 = 开检查器（模型 / 参数在那里改；卡上没有勾选，批量生成走分组头的「生成整组」）。 */
  onSelect: () => void
  onConnect: () => void
}): JSX.Element {
  const t = listCopy[locale]
  return (
    <article
      data-list-card={card.id}
      className={`group relative rounded-nomi border bg-nomi-paper p-2.5 shadow-nomi-sm transition-[border-color,box-shadow] ${card.selected ? 'border-nomi-accent ring-1 ring-inset ring-nomi-accent/25' : 'border-nomi-line hover:border-nomi-ink-30'}`}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') onSelect()
      }}
      role="button"
      tabIndex={0}
    >
      {card.kind === 'shot' && index > 0 ? (
        <ConnectionButton
          active={Boolean(card.connectionOn)}
          locale={locale}
          mediaHeight={mediaHeight}
          onClick={(event) => {
            event.stopPropagation()
            onConnect()
          }}
        />
      ) : null}
      <MediaBox card={card} height={mediaHeight} />
      <div className="mt-2 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-caption font-semibold text-nomi-ink">{locale === 'en' ? card.titleEn : card.title}</span>
            {card.kind === 'shot' ? <StatusTag card={card} locale={locale} /> : null}
          </div>
          {card.anchor || card.autoReference ? (
            <div className="mt-1 flex items-center gap-1.5">
              <AnchorChip card={card} locale={locale} />
              {card.autoReference ? <span className="text-micro text-nomi-ink-40">· {t.autoRef}</span> : null}
            </div>
          ) : null}
        </div>
        {card.kind === 'director' ? (
          <WorkbenchIconButton icon={<IconExternalLink size={15} stroke={1.7} />} label={t.openCanvas} size="sm" />
        ) : (
          <WorkbenchIconButton icon={<IconDots size={16} stroke={1.7} />} label={t.cardMenu} size="sm" />
        )}
      </div>
      {card.kind === 'director' ? (
        <p className="mt-1.5 line-clamp-1 text-body-sm text-nomi-ink">{locale === 'en' ? card.promptEn : card.prompt}</p>
      ) : (
        <CardPrompt card={card} suggestions={suggestions} />
      )}
    </article>
  )
}

/**
 * 分组头。分镜段和每个画布分组段右端一颗「生成整组」——就是画布组工具条上那一颗
 * （CanvasGroupToolbar 的 ToolbarButton + IconPlayerPlay + `generationCommon.canvas.group.toolbarGenerate`），
 * 同一个组件、同一句文案；未分组段不给（未分组的节点各自在自己的节点上生成）。
 */
export function SectionHeader({
  section,
  locale,
  onGenerate,
}: {
  section: ListSection
  locale: ListViewLocale
  onGenerate?: () => void
}): JSX.Element {
  const { t } = useTranslation()
  return (
    <div className="mb-2 flex items-end justify-between gap-3" data-section-header={section.id}>
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <h2 className="text-body-sm font-semibold text-nomi-ink">{locale === 'en' ? section.titleEn : section.title}</h2>
          <span className="rounded-pill bg-nomi-ink-05 px-1.5 py-0.5 text-micro text-nomi-ink-60">{section.cards.length}</span>
          <WorkbenchIconButton icon={<IconChevronDown size={15} stroke={1.7} />} label={listCopy[locale].collapseGroup} size="sm" />
        </div>
        <p className="mt-0.5 text-micro text-nomi-ink-60">{locale === 'en' ? section.subtitleEn : section.subtitle}</p>
      </div>
      {onGenerate ? (
        <ToolbarButton
          icon={<IconPlayerPlay size={TOOLBAR_ICON.size} stroke={TOOLBAR_ICON.stroke} />}
          label={t('generationCommon.canvas.group.toolbarGenerate')}
          accent
          actionId="section-generate"
          onClick={onGenerate}
        />
      ) : null}
    </div>
  )
}

export function AnchorStrip({ locale }: { locale: ListViewLocale }): JSX.Element {
  const t = listCopy[locale]
  return (
    <div className="flex items-center gap-2 overflow-hidden border-b border-nomi-line px-4 py-2.5">
      <span className="shrink-0 text-caption font-semibold text-nomi-ink">{t.anchors}</span>
      {ANCHOR_IDS.map((id) => (
        <span
          key={id}
          className="inline-flex items-center gap-1.5 rounded-pill border border-nomi-line bg-nomi-paper px-2 py-1 text-caption text-nomi-ink-80"
        >
          <span className={`size-1.5 rounded-full ${REFS[id].ready ? 'bg-nomi-accent' : 'bg-nomi-ink-30'}`} />
          {refName(id, locale)}
          <span className="text-micro text-nomi-ink-40">{REFS[id].ready ? t.locked : t.pending}</span>
        </span>
      ))}
    </div>
  )
}

// ── 检查器 ──────────────────────────────────────────────────────────────────

export function InspectorPanel({
  card,
  locale,
  onClose,
  promptOverlay,
}: {
  card: ListCard
  locale: ListViewLocale
  onClose: () => void
  /** 自动引用样张往检查器提示词上挂的那层（建议线 / 候选层 / chip 去掉钮）。 */
  promptOverlay?: (rootRef: React.RefObject<HTMLElement | null>) => React.ReactNode
}): JSX.Element {
  const t = listCopy[locale]
  const node = useGenerationCanvasStore((state) => state.nodes.find((candidate) => candidate.id === card.id))
  const composerRef = React.useRef<HTMLDivElement>(null)
  return (
    <aside className="min-w-0 border-l border-nomi-line bg-nomi-paper" data-list-inspector={card.id}>
      <div className="flex items-center justify-between gap-2 border-b border-nomi-line px-4 py-3">
        <div className="min-w-0">
          <div className="truncate text-body-sm font-semibold text-nomi-ink">{locale === 'en' ? card.titleEn : card.title}</div>
          <div className="mt-0.5 text-caption text-nomi-ink-60">
            {locale === 'en' ? card.groupLabelEn : card.groupLabel} · {card.ratio}
          </div>
        </div>
        <WorkbenchIconButton icon={<IconX size={15} stroke={1.7} />} label={t.close} size="sm" onClick={onClose} />
      </div>
      <div className="p-4">
        <MediaBox card={card} height={190} />
        <div ref={composerRef} className="relative mt-4" data-inspector-composer>
          {node && card.kind !== 'director' ? (
            <NodeGenerationComposer node={node} visualSize={{ width: 340, height: 192 }} host="panel" onFeedback={() => undefined} />
          ) : null}
          {promptOverlay ? promptOverlay(composerRef) : null}
        </div>
        <section className="mt-4 border-t border-nomi-line pt-3">
          <div className="mb-2 flex items-center justify-between text-caption font-semibold text-nomi-ink-60">
            <span>{t.versions}</span>
            <span className="text-micro font-normal text-nomi-ink-40">3</span>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {[1, 2, 3].map((version) => (
              <div key={version} className={`relative overflow-hidden rounded-nomi-sm border ${version === 3 ? 'border-nomi-accent' : 'border-nomi-line'}`}>
                <img className="aspect-square size-full object-cover" src={shotArt(version + 20, '1:1', '#3b4657|#151a22')} alt="" />
                <span className="absolute bottom-1 left-1 rounded-pill bg-nomi-ink/60 px-1.5 py-0.5 text-micro text-nomi-paper">v{version}</span>
              </div>
            ))}
          </div>
        </section>
        <div className="mt-4 flex justify-end">
          <WorkbenchButton size="sm" variant="default" onClick={() => undefined}>
            <IconEye size={14} /> {t.openCanvas}
          </WorkbenchButton>
        </div>
      </div>
    </aside>
  )
}

export function AppChrome({
  locale,
  state,
  view,
  hideLabHeader,
  onLocale,
  onView,
}: {
  locale: ListViewLocale
  state: ListViewState
  view: 'canvas' | 'list'
  hideLabHeader: boolean
  onLocale: (locale: ListViewLocale) => void
  onView: (view: 'canvas' | 'list') => void
}): JSX.Element {
  const t = listCopy[locale]
  return (
    <header className="border-b border-nomi-line bg-nomi-paper px-4 py-3">
      {!hideLabHeader ? (
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-h3 font-semibold text-nomi-ink">{t.title}</h1>
            <p className="mt-1 text-body-sm text-nomi-ink-60">{t.subtitle}</p>
          </div>
          <DesignSegmentedControl
            size="xs"
            value={locale}
            onChange={(value) => onLocale(value as ListViewLocale)}
            data={[
              { label: '中', value: 'zh' },
              { label: 'EN', value: 'en' },
            ]}
          />
        </div>
      ) : null}
      <div className={`${hideLabHeader ? '' : 'mt-3 '}flex flex-wrap items-center justify-between gap-2`}>
        <DesignSegmentedControl
          size="xs"
          value={view}
          data={[
            { label: t.canvas, value: 'canvas' },
            { label: t.list, value: 'list' },
          ]}
          onChange={(value) => onView(value as 'canvas' | 'list')}
        />
        <div className="flex items-center gap-2 text-caption text-nomi-ink-60">
          <span>
            {t.canvasNodes} · {state === 'long' ? '50' : state === 'empty' && view === 'canvas' ? '0' : '12'}
          </span>
          <WorkbenchIconButton icon={<IconDots size={16} />} label={t.moreView} size="sm" />
        </div>
      </div>
    </header>
  )
}
