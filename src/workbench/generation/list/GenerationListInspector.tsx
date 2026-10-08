// 列表检查器：点一张卡，右侧就是**画布节点那张生成框**（现役 NodeGenerationComposer，host="panel"，
// 与 Agent 付费卡同一件）。这里**不包 NodeWriteAccessProvider**——写口就是画布 store，改的就是画布上那个节点；
// 列表与画布只有一份数据（概念 generation.list-view）。模型和参数只在这里、按节点改，没有批量改。
import React, { type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { IconEye, IconX } from '@tabler/icons-react'
import { WorkbenchButton, WorkbenchIconButton } from '../../../design'
import { cn } from '../../../utils/cn'
import LazyNodeGenerationComposer from '../../generationCanvas/nodes/LazyNodeGenerationComposer'
import { nodeHasGenerationComposer } from '../../generationCanvas/nodes/resolveRenderKind'
import { nodeVersionEntries } from '../../generationCanvas/nodes/versionCards/nodeVersionEntries'
import { resultIdentity } from '../../generationCanvas/model/nodeResultLifecycle'
import { useGenerationCanvasStore } from '../../generationCanvas/store/generationCanvasStore'
import { ListCardMedia, ListStatusTag } from './GenerationListParts'
import { shotLabel, type GenerationListCard } from './generationListModel'

const NO_FEEDBACK = (): void => undefined

function InspectorVersions({ nodeId }: { nodeId: string }): JSX.Element | null {
  const { t } = useTranslation()
  const node = useGenerationCanvasStore((state) => state.nodes.find((candidate) => candidate.id === nodeId))
  const entries = React.useMemo(() => (node ? nodeVersionEntries(node) : []), [node])
  const mainIdentity = node?.result ? resultIdentity(node.result) : ''
  if (!node || entries.length < 2) return null
  return (
    <section className="mt-4 border-t border-nomi-line pt-3" data-inspector-versions>
      <div className="mb-2 flex items-center justify-between text-caption font-semibold text-nomi-ink-60">
        <span>{t('generationList.inspector.versions')}</span>
        <span className="text-micro font-normal text-nomi-ink-40">{entries.length}</span>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {entries.map((entry) => {
          const main = entry.identity === mainIdentity
          return (
            <button
              key={entry.identity}
              type="button"
              // 换主图走版本的唯一 owner（nodeResultLifecycle 经画布 store），一步撤销。
              onClick={() => useGenerationCanvasStore.getState().setNodeMainResult(nodeId, entry.identity)}
              className={cn('relative overflow-hidden rounded-nomi-sm border', main ? 'border-nomi-accent' : 'border-nomi-line hover:border-nomi-ink-30')}
            >
              {entry.previewUrl ? <img className="aspect-square size-full object-cover" src={entry.previewUrl} alt="" /> : <span className="block aspect-square size-full bg-nomi-ink-05" />}
              <span className="absolute bottom-1 left-1 rounded-pill bg-nomi-ink/60 px-1.5 py-0.5 text-micro text-nomi-paper">{t('generationCommon.versionCards.versionTiny', { n: entry.versionNo })}</span>
            </button>
          )
        })}
      </div>
    </section>
  )
}

export function GenerationListInspector({
  card,
  sectionTitle,
  narrow,
  onClose,
  onViewInCanvas,
  onEditInStoryboard,
}: {
  card: GenerationListCard
  sectionTitle: string
  narrow: boolean
  onClose: () => void
  onViewInCanvas: (nodeId: string) => void
  /** 还没落画布的方案镜：去分镜编辑器改（第二步账本合一之前，方案只住在那里）。 */
  onEditInStoryboard?: () => void
}): JSX.Element {
  const { t } = useTranslation()
  const node = useGenerationCanvasStore((state) => card.nodeId ? state.nodes.find((candidate) => candidate.id === card.nodeId) : undefined)
  const aspect = typeof node?.meta?.aspect_ratio === 'string' ? node.meta.aspect_ratio : ''
  return (
    <aside
      className={cn('flex min-h-0 min-w-0 flex-col border-l border-nomi-line bg-nomi-paper', narrow ? 'w-[320px]' : 'w-[460px]')}
      data-list-inspector={card.key}
      aria-label={shotLabel(t, card)}
    >
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-nomi-line px-4 py-3">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-body-sm font-semibold text-nomi-ink">{shotLabel(t, card)}</span>
            {card.status ? <ListStatusTag status={card.status} /> : null}
          </div>
          <div className="mt-0.5 truncate text-caption text-nomi-ink-60">{[sectionTitle, aspect].filter(Boolean).join(' · ')}</div>
        </div>
        <WorkbenchIconButton icon={<IconX size={15} stroke={1.7} />} label={t('generationList.inspector.close')} size="sm" onClick={onClose} />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <ListCardMedia node={node} height={narrow ? 150 : 200} kind={node?.kind ?? 'video'} />
        {node ? (
          nodeHasGenerationComposer(node.kind) ? (
            <div className="relative mt-4" data-inspector-composer>
              <LazyNodeGenerationComposer node={node} visualSize={node.size ?? { width: 340, height: 192 }} host="panel" onFeedback={NO_FEEDBACK} />
            </div>
          ) : <p className="mt-4 text-body-sm text-nomi-ink-60">{t('generationList.inspector.referenceOnly')}</p>
        ) : (
          <div className="mt-4 grid gap-3" data-inspector-plan-only>
            {card.planPrompt ? <p className="whitespace-pre-line text-body-sm leading-relaxed text-nomi-ink-80">{card.planPrompt}</p> : null}
            <p className="text-caption text-nomi-ink-60">{t('generationList.inspector.planOnly')}</p>
            {onEditInStoryboard ? (
              <div><WorkbenchButton size="sm" variant="default" onClick={onEditInStoryboard}>{t('generationList.inspector.editInStoryboard')}</WorkbenchButton></div>
            ) : null}
          </div>
        )}
        {node ? <InspectorVersions nodeId={node.id} /> : null}
        {node ? (
          <div className="mt-4 flex justify-end">
            <WorkbenchButton size="sm" variant="default" onClick={() => onViewInCanvas(node.id)}>
              <IconEye size={14} /> {t('generationList.viewInCanvas')}
            </WorkbenchButton>
          </div>
        ) : null}
      </div>
    </aside>
  )
}
