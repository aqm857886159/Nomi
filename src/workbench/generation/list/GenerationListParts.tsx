// 生成页列表视图的零件：卡（生成卡 / 工具卡）、分组头、视觉锚条、「未被引用的素材」条、空态。
// 没有批量条、卡上没有勾选（2026-10-08 用户：模型在节点创建时就选好了，批量走分组头的「生成整组」）。
// 卡只读画布 store 里的那个节点（投影见 generationListModel.ts）；改东西只在检查器里，改的就是那个节点。
import React, { type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import {
  IconChevronDown,
  IconCode,
  IconCube,
  IconDownload,
  IconExternalLink,
  IconMovie,
  IconPencil,
  IconScissors,
  IconTable,
  IconWorld,
  IconFileText,
  IconLink,
  IconPhoto,
  IconStack2,
  IconTag,
  IconVideo,
  IconWaveSine,
} from '@tabler/icons-react'
import { DesignBadge, WorkbenchButton, WorkbenchIconButton } from '../../../design'
import { cn } from '../../../utils/cn'
import PromptEditor from '../../assets/PromptEditor'
import { DeferredNodeImage, DeferredNodeVideo } from '../../generationCanvas/nodes/DeferredNodeMedia'
import { resolveLightweightNodePreview } from '../../generationCanvas/components/canvasNodeLevelOfDetail'
import { currentReferenceMedia } from '../../generationCanvas/nodes/mentionCandidates'
import { docToPlainText } from '../../generationCanvas/runner/textGenerationDocument'
import { getGenerationNodeLabel, getGenerationNodeExecutionKind } from '../../generationCanvas/model/generationNodeKinds'
import { readAudioMeta } from '../../generationCanvas/model/nodeMetaFields'
import type { GenerationCanvasNode } from '../../generationCanvas/model/generationCanvasTypes'
import { useGenerationCanvasStore } from '../../generationCanvas/store/generationCanvasStore'
import type { ShotRowStatus } from '../../creation/storyboard/exec/storyboardRowStatus'
import { LEAD_INSET } from './generationListSource'
import { shotLabel, type GenerationListAnchor, type GenerationListCard, type GenerationListSection } from './generationListModel'


type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger'

/** 状态色：只读分镜行的状态词表（SHOT_ROW_STATUSES），这里只决定颜色。 */
function statusTone(status: ShotRowStatus): Tone {
  if (status === 'done' || status === 'locked') return 'success'
  if (status === 'generating') return 'info'
  if (status === 'failed' || status === 'missing-required') return 'danger'
  if (status === 'recoverable' || status === 'anchor-ignored') return 'warning'
  return 'neutral'
}

export function ListStatusTag({ status }: { status: ShotRowStatus }): JSX.Element {
  const { t } = useTranslation()
  return (
    <DesignBadge size="xs" tone={statusTone(status)} tt="none" fw={500} data-list-status={status}>
      {t(`shotTable.status.${status}`)}
    </DesignBadge>
  )
}


function readAspect(node: GenerationCanvasNode | undefined): string | null {
  const value = node?.meta?.aspect_ratio
  return typeof value === 'string' && /^\d+:\d+$/.test(value) ? value : null
}

function readDurationSeconds(node: GenerationCanvasNode): number | null {
  const meta = node.meta ?? {}
  const audio = readAudioMeta(node).durationSec
  const value = node.kind === 'audio' ? audio : meta.duration
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

function formatSeconds(seconds: number): string {
  const whole = Math.round(seconds)
  return whole >= 60 ? `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}` : `${whole}s`
}

function MediaCorner({ children }: { children: React.ReactNode }): JSX.Element {
  return <span className="absolute right-1.5 top-1.5 z-[1] rounded-nomi-sm bg-nomi-ink/60 px-1.5 py-0.5 text-micro font-medium text-nomi-paper">{children}</span>
}

function EmptyMedia({ kind }: { kind: string }): JSX.Element {
  const Icon = kind === 'video' ? IconVideo : kind === 'audio' ? IconWaveSine : kind === 'text' ? IconFileText : IconPhoto
  return (
    <div className="grid size-full place-items-center text-nomi-ink-30" data-list-media-empty={kind}>
      <Icon size={28} stroke={1.4} aria-hidden />
    </div>
  )
}

/** 一条音频的波形条：与画布音频条同一个画法（固定竖条），按时长写在右下。 */
function AudioStrip({ node }: { node: GenerationCanvasNode }): JSX.Element {
  const bars = React.useMemo(() => Array.from({ length: 48 }, (_, index) => 0.3 + 0.6 * Math.abs(Math.sin((index + node.id.length) * 1.7))), [node.id])
  return (
    <div className="flex size-full items-center gap-1 px-4" data-list-media="audio" aria-hidden>
      {bars.map((height, index) => <span key={index} className="min-w-0 flex-1 rounded-full bg-nomi-ink-40" style={{ height: `${Math.round(height * 56)}%` }} />)}
    </div>
  )
}

function TextPreview({ node }: { node: GenerationCanvasNode }): JSX.Element {
  const { t } = useTranslation()
  const text = (docToPlainText(node.contentJson) || node.result?.text || '').trim()
  return (
    <div className="size-full overflow-hidden p-3 text-left" data-list-media="text">
      {text ? <p className="line-clamp-4 whitespace-pre-line text-body-sm leading-relaxed text-nomi-ink-80">{text}</p>
        : <p className="text-body-sm text-nomi-ink-40">{t('generationList.textEmpty')}</p>}
    </div>
  )
}

/** 卡片画面：图 / 视频首帧走画布轻量档同一套（加载队列），音频画波形条，文本取前几行。 */
export function ListCardMedia({ node, height, kind }: { node: GenerationCanvasNode | undefined; height: number; kind: string }): JSX.Element {
  const preview = node ? resolveLightweightNodePreview(node) : null
  const aspect = readAspect(node)
  const duration = node ? readDurationSeconds(node) : null
  const execution = node ? getGenerationNodeExecutionKind(node.kind) : undefined
  return (
    <div className="relative flex items-center justify-center overflow-hidden rounded-nomi-sm bg-nomi-ink-05" style={{ height }} data-list-media-kind={kind}>
      {node?.kind === 'text' || execution === 'text' ? <TextPreview node={node!} />
        : node && execution === 'audio' ? (node.result?.url ? <AudioStrip node={node} /> : <EmptyMedia kind="audio" />)
          : preview?.kind === 'image' ? <DeferredNodeImage src={preview.src} alt="" className="absolute inset-0 size-full object-contain" />
            : preview?.kind === 'video' ? (
              <DeferredNodeVideo src={preview.src} className="absolute inset-0 size-full object-contain" crossOrigin="use-credentials" muted playsInline preload="metadata" controls={false} />
            ) : <EmptyMedia kind={execution ?? kind} />}
      {aspect && execution !== 'audio' && execution !== 'text' ? <MediaCorner>{aspect}</MediaCorner> : null}
      {duration && (execution === 'video' || execution === 'audio') ? (
        <span className="absolute bottom-1.5 right-1.5 z-[1] rounded-nomi-sm bg-nomi-ink/60 px-1.5 py-0.5 text-micro font-medium tabular-nums text-nomi-paper" data-list-duration>{formatSeconds(duration)}</span>
      ) : null}
    </div>
  )
}

function ReferenceChips({ nodeIds }: { nodeIds: readonly string[] }): JSX.Element | null {
  const references = useGenerationCanvasStore((state) => nodeIds.map((id) => state.nodes.find((node) => node.id === id)).filter(Boolean) as GenerationCanvasNode[])
  const { t } = useTranslation()
  if (!references.length) return null
  const shown = references.slice(0, 3)
  return (
    <>
      {shown.map((node) => {
        const preview = resolveLightweightNodePreview(node)
        return (
          <span key={node.id} className="inline-flex min-w-0 max-w-[9rem] items-center gap-1 rounded-pill border border-nomi-line bg-nomi-paper px-1.5 py-0.5 text-micro text-nomi-ink-80" data-list-reference-chip={node.id}>
            {preview?.kind === 'image' ? <img src={preview.src} alt="" className="size-3.5 shrink-0 rounded-[3px] object-cover" /> : <IconPhoto size={12} stroke={1.6} className="shrink-0 text-nomi-ink-40" />}
            <span className="truncate">{node.title || t('generationList.untitled')}</span>
          </span>
        )
      })}
      {references.length > shown.length ? <span className="text-micro text-nomi-ink-40">+{references.length - shown.length}</span> : null}
    </>
  )
}

/** 卡上那一行提示词：现役 PromptEditor 只读渲染，chip 编号与检查器、画布同一颗。 */
function CardPrompt({ node, planPrompt }: { node: GenerationCanvasNode | undefined; planPrompt: string | null }): JSX.Element {
  const { t } = useTranslation()
  const referencesKey = useGenerationCanvasStore((state) => node ? JSON.stringify(currentReferenceMedia(node, state.nodes, state.edges)) : '[]')
  const references = React.useMemo(() => JSON.parse(referencesKey), [referencesKey])
  const prompt = node ? node.prompt ?? '' : planPrompt ?? ''
  if (!prompt.trim()) return <p className="mt-1.5 truncate text-body-sm text-nomi-ink-40">{t('generationList.promptEmpty')}</p>
  return (
    <div className="relative mt-1.5 min-w-0" data-card-prompt>
      <PromptEditor
        value={prompt}
        onChange={() => undefined}
        editable={false}
        mentionReferences={references}
        className="pointer-events-none [&_.ProseMirror]:!min-h-0 [&_.ProseMirror_p]:line-clamp-1"
      />
    </div>
  )
}

function ConnectPreviousButton({ card, mediaHeight }: { card: GenerationListCard; mediaHeight: number }): JSX.Element | null {
  const { t } = useTranslation()
  const previous = card.previous
  if (!previous || !card.nodeId) return null
  const toggle = (event: React.MouseEvent) => {
    event.stopPropagation()
    const canvas = useGenerationCanvasStore.getState()
    if (previous.connected) {
      const edge = canvas.edges.find((candidate) => candidate.source === previous.nodeId && candidate.target === card.nodeId && candidate.mode === 'first_frame')
      if (edge) canvas.disconnectEdge(edge.id)
      return
    }
    // 画布已有的首帧接力：视频源会在生成时抽尾帧当首帧（generationReferenceResolver）。
    canvas.connectNodes(previous.nodeId, card.nodeId!, 'first_frame')
  }
  return (
    <button
      type="button"
      onClick={toggle}
      title={previous.connected ? t('generationList.connectPrevious') : t('generationList.connect')}
      aria-label={t('generationList.connect')}
      aria-pressed={previous.connected}
      data-list-connect-previous={card.key}
      className={cn(
        'absolute -left-8 z-10 inline-flex size-6 -translate-y-1/2 items-center justify-center rounded-pill border shadow-nomi-sm',
        previous.connected ? 'border-nomi-accent bg-nomi-accent text-nomi-paper' : 'border-nomi-line bg-nomi-paper text-nomi-ink-40 hover:text-nomi-ink',
      )}
      style={{ top: 10 + mediaHeight / 2 }}
    >
      <IconLink size={12} stroke={1.7} />
    </button>
  )
}

export function GenerationListCardView({
  card,
  selected,
  mediaHeight,
  onSelect,
  onOpenInCanvas,
}: {
  card: GenerationListCard
  selected: boolean
  mediaHeight: number
  onSelect: () => void
  onOpenInCanvas: () => void
}): JSX.Element {
  const { t } = useTranslation()
  const node = useGenerationCanvasStore((state) => card.nodeId ? state.nodes.find((candidate) => candidate.id === card.nodeId) : undefined)
  if (card.variant === 'tool') return <ToolCard card={card} node={node} onOpenInCanvas={onOpenInCanvas} />
  const kind = node?.kind ?? 'video'
  return (
    <article
      data-list-card={card.key}
      data-list-card-kind={kind}
      className={cn(
        'group relative min-w-0 cursor-pointer rounded-nomi border bg-nomi-paper p-2.5 text-left shadow-nomi-sm transition-[border-color,box-shadow]',
        selected ? 'border-nomi-accent ring-1 ring-inset ring-nomi-accent/25' : 'border-nomi-line hover:border-nomi-ink-30',
      )}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onSelect()
        }
      }}
      role="button"
      tabIndex={0}
      aria-pressed={selected}
    >
      <ConnectPreviousButton card={card} mediaHeight={mediaHeight} />
      <ListCardMedia node={node} height={mediaHeight} kind={kind} />
      <div className="mt-2 flex min-w-0 items-center gap-1.5">
        <span className="truncate text-caption font-semibold text-nomi-ink">{shotLabel(t, card)}</span>
        {card.status ? <ListStatusTag status={card.status} /> : null}
      </div>
      {card.anchor || card.referenceNodeIds.length ? (
        <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1.5">
          {card.anchor ? (
            <span className={cn('inline-flex items-center gap-1 rounded-pill px-1.5 py-0.5 text-micro', card.anchor.ready ? 'bg-nomi-accent-soft text-nomi-accent' : 'bg-nomi-ink-05 text-nomi-ink-60')} data-list-anchor-tag>
              <IconTag size={11} stroke={1.7} />
              {card.anchor.ready ? card.anchor.name : `${card.anchor.name} · ${t('generationList.anchorPending')}`}
            </span>
          ) : null}
          <ReferenceChips nodeIds={card.referenceNodeIds} />
        </div>
      ) : null}
      {/* 文本节点的画面就是它的字；没写提示词时不再多一行「还没写提示词」。 */}
      {kind === 'text' && !node?.prompt?.trim() ? null : <CardPrompt node={node} planPrompt={card.planPrompt} />}
    </article>
  )
}

const TOOL_ICON: Record<string, typeof IconStack2> = {
  clip: IconScissors, director: IconMovie, model3d: IconCube, panorama: IconWorld, whiteboard: IconPencil,
  output: IconDownload, 'agent-artifact': IconCode, shot_table: IconTable, shot: IconFileText,
}

/** 在画布上编辑的工具节点：紧凑卡，点了回画布（和导演台同一个样子）。 */
function ToolCard({ card, node, onOpenInCanvas }: { card: GenerationListCard; node: GenerationCanvasNode | undefined; onOpenInCanvas: () => void }): JSX.Element {
  const { t } = useTranslation()
  const kindLabel = node ? getGenerationNodeLabel(node.kind) : ''
  const Icon = (node && TOOL_ICON[node.kind]) || IconStack2
  return (
    <article
      data-list-card={card.key}
      data-list-card-kind={node?.kind ?? 'tool'}
      data-list-tool-card
      className="flex min-w-0 cursor-pointer items-center gap-3 self-start rounded-nomi border border-nomi-line bg-nomi-paper p-2.5 shadow-nomi-sm hover:border-nomi-ink-30"
      onClick={onOpenInCanvas}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onOpenInCanvas()
        }
      }}
      role="button"
      tabIndex={0}
    >
      <span className="grid size-10 shrink-0 place-items-center rounded-nomi-sm bg-nomi-ink text-nomi-paper">
        <Icon size={20} stroke={1.5} aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-caption font-semibold text-nomi-ink">{card.title || kindLabel}</div>
        <div className="truncate text-micro text-nomi-ink-60">{kindLabel}</div>
      </div>
      <WorkbenchIconButton
        icon={<IconExternalLink size={15} stroke={1.7} />}
        label={t('generationList.openInCanvas')}
        size="sm"
        onClick={(event) => {
          event.stopPropagation()
          onOpenInCanvas()
        }}
      />
    </article>
  )
}

export function GenerationListSectionHeader({
  section,
  collapsed,
  onToggleCollapsed,
  actions,
  lead = false,
}: {
  section: GenerationListSection
  collapsed: boolean
  onToggleCollapsed: () => void
  /** 分镜段与画布分组段右端那颗「生成整组」（第二步接线）；未分组段没有。 */
  actions?: React.ReactNode
  /** 列表第一行：让开左上那颗视图切换钮。 */
  lead?: boolean
}): JSX.Element {
  const { t } = useTranslation()
  const count = section.cards.length
  const title = section.kind === 'storyboard'
    ? t('generationList.storyboardSection', { title: section.title })
    : section.kind === 'group' ? t('generationList.groupSection', { name: section.title }) : t('generationList.ungrouped')
  const subtitle = section.kind === 'storyboard'
    ? t('generationList.storyboardSubtitle', { count })
    : section.kind === 'group' ? t('generationList.groupSubtitle', { count }) : t('generationList.ungroupedSubtitle', { count })
  return (
    <div className={cn('flex items-end justify-between gap-3 pb-2 pt-1', lead && 'pl-8')} data-section-header={section.key}>
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <h2 className="truncate text-body-sm font-semibold text-nomi-ink">{title}</h2>
          <span className="rounded-pill bg-nomi-ink-05 px-1.5 py-0.5 text-micro text-nomi-ink-60">{count}</span>
          <WorkbenchIconButton
            icon={<IconChevronDown size={15} stroke={1.7} className={cn('transition-transform', collapsed && '-rotate-90')} />}
            label={collapsed ? t('generationList.expandSection') : t('generationList.collapseSection')}
            size="sm"
            onClick={onToggleCollapsed}
          />
        </div>
        <p className="mt-0.5 text-micro text-nomi-ink-60">{subtitle}</p>
      </div>
      {actions}
    </div>
  )
}

export function GenerationListAnchorStrip({ anchors, onOpen, lead = false }: { anchors: readonly GenerationListAnchor[]; onOpen: (nodeId: string) => void; lead?: boolean }): JSX.Element | null {
  const { t } = useTranslation()
  if (!anchors.length) return null
  return (
    <div className={cn('flex flex-wrap items-center gap-2 border-b border-nomi-line py-2.5 pr-4', lead ? LEAD_INSET : 'pl-4')} data-list-anchor-strip>
      <span className="shrink-0 text-caption font-semibold text-nomi-ink">{t('generationList.anchors')}</span>
      {anchors.map((anchor) => (
        <button
          key={anchor.key}
          type="button"
          disabled={!anchor.nodeId}
          onClick={() => anchor.nodeId && onOpen(anchor.nodeId)}
          className="inline-flex items-center gap-1.5 rounded-pill border border-nomi-line bg-nomi-paper px-2 py-1 text-caption text-nomi-ink-80 enabled:hover:border-nomi-ink-30 disabled:cursor-default"
        >
          <span className={cn('size-1.5 rounded-full', anchor.ready ? 'bg-nomi-accent' : 'bg-nomi-ink-30')} />
          {anchor.name}
          <span className="text-micro text-nomi-ink-40">{anchor.ready ? t('generationList.anchorReady') : t('generationList.anchorPending')}</span>
        </button>
      ))}
    </div>
  )
}

/** 没有任何卡引用的素材：收在未分组末尾一条，上传的东西不会凭空消失。 */
export function UnreferencedAssetStrip({ nodeIds, onOpen }: { nodeIds: readonly string[]; onOpen: (nodeId: string) => void }): JSX.Element | null {
  const { t } = useTranslation()
  const assets = useGenerationCanvasStore((state) => nodeIds.map((id) => state.nodes.find((node) => node.id === id)).filter(Boolean) as GenerationCanvasNode[])
  if (!assets.length) return null
  return (
    <div className="mt-1 rounded-nomi border border-dashed border-nomi-line px-3 py-2" data-list-unreferenced-assets>
      <div className="mb-1.5 text-micro font-medium text-nomi-ink-60">{t('generationList.unreferencedAssets')} · {assets.length}</div>
      <div className="flex flex-wrap gap-2">
        {assets.map((node) => {
          const preview = resolveLightweightNodePreview(node)
          return (
            <button key={node.id} type="button" onClick={() => onOpen(node.id)} className="inline-flex max-w-[12rem] items-center gap-1.5 rounded-nomi-sm border border-nomi-line bg-nomi-paper p-1 pr-2 text-caption text-nomi-ink-80 hover:border-nomi-ink-30" data-list-unreferenced-asset={node.id}>
              {preview?.kind === 'image' ? <img src={preview.src} alt="" className="size-7 shrink-0 rounded-[4px] object-cover" /> : <span className="grid size-7 shrink-0 place-items-center rounded-[4px] bg-nomi-ink-05"><IconPhoto size={14} stroke={1.6} className="text-nomi-ink-40" /></span>}
              <span className="truncate">{node.title || t('generationList.untitled')}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

export function GenerationListEmpty({ onBackToCanvas }: { onBackToCanvas: () => void }): JSX.Element {
  const { t } = useTranslation()
  return (
    <div className="grid h-full min-h-[320px] place-items-center" data-list-empty>
      <div className="grid justify-items-center gap-3 text-center">
        <span className="grid size-12 place-items-center rounded-full bg-nomi-ink-05 text-nomi-ink-60"><IconStack2 size={24} /></span>
        <h2 className="text-body font-semibold text-nomi-ink">{t('generationList.empty')}</h2>
        <WorkbenchButton size="sm" variant="default" onClick={onBackToCanvas}>{t('generationList.backToCanvas')}</WorkbenchButton>
      </div>
    </div>
  )
}
