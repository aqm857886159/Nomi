import { selectIsNodeQueued, useGenerationQueueStore } from '../../generationCanvas/runner/generationQueueStore'
// 点一张卡 = 大详情（样张板 ListDetail）：
//   - 左边收成 288 窄列（同一份列表，点别的镜即切换）；
//   - 右边 = 居中 600px（NODE_COMPOSER_WIDTH）同中轴舞台：同源 `<NodeStageSurface host="list-detail">`（可编辑富文本、
//     真 `<audio>` 播放与转写 SRT、错误/可找回恢复、内联媒体工具栏、样片行）+ 版本切换（经唯一 `switchNodeMainVersion`）+
//     同源 `LazyNodeGenerationComposer`（host="inline"）。
// 这里不包 NodeWriteAccessProvider——写口就是画布 store，改的就是画布上那个节点（概念 generation.list-view）。
import React, { type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { IconArrowLeft, IconChevronLeft, IconChevronRight, IconEye, IconFileText, IconPhoto, IconWaveSine } from '@tabler/icons-react'
import { WorkbenchButton, WorkbenchIconButton } from '../../../design'
import { notify } from '../../../ui/notificationPolicy'
import { cn } from '../../../utils/cn'
import { collapsePromptWhitespace, parsePromptSegments } from '../../assets/promptMentions'
import { resolveLightweightNodePreview } from '../../generationCanvas/components/canvasNodeLevelOfDetail'
import LazyNodeGenerationComposer from '../../generationCanvas/nodes/LazyNodeGenerationComposer'
import { NODE_COMPOSER_WIDTH } from '../../generationCanvas/nodes/nodeSizing'
import { NodeStageSurface } from '../../generationCanvas/nodes/NodeStageSurface'
import { getNodeSurfaceContract } from '../../generationCanvas/nodes/nodeSurfaceContract'
import { isCardRenderKind, nodeHasGenerationComposer, resolveNodeRenderKind } from '../../generationCanvas/nodes/resolveRenderKind'
import { NodeSampleRow } from '../../generationCanvas/nodes/sampleRow/NodeSampleRow'
import { nodeVersionEntries } from '../../generationCanvas/nodes/versionCards/nodeVersionEntries'
import { switchNodeMainVersion } from '../../generationCanvas/nodes/versionCards/switchNodeMainVersion'
import { docToPlainText } from '../../generationCanvas/runner/textGenerationDocument'
import { getGenerationNodeExecutionKind } from '../../generationCanvas/model/generationNodeKinds'
import { resultIdentity } from '../../generationCanvas/model/nodeResultLifecycle'
import type { GenerationCanvasNode } from '../../generationCanvas/model/generationCanvasTypes'
import { selectCanvasNodeById } from '../../generationCanvas/store/canvasNodeGenerationIndex'
import { useGenerationCanvasStore } from '../../generationCanvas/store/generationCanvasStore'
import { ListStatusTag } from './GenerationListParts'
import { formatSeconds, readAspect, readDurationSeconds } from './generationListMediaFacts'
import { useNodeModelLabel } from './generationListModelLabels'
import { shotLabel, type GenerationListCard, type GenerationListSection } from './generationListModel'
import { viewNodeInCanvas } from './generationListSource'

const DETAIL_STAGE_MAX_WIDTH = NODE_COMPOSER_WIDTH
const DETAIL_PREVIEW_MAX_HEIGHT = 360

/** 提示词的一行纯文字（参考 chip 去掉）——窄列用，不为每一行起一个编辑器。 */
function plainPrompt(node: GenerationCanvasNode | undefined): string {
  if (!node) return ''
  if (node.kind === 'text') {
    const docText = docToPlainText(node.contentJson).trim()
    if (docText) return collapsePromptWhitespace(docText)
  }
  return collapsePromptWhitespace(parsePromptSegments(node.prompt ?? '').map((segment) => (segment.type === 'text' ? segment.value : '')).join(' ')).trim()
}

function sectionTitleOf(t: (key: string, options?: Record<string, unknown>) => string, section: GenerationListSection): string {
  if (section.kind === 'storyboard') return t('generationList.storyboardSection', { title: section.title })
  if (section.kind === 'group') return section.title || t('generationList.untitled')
  return t('generationList.ungrouped')
}

function RailRow({ card, active, onSelect }: { card: GenerationListCard; active: boolean; onSelect: () => void }): JSX.Element {
  const { t } = useTranslation()
  const node = useGenerationCanvasStore((state) => selectCanvasNodeById(state, card.nodeId))
  const preview = node ? resolveLightweightNodePreview(node) : null
  const execution = node ? getGenerationNodeExecutionKind(node.kind) : undefined
  const duration = node && (execution === 'video' || execution === 'audio') ? readDurationSeconds(node) : null
  const queued = useGenerationQueueStore((state) => selectIsNodeQueued(state, card.nodeId))
  const generated = (!queued && Boolean(node?.result?.url)) || node?.kind === 'text' || Boolean(node?.result?.text)
  const FallbackIcon = execution === 'audio' ? IconWaveSine : node?.kind === 'text' ? IconFileText : IconPhoto
  return (
    <button
      type="button"
      onClick={onSelect}
      data-list-detail-row={card.key}
      aria-current={active ? 'true' : undefined}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-panel px-2 py-1.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-nomi-ink',
        active ? 'bg-nomi-accent-soft' : 'hover:bg-nomi-ink-05',
      )}
    >
      {preview?.kind === 'image'
        ? <img src={preview.src} alt="" className="h-[45px] w-20 shrink-0 rounded-field object-cover" />
        : <span className="grid h-[45px] w-20 shrink-0 place-items-center rounded-field bg-nomi-ink-05 text-nomi-ink-40"><FallbackIcon size={16} stroke={1.5} aria-hidden /></span>}
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-1.5">
          <span className="truncate text-caption font-semibold tabular-nums text-nomi-ink">{shotLabel(t, card)}</span>
          <span className="shrink-0 text-micro tabular-nums text-nomi-ink-40">
            {queued ? t('generationCommon.observability.progress.queued')
              : card.status && !['ready', 'done', 'locked'].includes(card.status) ? t(`shotTable.status.${card.status}`)
                : generated ? (duration ? formatSeconds(duration) : '') : t('generationList.notGenerated')}
          </span>
        </span>
        <span className={cn('mt-0.5 block truncate text-caption', active ? 'text-nomi-ink-80' : 'text-nomi-ink-60')}>{plainPrompt(node) || t('generationList.promptEmpty')}</span>
      </span>
    </button>
  )
}

/** 左边 288 窄列：同一份投影，点别的镜即切换。 */
export function DetailRail({ sections, activeKey, onSelect }: { sections: readonly GenerationListSection[]; activeKey: string; onSelect: (key: string) => void }): JSX.Element {
  const { t } = useTranslation()
  const rows = sections.filter((section) => section.cards.some((card) => card.variant !== 'tool'))
  return (
    <nav className="flex w-[288px] shrink-0 flex-col overflow-y-auto border-r border-nomi-line-soft pb-3" aria-label={t('generationList.aria')} data-list-detail-rail>
      {rows.map((section) => (
        <div key={section.key} data-list-detail-rail-section={section.key}>
          <div className="flex h-[52px] shrink-0 items-center gap-2 px-4">
            <span className="min-w-0 truncate text-body-sm font-semibold text-nomi-ink">{sectionTitleOf(t, section)}</span>
            <span className="shrink-0 text-caption tabular-nums text-nomi-ink-40">{section.cards.filter((card) => card.variant !== 'tool').length}</span>
          </div>
          <div className="flex flex-col gap-0.5 px-2">
            {section.cards.filter((card) => card.variant !== 'tool').map((card) => (
              <RailRow key={card.key} card={card} active={card.key === activeKey} onSelect={() => onSelect(card.key)} />
            ))}
          </div>
        </div>
      ))}
    </nav>
  )
}

/** 版本行：「‹ 第 2 版 · 共 2 版 ›」。统一经唯一领域命令 `switchNodeMainVersion` 切主图（提交白板 + 回填真实宽高 + 一步撤销）。 */
function DetailVersions({ node }: { node: GenerationCanvasNode }): JSX.Element | null {
  const { t } = useTranslation()
  const entries = React.useMemo(() => nodeVersionEntries(node), [node])
  if (!entries.length || !node.result) return null
  const mainIdentity = resultIdentity(node.result)
  const index = Math.max(0, entries.findIndex((entry) => entry.identity === mainIdentity))
  const older = entries[index + 1]
  const newer = entries[index - 1]
  const go = (identity: string) => { void switchNodeMainVersion(node.id, identity) }
  return (
    <div className="mt-2 flex w-full items-center justify-center gap-1.5 text-caption text-nomi-ink-40" data-list-detail-versions>
      <WorkbenchIconButton icon={<IconChevronLeft />} label={t('generationList.detail.olderVersion')} size="sm" disabled={!older} onClick={() => older && go(older.identity)} />
      <span className="tabular-nums">{t('generationList.detail.version', { n: entries[index]!.versionNo, total: entries.length })}</span>
      <WorkbenchIconButton icon={<IconChevronRight />} label={t('generationList.detail.newerVersion')} size="sm" disabled={!newer} onClick={() => newer && go(newer.identity)} />
    </div>
  )
}

export function GenerationListDetail({ card, onBack }: { card: GenerationListCard; onBack: () => void }): JSX.Element {
  const { t } = useTranslation()
  const node = useGenerationCanvasStore((state) => selectCanvasNodeById(state, card.nodeId))
  const queued = useGenerationQueueStore((state) => selectIsNodeQueued(state, card.nodeId))
  const [feedback, setFeedback] = React.useState<string | null>(null)
  const reportFeedback = React.useCallback(
    (message: string) => {
      notify({ identity: `GenerationListDetail:${card.nodeId}`, reason: 'interaction', message, level: 'inline', present: setFeedback })
    },
    [card.nodeId],
  )
  const modelLabel = useNodeModelLabel(node)
  const execution = node ? getGenerationNodeExecutionKind(node.kind) : undefined
  const duration = node && (execution === 'video' || execution === 'audio') ? readDurationSeconds(node) : null
  const meta = [duration ? formatSeconds(duration) : '', modelLabel].filter(Boolean).join(' · ')
  const aspect = readAspect(node)
  const [aw, ah] = (aspect ?? '16:9').split(':').map(Number)
  const ratio = (aw || 16) / (ah || 9)
  const previewWidth = Math.round(Math.min(DETAIL_STAGE_MAX_WIDTH, DETAIL_PREVIEW_MAX_HEIGHT * ratio))
  const contract = node ? getNodeSurfaceContract(node.kind) : null

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col" data-list-inspector={card.key} data-list-detail data-node-id={node?.id} aria-label={shotLabel(t, card)}>
      <header className="flex h-[52px] shrink-0 items-center gap-2.5 border-b border-nomi-line-soft px-4">
        <WorkbenchIconButton icon={<IconArrowLeft />} label={t('generationList.backToList')} size="sm" onClick={onBack} data-list-detail-back />
        <h2 className="m-0 min-w-0 truncate text-title font-semibold tabular-nums text-nomi-ink">{shotLabel(t, card)}</h2>
        {card.status ? <ListStatusTag status={card.status} queued={queued} /> : null}
        {meta ? <span className="min-w-0 truncate text-caption tabular-nums text-nomi-ink-40" data-list-detail-meta>{meta}</span> : null}
        <span className="flex-1" />
        {node ? (
          <WorkbenchButton size="sm" variant="default" onClick={() => viewNodeInCanvas(node.id)} data-list-detail-view-canvas>
            <IconEye aria-hidden /> {t('generationList.viewInCanvas')}
          </WorkbenchButton>
        ) : null}
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto" data-list-detail-scroll>
        <div className="mx-auto flex w-full max-w-[648px] flex-col items-center px-6 pb-8 pt-4" data-list-detail-coaxial>
          <div className="flex w-full max-w-[600px] flex-col items-center" data-list-detail-stage-axis>
            {feedback ? (
              <p role="status" className="mb-2 w-full rounded-nomi-sm bg-nomi-ink-05 px-3 py-1.5 text-center text-caption text-nomi-ink-80">
                {feedback}
              </p>
            ) : null}
            {node ? (
              <>
                <NodeStageSurface
                  host="list-detail"
                  node={node}
                  visualSize={{ width: DETAIL_STAGE_MAX_WIDTH, height: DETAIL_PREVIEW_MAX_HEIGHT }}
                  detailFrameStyle={{ maxWidth: previewWidth, aspectRatio: String(ratio) }}
                  onFeedback={reportFeedback}
                  onOpenInCanvas={() => viewNodeInCanvas(node.id)}
                />
                {contract?.stageMode === 'shared-stage' ? (
                  <>
                    <DetailVersions node={node} />
                    {node.kind !== 'text' && !isCardRenderKind(resolveNodeRenderKind(node)) ? (
                      <NodeSampleRow node={node} onFeedback={reportFeedback} flowWidth={DETAIL_STAGE_MAX_WIDTH} />
                    ) : null}
                    {nodeHasGenerationComposer(node.kind) ? (
                      <div className="mt-3 flex w-full justify-center [&>div]:w-full" data-inspector-composer>
                        <LazyNodeGenerationComposer
                          node={node}
                          visualSize={{ width: DETAIL_STAGE_MAX_WIDTH, height: 220 }}
                          host="inline"
                          onFeedback={reportFeedback}
                        />
                      </div>
                    ) : (
                      <p className="mt-3 text-center text-body-sm text-nomi-ink-60">{t('generationList.detail.referenceOnly')}</p>
                    )}
                  </>
                ) : null}
              </>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  )
}
