// 点一张卡 = 大详情（样张板 ListDetail）：左边收成 288 窄列（同一份列表，点别的镜即切换），
// 右边 = 大预览 + 版本行 + 完整输入框（画布节点那张现役 NodeGenerationComposer，host="panel"）+ 底部「生成 / 重新生成」。
// 这里**不包 NodeWriteAccessProvider**——写口就是画布 store，改的就是画布上那个节点；列表与画布只有一份数据（概念 generation.list-view）。
// 「生成」按下去走 nodeComposerGenerate——和画布生成框「↑」同一个口，不另写一份。
import React, { type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { IconArrowLeft, IconChevronLeft, IconChevronRight, IconEye, IconPhoto, IconPlayerPlay } from '@tabler/icons-react'
import { WorkbenchButton, WorkbenchIconButton } from '../../../design'
import { cn } from '../../../utils/cn'
import { collapsePromptWhitespace, parsePromptSegments } from '../../assets/promptMentions'
import { resolveLightweightNodePreview } from '../../generationCanvas/components/canvasNodeLevelOfDetail'
import LazyNodeGenerationComposer from '../../generationCanvas/nodes/LazyNodeGenerationComposer'
import { runComposerGenerate } from '../../generationCanvas/nodes/nodeComposerGenerate'
import { nodeHasGenerationComposer } from '../../generationCanvas/nodes/resolveRenderKind'
import { nodeVersionEntries } from '../../generationCanvas/nodes/versionCards/nodeVersionEntries'
import { getGenerationNodeExecutionKind } from '../../generationCanvas/model/generationNodeKinds'
import { resultIdentity } from '../../generationCanvas/model/nodeResultLifecycle'
import type { GenerationCanvasNode } from '../../generationCanvas/model/generationCanvasTypes'
import { useGenerationCanvasStore } from '../../generationCanvas/store/generationCanvasStore'
import { ListCardMedia, ListStatusTag } from './GenerationListParts'
import { formatSeconds, readAspect, readDurationSeconds } from './generationListMediaFacts'
import { useNodeModelLabel } from './generationListModelLabels'
import { shotLabel, type GenerationListCard, type GenerationListSection } from './generationListModel'
import { viewNodeInCanvas } from './generationListSource'

const NO_FEEDBACK = (): void => undefined
const DETAIL_PREVIEW_WIDTH = 624
const DETAIL_PREVIEW_HEIGHT = 351

/** 提示词的一行纯文字（参考 chip 去掉）——窄列用，不为每一行起一个编辑器。 */
function plainPrompt(prompt: string | undefined): string {
  return collapsePromptWhitespace(parsePromptSegments(prompt ?? '').map((segment) => (segment.type === 'text' ? segment.value : '')).join(' ')).trim()
}

function sectionTitleOf(t: (key: string, options?: Record<string, unknown>) => string, section: GenerationListSection): string {
  if (section.kind === 'storyboard') return t('generationList.storyboardSection', { title: section.title })
  if (section.kind === 'group') return section.title || t('generationList.untitled')
  return t('generationList.ungrouped')
}

function RailRow({ card, active, onSelect }: { card: GenerationListCard; active: boolean; onSelect: () => void }): JSX.Element {
  const { t } = useTranslation()
  const node = useGenerationCanvasStore((state) => state.nodes.find((candidate) => candidate.id === card.nodeId))
  const preview = node ? resolveLightweightNodePreview(node) : null
  const execution = node ? getGenerationNodeExecutionKind(node.kind) : undefined
  const duration = node && (execution === 'video' || execution === 'audio') ? readDurationSeconds(node) : null
  const generated = Boolean(node?.result?.url) || node?.kind === 'text'
  return (
    <button
      type="button"
      onClick={onSelect}
      data-list-detail-row={card.key}
      aria-current={active ? 'true' : undefined}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-panel px-2 py-1.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-nomi-accent',
        active ? 'bg-nomi-accent-soft' : 'hover:bg-nomi-ink-05',
      )}
    >
      {preview?.kind === 'image'
        ? <img src={preview.src} alt="" className="h-[45px] w-20 shrink-0 rounded-field object-cover" />
        : <span className="grid h-[45px] w-20 shrink-0 place-items-center rounded-field bg-nomi-ink-05 text-nomi-ink-40"><IconPhoto size={16} stroke={1.5} aria-hidden /></span>}
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-1.5">
          <span className="truncate text-caption font-semibold tabular-nums text-nomi-ink">{shotLabel(t, card)}</span>
          <span className="shrink-0 text-micro tabular-nums text-nomi-ink-40">
            {generated ? (duration ? formatSeconds(duration) : '') : card.status === 'generating' ? t('shotTable.status.generating') : card.status === 'failed' ? t('shotTable.status.failed') : t('generationList.notGenerated')}
          </span>
        </span>
        <span className={cn('mt-0.5 block truncate text-caption', active ? 'text-nomi-ink-80' : 'text-nomi-ink-60')}>{plainPrompt(node?.prompt) || t('generationList.promptEmpty')}</span>
      </span>
    </button>
  )
}

/** 左边那一窄列：同一份投影，当前这一镜所在的分区（单个分区时没有分区名行，和样张一样）。 */
export function DetailRail({ sections, activeKey, onSelect }: { sections: readonly GenerationListSection[]; activeKey: string; onSelect: (key: string) => void }): JSX.Element {
  const { t } = useTranslation()
  const rows = sections.filter((section) => section.cards.some((card) => card.variant !== 'tool'))
  return (
    <nav className="flex w-[288px] shrink-0 flex-col overflow-y-auto border-r border-nomi-line-soft pb-3 pt-12" aria-label={t('generationList.aria')} data-list-detail-rail>
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

/** 大预览：图 = 图、视频 = 能播的片；没有画面（生成中 / 失败 / 还没生成）= 画面区自己说话。盒子按画幅取比例，窄了整体缩，不留黑边。 */
function DetailPreview({ node }: { node: GenerationCanvasNode | undefined }): JSX.Element {
  const aspect = readAspect(node)
  const [aw, ah] = (aspect ?? '16:9').split(':').map(Number)
  const ratio = (aw || 16) / (ah || 9)
  const width = Math.round(Math.min(DETAIL_PREVIEW_WIDTH, DETAIL_PREVIEW_HEIGHT * ratio))
  const result = node?.result
  const playable = result?.url && result.type === 'video'
  return (
    <div className="mx-auto w-full overflow-hidden rounded-panel ring-1 ring-nomi-line-soft" style={{ maxWidth: width, aspectRatio: String(ratio) }} data-list-detail-preview>
      {playable ? (
        <video key={result.url} src={result.url} poster={result.thumbnailUrl} controls playsInline preload="metadata" crossOrigin="use-credentials" className="block size-full bg-nomi-ink" />
      ) : (
        <ListCardMedia node={node} height="100%" kind={node?.kind ?? 'video'} fit="cover" />
      )}
    </div>
  )
}

/** 版本行：「‹ 第 2 版 · 共 2 版 ›」。换主图走版本的唯一 owner（nodeResultLifecycle 经画布 store），一步撤销。 */
function DetailVersions({ node, width }: { node: GenerationCanvasNode; width: number }): JSX.Element | null {
  const { t } = useTranslation()
  const entries = React.useMemo(() => nodeVersionEntries(node), [node])
  if (!entries.length || !node.result) return null
  const mainIdentity = resultIdentity(node.result)
  const index = Math.max(0, entries.findIndex((entry) => entry.identity === mainIdentity))
  const older = entries[index + 1]
  const newer = entries[index - 1]
  const go = (identity: string) => useGenerationCanvasStore.getState().setNodeMainResult(node.id, identity)
  return (
    <div className="mx-auto mt-2 flex w-full items-center gap-1.5 text-caption text-nomi-ink-40" style={{ maxWidth: width }} data-list-detail-versions>
      <WorkbenchIconButton icon={<IconChevronLeft size={14} stroke={1.8} />} label={t('generationList.detail.olderVersion')} size="sm" disabled={!older} onClick={() => older && go(older.identity)} />
      <span className="tabular-nums">{t('generationList.detail.version', { n: entries[index]!.versionNo, total: entries.length })}</span>
      <WorkbenchIconButton icon={<IconChevronRight size={14} stroke={1.8} />} label={t('generationList.detail.newerVersion')} size="sm" disabled={!newer} onClick={() => newer && go(newer.identity)} />
    </div>
  )
}

/** `leadInset`：窄列让位时详情独占整块，左上那颗切换钮会盖住返回钮，头部整体右挪一格。 */
export function GenerationListDetail({ card, onBack, leadInset = false }: { card: GenerationListCard; onBack: () => void; leadInset?: boolean }): JSX.Element {
  const { t } = useTranslation()
  const node = useGenerationCanvasStore((state) => state.nodes.find((candidate) => candidate.id === card.nodeId))
  const modelLabel = useNodeModelLabel(node)
  const execution = node ? getGenerationNodeExecutionKind(node.kind) : undefined
  const duration = node && (execution === 'video' || execution === 'audio') ? readDurationSeconds(node) : null
  const running = node?.status === 'queued' || node?.status === 'running'
  const meta = [duration ? formatSeconds(duration) : '', modelLabel].filter(Boolean).join(' · ')
  const aspect = readAspect(node)
  const [aw, ah] = (aspect ?? '16:9').split(':').map(Number)
  const previewWidth = Math.round(Math.min(DETAIL_PREVIEW_WIDTH, DETAIL_PREVIEW_HEIGHT * ((aw || 16) / (ah || 9))))
  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col" data-list-inspector={card.key} data-list-detail aria-label={shotLabel(t, card)}>
      <header className={cn('flex h-[52px] shrink-0 items-center gap-2.5 px-3', leadInset && 'pl-14')}>
        <WorkbenchIconButton icon={<IconArrowLeft size={16} stroke={1.8} />} label={t('generationList.backToList')} size="sm" onClick={onBack} data-list-detail-back />
        <h2 className="m-0 min-w-0 truncate text-title font-semibold tabular-nums text-nomi-ink">{shotLabel(t, card)}</h2>
        {card.status ? <ListStatusTag status={card.status} /> : null}
        {meta ? <span className="min-w-0 truncate text-caption tabular-nums text-nomi-ink-40" data-list-detail-meta>{meta}</span> : null}
        <span className="flex-1" />
        {node ? (
          <WorkbenchButton size="sm" variant="default" onClick={() => viewNodeInCanvas(node.id)} data-list-detail-view-canvas>
            <IconEye size={14} aria-hidden /> {t('generationList.viewInCanvas')}
          </WorkbenchButton>
        ) : null}
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto" data-list-detail-scroll>
        <div className="mx-auto flex w-full max-w-[688px] flex-col px-8 pb-6 pt-1">
          <DetailPreview node={node} />
          {node ? <DetailVersions node={node} width={previewWidth} /> : null}
          {node ? (
            nodeHasGenerationComposer(node.kind) ? (
              <div className="mx-auto mt-4 w-full rounded-panel bg-nomi-paper p-3 ring-1 ring-nomi-line" style={{ maxWidth: DETAIL_PREVIEW_WIDTH }} data-inspector-composer>
                <LazyNodeGenerationComposer node={node} visualSize={node.size ?? { width: 340, height: 192 }} host="panel" onFeedback={NO_FEEDBACK} />
                {/* 生成钮：panel 宿主的生成框把「生成」交给宿主；这里接，按下去 = 画布「↑」同一个口（nodeComposerGenerate）。 */}
                <div className="mt-3 flex justify-end">
                  <WorkbenchButton size="md" variant="primary" disabled={running} onClick={() => { void runComposerGenerate(node.id) }} data-list-detail-generate>
                    <IconPlayerPlay size={14} aria-hidden /> {running ? t('generationList.generating') : node.result?.url ? t('generationList.regenerate') : t('generationList.generate')}
                  </WorkbenchButton>
                </div>
              </div>
            ) : <p className="mx-auto mt-4 text-body-sm text-nomi-ink-60">{t('generationList.detail.referenceOnly')}</p>
          ) : null}
        </div>
      </div>
    </section>
  )
}
