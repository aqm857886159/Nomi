// 生成页列表的一张卡（样张板 List，2026-10-08 22:40Z 拍板）：
//   - 定宽 256；画面铺满、不套框，下面一行「镜号 · 时长 ··· 模型」，再下面是提示词（最多两行）；
//   - 还没生成的镜头是「草稿卡」：画面区放提示词文字，不画空图框；生成中 / 失败由画面区自己说话；
//   - 画幅与这份分镜的默认不同才在画面右上角标出来；卡与卡之间没有链接图标，参考关系 = 卡上的参考小图。
// 卡只读画布 store 里的那个节点（投影见 generationListModel.ts）；点开 = 大详情，改东西只在那里。
import React, { type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import {
  IconCode,
  IconCube,
  IconDownload,
  IconExternalLink,
  IconMovie,
  IconPencil,
  IconPhoto,
  IconScissors,
  IconStack2,
  IconTable,
  IconWorld,
  IconFileText,
} from '@tabler/icons-react'
import { WorkbenchIconButton } from '../../../design'
import { cn } from '../../../utils/cn'
import { useModelOptionsState } from '../../../config/useModelOptions'
import PromptEditor from '../../assets/PromptEditor'
import { resolveLightweightNodePreview } from '../../generationCanvas/components/canvasNodeLevelOfDetail'
import { currentReferenceMedia } from '../../generationCanvas/nodes/mentionCandidates'
import { getGenerationNodeExecutionKind, getGenerationNodeLabel } from '../../generationCanvas/model/generationNodeKinds'
import type { GenerationCanvasNode } from '../../generationCanvas/model/generationCanvasTypes'
import { useGenerationCanvasStore } from '../../generationCanvas/store/generationCanvasStore'
import { formatSeconds, ListCardMedia, ListStatusTag, readAspect, readDurationSeconds } from './GenerationListParts'
import { shotLabel, type GenerationListCard } from './generationListModel'

export const CARD_MEDIA_HEIGHT = 144
/** 卡上提示词是只读的，编辑器要求一个 onChange。 */
const ignoreChange = (): void => undefined

/** 节点上选好的模型 → 卡上那个显示名（找不到目录项就原样显示 key）。 */
export function useModelLabels(): (node: GenerationCanvasNode | undefined) => string {
  const image = useModelOptionsState('image').options
  const video = useModelOptionsState('video').options
  const audio = useModelOptionsState('audio').options
  return React.useCallback((node) => {
    const key = typeof node?.meta?.modelKey === 'string' ? node.meta.modelKey : ''
    if (!key) return ''
    const option = [...image, ...video, ...audio].find((candidate) => candidate.value === key || candidate.modelKey === key)
    return option?.label || key
  }, [image, video, audio])
}

/** 卡上的参考小图（取代卡间的链接图标）：最多 3 张，其余 +N。 */
export function ReferenceThumbs({ nodeIds, size = 20 }: { nodeIds: readonly string[]; size?: number }): JSX.Element | null {
  const { t } = useTranslation()
  const references = useGenerationCanvasStore((state) => nodeIds.map((id) => state.nodes.find((node) => node.id === id)).filter(Boolean) as GenerationCanvasNode[])
  if (!references.length) return null
  const shown = references.slice(0, 3)
  return (
    <span className="inline-flex shrink-0 items-center -space-x-1" data-list-reference-thumbs>
      {shown.map((node) => {
        const preview = resolveLightweightNodePreview(node)
        const title = node.title || t('generationList.untitled')
        return preview?.kind === 'image'
          ? <img key={node.id} src={preview.src} alt={title} title={title} className="rounded-nomi-sm object-cover ring-2 ring-nomi-paper" style={{ width: size, height: size }} />
          : <span key={node.id} title={title} className="grid place-items-center rounded-nomi-sm bg-nomi-ink-05 text-nomi-ink-40 ring-2 ring-nomi-paper" style={{ width: size, height: size }}><IconPhoto size={12} /></span>
      })}
      {references.length > shown.length ? <span className="pl-2 text-micro text-nomi-ink-40">+{references.length - shown.length}</span> : null}
    </span>
  )
}

/** 卡上的提示词：现役 PromptEditor 只读渲染，参考 chip 的样子与大详情、画布同一颗。 */
function CardPrompt({ node, lines }: { node: GenerationCanvasNode; lines: 2 | 3 }): JSX.Element | null {
  const { t } = useTranslation()
  const referencesKey = useGenerationCanvasStore((state) => JSON.stringify(currentReferenceMedia(node, state.nodes, state.edges)))
  const references = React.useMemo(() => JSON.parse(referencesKey), [referencesKey])
  const prompt = node.prompt ?? ''
  if (!prompt.trim()) return <p className="m-0 text-caption text-nomi-ink-40">{t('generationList.promptEmpty')}</p>
  return (
    <div className="min-w-0" data-card-prompt>
      <PromptEditor
        value={prompt}
        onChange={ignoreChange}
        editable={false}
        mentionReferences={references}
        className={cn('pointer-events-none [&_.ProseMirror]:!min-h-0 [&_.ProseMirror]:!p-0', lines === 2 ? '[&_.ProseMirror_p]:line-clamp-2' : '[&_.ProseMirror_p]:line-clamp-3')}
      />
    </div>
  )
}

const TOOL_ICON: Record<string, typeof IconStack2> = {
  clip: IconScissors, director: IconMovie, model3d: IconCube, panorama: IconWorld, whiteboard: IconPencil,
  output: IconDownload, 'agent-artifact': IconCode, shot_table: IconTable, shot: IconFileText,
}

/** 在画布上编辑的工具节点：紧凑卡，点了回画布。 */
function ToolCard({ card, node, onOpenInCanvas }: { card: GenerationListCard; node: GenerationCanvasNode | undefined; onOpenInCanvas: () => void }): JSX.Element {
  const { t } = useTranslation()
  const kindLabel = node ? getGenerationNodeLabel(node.kind) : ''
  const Icon = (node && TOOL_ICON[node.kind]) || IconStack2
  return (
    <article
      data-list-card={card.key}
      data-list-card-kind={node?.kind ?? 'tool'}
      data-list-tool-card
      className="flex w-[256px] min-w-0 cursor-pointer items-center gap-3 self-start rounded-panel border border-nomi-line bg-nomi-paper p-2.5 transition-colors hover:border-nomi-ink-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-nomi-accent"
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

/** 这张卡是不是「还没生成」的草稿：空闲、没有结果的图 / 视频镜头——画面区放文字。 */
function isDraftNode(node: GenerationCanvasNode | undefined): boolean {
  if (!node || node.result?.url || (node.status && node.status !== 'idle')) return false
  const execution = getGenerationNodeExecutionKind(node.kind)
  return execution === 'image' || execution === 'video'
}

export function GenerationListCardView({
  card,
  defaultAspect,
  modelLabel,
  onSelect,
  onOpenInCanvas,
}: {
  card: GenerationListCard
  /** 这份分镜的默认画幅；卡的画幅与它不同才标角标。 */
  defaultAspect: string | null
  modelLabel: (node: GenerationCanvasNode | undefined) => string
  onSelect: () => void
  onOpenInCanvas: () => void
}): JSX.Element {
  const { t } = useTranslation()
  const node = useGenerationCanvasStore((state) => state.nodes.find((candidate) => candidate.id === card.nodeId))
  if (card.variant === 'tool') return <ToolCard card={card} node={node} onOpenInCanvas={onOpenInCanvas} />
  const kind = node?.kind ?? 'video'
  const aspect = readAspect(node)
  const odd = aspect && defaultAspect && aspect !== defaultAspect ? aspect : null
  const draft = isDraftNode(node)
  const model = modelLabel(node)
  const duration = node && (getGenerationNodeExecutionKind(node.kind) === 'video' || getGenerationNodeExecutionKind(node.kind) === 'audio') ? readDurationSeconds(node) : null
  const showStatus = card.status && !draft && card.status !== 'done' && card.status !== 'locked'
  const textual = kind === 'text'
  return (
    <article
      data-list-card={card.key}
      data-list-card-kind={draft ? 'draft' : kind}
      className="group relative w-[256px] min-w-0 cursor-pointer text-left focus-visible:outline-none"
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onSelect()
        }
      }}
      role="button"
      tabIndex={0}
    >
      <div className="relative rounded-panel transition-shadow group-hover:ring-1 group-hover:ring-nomi-ink-20 group-focus-visible:ring-2 group-focus-visible:ring-nomi-accent">
        {draft ? (
          <div className="flex flex-col overflow-hidden rounded-panel bg-nomi-ink-05 px-4 py-3.5 ring-1 ring-inset ring-nomi-line-soft" style={{ height: CARD_MEDIA_HEIGHT }} data-list-draft-card>
            {node ? <CardPrompt node={node} lines={3} /> : null}
            <span className="mt-auto text-caption text-nomi-ink-40">{t('generationList.notGenerated')}</span>
          </div>
        ) : (
          <>
            <ListCardMedia node={node} height={CARD_MEDIA_HEIGHT} kind={kind} fit={odd ? 'contain' : 'cover'} />
            {odd ? <span className="absolute right-1.5 top-1.5 z-[2] rounded-nomi-sm bg-nomi-ink/60 px-1.5 py-0.5 text-micro font-medium tabular-nums text-nomi-paper" data-list-odd-aspect>{odd}</span> : null}
          </>
        )}
      </div>
      <div className="mt-2.5 flex min-w-0 items-baseline gap-2">
        <span className="min-w-0 truncate text-body-sm font-semibold tabular-nums text-nomi-ink">{shotLabel(t, card)}</span>
        {duration ? <span className="shrink-0 text-caption tabular-nums text-nomi-ink-40" data-list-duration>{formatSeconds(duration)}</span> : null}
        {showStatus ? <span className="shrink-0 self-center"><ListStatusTag status={card.status!} /></span> : null}
        <span className="min-w-0 flex-1" aria-hidden />
        {model ? <span className="min-w-0 truncate text-caption text-nomi-ink-40" data-list-card-model>{model}</span> : null}
      </div>
      {!draft && !textual && node ? <div className="mt-1"><CardPrompt node={node} lines={2} /></div> : null}
      {card.referenceNodeIds.length ? <div className="mt-1.5"><ReferenceThumbs nodeIds={card.referenceNodeIds} /></div> : null}
    </article>
  )
}
