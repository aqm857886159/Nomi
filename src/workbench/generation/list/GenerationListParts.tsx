// 生成页列表视图的零件：状态标签、卡片画面、「未被引用的素材」条、空态。
// 没有批量条、卡上没有勾选（2026-10-08 用户：模型在节点创建时就选好了，批量走分区头的「生成全部」）。
// 卡只读画布 store 里的那个节点（投影见 generationListModel.ts）；改东西只在大详情里，改的就是那个节点。
import React, { type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import {
  IconAlertTriangle,
  IconFileText,
  IconLoader2,
  IconPhoto,
  IconStack2,
  IconVideo,
  IconWaveSine,
} from '@tabler/icons-react'
import { DesignBadge, WorkbenchButton } from '../../../design'
import { cn } from '../../../utils/cn'
import { DeferredNodeImage, DeferredNodeVideo } from '../../generationCanvas/nodes/DeferredNodeMedia'
import { resolveLightweightNodePreview } from '../../generationCanvas/components/canvasNodeLevelOfDetail'
import { docToPlainText } from '../../generationCanvas/runner/textGenerationDocument'
import { getGenerationNodeExecutionKind } from '../../generationCanvas/model/generationNodeKinds'
import type { GenerationCanvasNode } from '../../generationCanvas/model/generationCanvasTypes'
import { useGenerationCanvasStore } from '../../generationCanvas/store/generationCanvasStore'
import type { ShotRowStatus } from '../../creation/storyboard/exec/storyboardRowStatus'

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

/**
 * 卡片画面：图 / 视频首帧走画布轻量档同一套（加载队列），音频画波形条，文本取前几行。
 * 有画面时不画灰底框、画面铺满（cover）；画幅与这份分镜的默认不同的（`fit="contain"`）整张放进去、不裁。
 * 生成中 / 失败的镜没有画面时，画面区自己说话（转圈 / 红底 + 原因），不靠旁边的小标签。
 */
export function ListCardMedia({ node, height, kind, fit = 'cover', width }: { node: GenerationCanvasNode | undefined; height: number | string; kind: string; fit?: 'cover' | 'contain'; width?: number }): JSX.Element {
  const { t } = useTranslation()
  const preview = node ? resolveLightweightNodePreview(node) : null
  const execution = node ? getGenerationNodeExecutionKind(node.kind) : undefined
  const running = node?.status === 'queued' || node?.status === 'running'
  const failed = node?.status === 'error'
  const fitClass = fit === 'cover' ? 'object-cover' : 'object-contain'
  const framed = !preview || fit === 'contain'
  const placeholder = execution === 'text' || execution === 'audio' ? null : running ? 'running' : failed ? 'failed' : null
  return (
    <div
      className={cn('relative flex items-center justify-center overflow-hidden rounded-panel', framed && (placeholder === 'failed' ? 'bg-nomi-danger-soft' : 'bg-nomi-ink-05'))}
      style={{ height, width }}
      data-list-media-kind={kind}
    >
      {node?.kind === 'text' || execution === 'text' ? <TextPreview node={node!} />
        : node && execution === 'audio' ? (node.result?.url ? <AudioStrip node={node} /> : <EmptyMedia kind="audio" />)
          : preview?.kind === 'image' ? <DeferredNodeImage src={preview.src} alt="" className={cn('absolute inset-0 size-full', fitClass)} />
            : preview?.kind === 'video' ? (
              <DeferredNodeVideo src={preview.src} className={cn('absolute inset-0 size-full', fitClass)} crossOrigin="use-credentials" muted playsInline preload="metadata" controls={false} />
            ) : placeholder ? null : <EmptyMedia kind={execution ?? kind} />}
      {placeholder === 'running' ? (
        <span className={cn('absolute inset-0 z-[1] grid place-items-center text-nomi-ink-60', preview && 'bg-nomi-paper/50')} data-list-media-running>
          <IconLoader2 size={24} stroke={1.6} className="motion-safe:animate-spin" aria-label={t('generationList.generating')} />
        </span>
      ) : null}
      {placeholder === 'failed' ? (
        <span className="absolute inset-0 z-[1] flex flex-col items-center justify-center gap-1.5 px-4 text-center text-nomi-danger" data-list-media-failed>
          <IconAlertTriangle size={22} stroke={1.6} aria-hidden />
          {node?.error ? <span className="line-clamp-2 text-caption">{node.error}</span> : null}
        </span>
      ) : null}
    </div>
  )
}

/** 没有任何卡引用的素材：收在未分组末尾一条，上传的东西不会凭空消失。 */
export function UnreferencedAssetStrip({ nodeIds, onOpen }: { nodeIds: readonly string[]; onOpen: (nodeId: string) => void }): JSX.Element | null {
  const { t } = useTranslation()
  const assets = useGenerationCanvasStore((state) => nodeIds.map((id) => state.nodes.find((node) => node.id === id)).filter(Boolean) as GenerationCanvasNode[])
  if (!assets.length) return null
  return (
    <div className="mt-1 rounded-panel border border-dashed border-nomi-line px-3 py-2" data-list-unreferenced-assets>
      <div className="mb-1.5 text-micro font-medium text-nomi-ink-60">{t('generationList.unreferencedAssets')} · {assets.length}</div>
      <div className="flex flex-wrap gap-2">
        {assets.map((node) => {
          const preview = resolveLightweightNodePreview(node)
          return (
            <button key={node.id} type="button" onClick={() => onOpen(node.id)} className="inline-flex max-w-[12rem] items-center gap-1.5 rounded-nomi-sm border border-nomi-line bg-nomi-paper p-1 pr-2 text-caption text-nomi-ink-80 hover:border-nomi-ink-30" data-list-unreferenced-asset={node.id}>
              {preview?.kind === 'image' ? <img src={preview.src} alt="" className="size-7 shrink-0 rounded-nomi-sm object-cover" /> : <span className="grid size-7 shrink-0 place-items-center rounded-nomi-sm bg-nomi-ink-05"><IconPhoto size={14} stroke={1.6} className="text-nomi-ink-40" /></span>}
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
