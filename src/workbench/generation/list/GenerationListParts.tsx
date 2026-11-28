import { generationFailureActions } from '../../observability/generationFailureActions'
import { selectIsNodeQueued, useGenerationQueueStore } from '../../generationCanvas/runner/generationQueueStore'
// 生成页列表视图的共享零件：状态标签、网格卡片轻量媒体框、「未被引用的素材」条、列表同源新建/导入条与空态。
// 注意：节点真实正文与交互（可编辑富文本、真 `<audio>` 播放/进度与转写 SRT、内联操作条）统一在 `NodeStageSurface`，
// 绝不在本文件手写只读 4 行 TextPreview 或 48 根静态假竖条 AudioStrip（P1）。
import React, { type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import {
  IconAlertTriangle,
  IconFileText,
  IconLoader2,
  IconPhoto,
  IconPlus,
  IconStack2,
  IconVideo,
  IconWaveSine,
} from '@tabler/icons-react'
import { DesignBadge, WorkbenchButton, WorkbenchMenu, type WorkbenchMenuIcon, type WorkbenchMenuNode } from '../../../design'
import { cn } from '../../../utils/cn'
import {
  intentActionLabel,
  intentCardLabel,
  intentIcon,
  intentLabel,
  useCanvasAddIntentAction,
} from '../../generationCanvas/components/canvasAddIntentActions'
import {
  canvasMoreAddSections,
  canvasResidentAddIntents,
  type CanvasAddIntent,
} from '../../generationCanvas/components/canvasToolbarModel'
import { DeferredNodeImage, DeferredNodeVideo } from '../../generationCanvas/nodes/DeferredNodeMedia'
import { resolveLightweightNodePreview } from '../../generationCanvas/components/canvasNodeLevelOfDetail'
import { docToPlainText } from '../../generationCanvas/runner/textGenerationDocument'
import { getGenerationNodeExecutionKind } from '../../generationCanvas/model/generationNodeKinds'
import type { GenerationCanvasNode, GenerationNodeKind } from '../../generationCanvas/model/generationCanvasTypes'
import { useCanvasMenuPreferenceStore } from '../../generationCanvas/store/canvasMenuPreferenceStore'
import { selectCanvasNodeById } from '../../generationCanvas/store/canvasNodeGenerationIndex'
import { useGenerationCanvasStore } from '../../generationCanvas/store/generationCanvasStore'
import { useWorkbenchStore } from '../../workbenchStore'
import type { ShotRowStatus } from '../../creation/storyboard/exec/storyboardRowStatus'

type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger'

function statusTone(status: ShotRowStatus): Tone {
  if (status === 'done' || status === 'locked') return 'success'
  if (status === 'generating') return 'info'
  if (status === 'failed' || status === 'missing-required') return 'danger'
  if (status === 'recoverable' || status === 'anchor-ignored') return 'warning'
  return 'neutral'
}

export function ListStatusTag({ status, queued = false }: { status: ShotRowStatus; queued?: boolean }): JSX.Element {
  const { t } = useTranslation()
  return (
    <DesignBadge size="xs" tone={queued ? 'info' : statusTone(status)} tt="none" fw={500} data-list-status={queued ? 'queued' : status}>
      {queued ? t('generationCommon.observability.progress.queued') : t(`shotTable.status.${status}`)}
    </DesignBadge>
  )
}

function EmptyMedia({ kind }: { kind: string }): JSX.Element {
  const Icon = kind === 'video' ? IconVideo : kind === 'audio' ? IconWaveSine : kind === 'text' ? IconFileText : IconPhoto
  return (
    <div className="grid size-full place-items-center text-nomi-ink-30" data-list-media-empty={kind}>
      <Icon size={28} stroke={1.4} aria-hidden />
    </div>
  )
}

/**
 * 网格卡片轻量画面（只服务 256×144 列表网格卡；大详情一律走同源 `NodeStageSurface`）：
 * 图 / 视频首帧走画布轻量加载队列；声音卡诚实展示配音/转写摘要芯片（不画假静态波形）；文本卡摘要在卡片本体。
 */
export function ListCardMedia({
  node,
  height,
  kind,
  fit = 'cover',
  width,
}: {
  node: GenerationCanvasNode | undefined
  height: number | string
  kind: string
  fit?: 'cover' | 'contain'
  width?: number
}): JSX.Element {
  const { t } = useTranslation()
  const preview = node ? resolveLightweightNodePreview(node) : null
  const execution = node ? getGenerationNodeExecutionKind(node.kind) : undefined
  const queued = useGenerationQueueStore((state) => Boolean(node && selectIsNodeQueued(state, node.id)))
  const running = queued || node?.status === 'queued' || node?.status === 'running'
  const failed = node?.status === 'error'
  const fitClass = fit === 'cover' ? 'object-cover' : 'object-contain'
  const framed = !preview || fit === 'contain'
  const placeholder = execution === 'text' || execution === 'audio' ? null : running ? 'running' : failed ? 'failed' : null
  const transcriptText = node?.result?.type === 'text' ? (node.result.text || '').trim() : ''
  const textSummary = node && (node.kind === 'text' || execution === 'text')
    ? (docToPlainText(node.contentJson) || node.result?.text || '').trim()
    : ''

  return (
    <div
      className={cn(
        'relative flex items-center justify-center overflow-hidden rounded-panel',
        framed && (placeholder === 'failed' ? 'bg-nomi-danger-soft' : 'bg-nomi-ink-05'),
      )}
      style={{ height, width }}
      data-list-media-kind={kind}
    >
      {node?.kind === 'text' || execution === 'text' ? (
        <div className="flex size-full flex-col justify-between p-3.5 text-left" data-list-media="text-summary">
          <p className={cn('m-0 line-clamp-3 whitespace-pre-line text-body-sm leading-relaxed', textSummary ? 'text-nomi-ink-80' : 'text-nomi-ink-40')}>
            {textSummary || t('generationList.textEmpty')}
          </p>
          <span className="inline-flex items-center gap-1 text-micro text-nomi-ink-40">
            <IconFileText size={13} stroke={1.6} aria-hidden />
            {t('generationCommon.textDocument.label')}
          </span>
        </div>
      ) : node && execution === 'audio' ? (
        transcriptText ? (
          <div className="flex size-full flex-col justify-between p-3.5 text-left" data-list-media="audio-transcript">
            <p className="m-0 line-clamp-3 text-body-sm leading-relaxed text-nomi-ink-80">{transcriptText}</p>
            <span className="inline-flex items-center gap-1 text-micro text-nomi-accent">
              <IconFileText size={13} stroke={1.6} aria-hidden />
              {t('generationCommon.audio.generateSubtitle')}
            </span>
          </div>
        ) : node.result?.url ? (
          <div className="flex size-full flex-col items-center justify-center gap-2 px-4 text-center" data-list-media="audio-ready">
            <span className="grid size-10 place-items-center rounded-full bg-nomi-ink text-nomi-paper">
              <IconWaveSine size={18} stroke={1.7} aria-hidden />
            </span>
            <span className="max-w-full truncate text-caption text-nomi-ink-60">{node.title || t('generationCommon.audio.title')}</span>
          </div>
        ) : (
          <EmptyMedia kind="audio" />
        )
      ) : preview?.kind === 'image' ? (
        <DeferredNodeImage src={preview.src} alt="" className={cn('absolute inset-0 size-full', fitClass)} />
      ) : preview?.kind === 'video' ? (
        <DeferredNodeVideo src={preview.src} className={cn('absolute inset-0 size-full', fitClass)} crossOrigin="use-credentials" muted playsInline preload="metadata" controls={false} />
      ) : placeholder ? null : (
        <EmptyMedia kind={execution ?? kind} />
      )}
      {placeholder === 'running' ? (
        <span className={cn('absolute inset-0 z-[1] grid place-items-center text-nomi-ink-60', preview && 'bg-nomi-paper/50')} data-list-media-running>
          {queued ? t('generationCommon.observability.progress.queued') : <IconLoader2 size={24} stroke={1.6} className="motion-safe:animate-spin" aria-label={t('generationList.generating')} />}
        </span>
      ) : null}
      {placeholder === 'failed' ? (
        <span className="absolute inset-0 z-[1] flex flex-col items-center justify-center gap-1.5 px-4 text-center text-nomi-danger" data-list-media-failed>
          <IconAlertTriangle size={22} stroke={1.6} aria-hidden />
          {node?.error ? <span className="line-clamp-2 text-caption">{generationFailureActions(node.error, node.runs?.[0]).reason}</span> : null}
        </span>
      ) : null}
    </div>
  )
}

/** 没有任何卡引用的素材：收在未分组末尾一条，上传的东西不会凭空消失。 */
export function UnreferencedAssetStrip({ nodeIds, onOpen }: { nodeIds: readonly string[]; onOpen: (nodeId: string) => void }): JSX.Element | null {
  const { t } = useTranslation()
  const assets = useGenerationCanvasStore((state) =>
    nodeIds.map((id) => selectCanvasNodeById(state, id)).filter(Boolean) as GenerationCanvasNode[],
  )
  if (!assets.length) return null
  return (
    <div className="mt-1 rounded-panel border border-dashed border-nomi-line px-3 py-2" data-list-unreferenced-assets>
      <div className="mb-1.5 text-micro font-medium text-nomi-ink-60">{t('generationList.unreferencedAssets')} · {assets.length}</div>
      <div className="flex flex-wrap gap-2">
        {assets.map((node) => {
          const preview = resolveLightweightNodePreview(node)
          return (
            <button
              key={node.id}
              type="button"
              onClick={() => onOpen(node.id)}
              className="inline-flex max-w-[12rem] items-center gap-1.5 rounded-nomi-sm border border-nomi-line bg-nomi-paper p-1 pr-2 text-caption text-nomi-ink-80 hover:border-nomi-ink-30"
              data-list-unreferenced-asset={node.id}
            >
              {preview?.kind === 'image'
                ? <img src={preview.src} alt="" className="size-7 shrink-0 rounded-nomi-sm object-cover" />
                : <span className="grid size-7 shrink-0 place-items-center rounded-nomi-sm bg-nomi-ink-05"><IconPhoto size={14} stroke={1.6} className="text-nomi-ink-40" /></span>}
              <span className="truncate">{node.title || t('generationList.untitled')}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

const DEFAULT_INSERTION_ORIGIN = (): { x: number; y: number } => ({ x: 120, y: 120 })

/**
 * 列表视图直接新建节点 / 导入素材入口（复用画布 `canvasToolbarModel` 同一张意图表与 `useCanvasAddIntentAction`，零并行创建逻辑）：
 * - `variant="toolbar"`：网格顶栏紧凑横条；
 * - `variant="empty"`：空列表居中和画布空态同源的一排起步卡片。
 */
export function ListCreateBar({
  variant,
  onCreatedNode,
}: {
  variant: 'toolbar' | 'empty'
  onCreatedNode?: (created: { id: string; kind: GenerationNodeKind }) => void
}): JSX.Element {
  const { t } = useTranslation()
  const activeCategoryId = useWorkbenchStore((state) => state.activeCategoryId) || 'shots'
  const preference = useCanvasMenuPreferenceStore((state) => state.preference)
  const addIntent = useCanvasAddIntentAction({
    getInsertionPosition: DEFAULT_INSERTION_ORIGIN,
    categoryId: activeCategoryId,
    onCreatedNode,
  })
  const [moreOpen, setMoreOpen] = React.useState(false)
  const [moreRect, setMoreRect] = React.useState({ left: 0, top: 0, width: 0, height: 0 })
  const moreRef = React.useRef<HTMLButtonElement>(null)

  const moreItems = React.useMemo<WorkbenchMenuNode[]>(() => {
    return canvasMoreAddSections(preference).map((section) => ({
      kind: 'group' as const,
      id: `list-more-${section.id}`,
      label: t(section.labelKey),
      items: section.intents.map((intent) => ({
        id: `list-intent-${intent.id}`,
        label: intentLabel(intent, t),
        icon: intentIcon(intent) as unknown as WorkbenchMenuIcon,
        onSelect: () => addIntent.run(intent),
      })),
    }))
  }, [addIntent, preference, t])

  const openMore = () => {
    const rect = moreRef.current?.getBoundingClientRect()
    if (rect) setMoreRect({ left: rect.left, top: rect.top, width: rect.width, height: rect.height })
    setMoreOpen((prev) => !prev)
  }

  const residentIntents: readonly CanvasAddIntent[] = canvasResidentAddIntents(preference)

  if (variant === 'empty') {
    const tileClass = cn(
      'inline-flex h-16 w-[68px] cursor-pointer flex-col items-center justify-center gap-1.5 rounded-nomi border-0 bg-nomi-paper p-0',
      'font-[inherit] text-caption text-nomi-ink-80 shadow-nomi-sm ring-1 ring-inset ring-nomi-line',
      'transition-colors hover:bg-nomi-ink-05 active:bg-nomi-ink-10',
      'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-nomi-ink',
    )
    return (
      <div className="flex max-w-[34rem] flex-wrap items-center justify-center gap-2" role="toolbar" aria-label={t('generationList.createBarAria')} data-list-create-bar="empty" data-board="list.create-bar">
        {addIntent.pickerInput}
        {residentIntents.map((intent) => {
          const Icon = intentIcon(intent)
          return (
            <button
              key={intent.id}
              type="button"
              data-add-intent={intent.id}
              className={tileClass}
              aria-label={intentActionLabel(intent, t)}
              onClick={() => addIntent.run(intent)}
            >
              <Icon size={20} stroke={1.5} />
              <span>{intentCardLabel(intent, t)}</span>
            </button>
          )
        })}
        {moreItems.length > 0 ? (
          <>
            <button
              ref={moreRef}
              type="button"
              data-list-add-more="true"
              aria-haspopup="menu"
              aria-expanded={moreOpen}
              className={cn(tileClass, moreOpen && 'bg-nomi-ink-05')}
              onClick={openMore}
            >
              <IconPlus size={20} stroke={1.5} />
              <span>{t('canvas.addSections.more')}</span>
            </button>
            <WorkbenchMenu
              open={moreOpen}
              onOpenChange={(next) => { if (!next) setMoreOpen(false) }}
              anchorRect={moreRect}
              gap={6}
              items={moreItems}
              ariaLabel={t('canvas.moreMenu')}
            />
          </>
        ) : null}
      </div>
    )
  }

  const chipClass = cn(
    'inline-flex h-7 items-center gap-1.5 rounded-nomi-sm border border-nomi-line bg-nomi-paper px-2.5 text-caption text-nomi-ink-80',
    'cursor-pointer transition-colors hover:border-nomi-ink-30 hover:bg-nomi-ink-05 active:bg-nomi-ink-10',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-nomi-ink',
  )

  return (
    <div className="flex flex-wrap items-center gap-1.5" role="toolbar" aria-label={t('generationList.createBarAria')} data-list-create-bar="toolbar" data-board="list.create-bar">
      {addIntent.pickerInput}
      {residentIntents.map((intent, index) => {
        const Icon = intentIcon(intent)
        return (
          <React.Fragment key={intent.id}>
            {intent.id === 'import-file' && index > 0 ? <span className="mx-0.5 h-4 w-px bg-nomi-line" aria-hidden /> : null}
            <button
              type="button"
              data-add-intent={intent.id}
              className={chipClass}
              aria-label={intentActionLabel(intent, t)}
              onClick={() => addIntent.run(intent)}
            >
              <Icon size={14} stroke={1.6} />
              <span>{intentCardLabel(intent, t)}</span>
            </button>
          </React.Fragment>
        )
      })}
      {moreItems.length > 0 ? (
        <>
          <button
            ref={moreRef}
            type="button"
            data-list-add-more="true"
            aria-haspopup="menu"
            aria-expanded={moreOpen}
            aria-label={t('canvas.moreMenu')}
            title={t('canvas.moreMenu')}
            className={cn(chipClass, 'px-2', moreOpen && 'bg-nomi-ink-05')}
            onClick={openMore}
          >
            <IconPlus size={14} stroke={1.7} />
          </button>
          <WorkbenchMenu
            open={moreOpen}
            onOpenChange={(next) => { if (!next) setMoreOpen(false) }}
            anchorRect={moreRect}
            gap={6}
            items={moreItems}
            ariaLabel={t('canvas.moreMenu')}
          />
        </>
      ) : null}
    </div>
  )
}

export function GenerationListEmpty({
  onBackToCanvas,
  onCreatedNode,
}: {
  onBackToCanvas: () => void
  onCreatedNode?: (created: { id: string; kind: GenerationNodeKind }) => void
}): JSX.Element {
  const { t } = useTranslation()
  return (
    <div className="grid h-full min-h-[320px] place-items-center" data-list-empty>
      <div className="grid justify-items-center gap-4 text-center">
        <span className="grid size-12 place-items-center rounded-full bg-nomi-ink-05 text-nomi-ink-60"><IconStack2 size={24} /></span>
        <h2 className="m-0 text-body font-semibold text-nomi-ink">{t('generationList.empty')}</h2>
        <ListCreateBar variant="empty" onCreatedNode={onCreatedNode} />
        <WorkbenchButton size="sm" variant="default" onClick={onBackToCanvas}>{t('generationList.backToCanvas')}</WorkbenchButton>
      </div>
    </div>
  )
}
