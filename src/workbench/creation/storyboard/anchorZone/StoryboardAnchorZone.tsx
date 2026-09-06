import React from 'react'
import { useTranslation } from 'react-i18next'
import { IconChevronDown, IconChevronUp, IconPlus } from '../../../../vendor/tablerIcons'
import type { ModelOption } from '../../../../config/models'
import type { PlanAnchor, PlanAnchorKind } from '../../../generationCanvas/agent/storyboardPlan'
import type { AnchorCardRuntime } from '../exec/storyboardRowStatus'
import StoryboardAnchorStrip from './StoryboardAnchorStrip'
import StoryboardAnchorRow from './StoryboardAnchorRow'

/**
 * 锚区（`跨镜头要一致的`）的**两态**（合同 v6 §2.2，用户原话：「只有顶部的锚需要展开/收起两态」）。
 *
 * 存在的理由：角色/场景/道具/风格这些资产被下面**多个**镜头反复引用；锚区不是"分镜表的第一段"，
 * 是"下面所有镜头共享的参考池"。
 *
 * 「全部展开 / 全部收起」一次切换全部锚——**刻意不支持逐张展开**：逐张展开会引入"哪几张是展开的"
 * 这个额外状态，复杂度不值得，用户也没提这个需求（合同 §8 不做项）。
 */

type Props = {
  cards: readonly AnchorCardRuntime[]
  /** 整片默认画幅（展开态锚的画面格与镜头行同一套几何）。 */
  aspect: string
  imageModelOptions?: ModelOption[]
  noNameAnchorIds?: ReadonlySet<string>
  filterAnchorId?: string | null
  /** 受控展开态；缺省 = 组件自持（实验室 / 独立使用时用得上）。 */
  expanded?: boolean
  onToggleExpanded?: ((next: boolean) => void) | undefined
  onUpdateAnchor: (anchorId: string, patch: Partial<PlanAnchor>) => void
  onChangeKind: (anchorId: string, kind: PlanAnchorKind) => void
  onRemoveAnchor: (anchorId: string) => void
  onGenerateAnchor: (runtime: AnchorCardRuntime) => void
  onRegenerateAnchor: (runtime: AnchorCardRuntime) => void
  /** 可找回锚卡的**免费**续查（`recoverNodeResult`）；缺省 = 不显示那枚按钮。 */
  onRecoverAnchor?: ((runtime: AnchorCardRuntime) => void) | undefined
  onToggleLockAnchor: (runtime: AnchorCardRuntime) => void
  onOpenPreviewAnchor?: ((runtime: AnchorCardRuntime) => void) | undefined
  onFilterByAnchor?: ((anchorId: string) => void) | undefined
  onAddAnchor?: (() => void) | undefined
}

export default function StoryboardAnchorZone(props: Props): JSX.Element {
  const { t } = useTranslation()
  const { cards, aspect, imageModelOptions = [], noNameAnchorIds, filterAnchorId } = props
  const [selfExpanded, setSelfExpanded] = React.useState(false)
  const expanded = props.expanded ?? selfExpanded
  const setExpanded = (next: boolean): void => {
    if (props.onToggleExpanded) props.onToggleExpanded(next)
    else setSelfExpanded(next)
  }

  // 区头小结与卡面同一份 derive（F2 禁静态快照）。
  const visual = cards.filter((card) => card.visual)
  const ready = visual.filter((card) => card.locked || (card.resultUrl && !card.generating && !card.failed)).length
  const generating = visual.filter((card) => card.generating).length
  const pending = visual.length - ready - generating

  return (
    <section data-storyboard-anchors="true" data-storyboard-anchors-expanded={expanded ? 'true' : 'false'}>
      <div className="mb-2 flex items-baseline gap-2">
        <span className="text-body-sm font-medium text-nomi-ink-80">{t('storyboardEditor.consistencyTitle')}</span>
        <span className="text-micro text-nomi-ink-40">{t('storyboardEditor.consistencyHint')}</span>
        {visual.length > 0 ? (
          <span className="ml-auto flex shrink-0 items-center gap-1.5 text-micro text-nomi-ink-40">
            {ready > 0 ? <span className="text-workbench-success">{t('storyboardEditor.anchor.headReady', { count: ready })}</span> : null}
            {generating > 0 ? <span>{t('storyboardEditor.anchor.headGenerating', { count: generating })}</span> : null}
            {pending > 0 ? <span>{t('storyboardEditor.anchor.headPending', { count: pending })}</span> : null}
          </span>
        ) : null}
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          aria-expanded={expanded}
          data-storyboard-anchors-toggle="true"
          className={`${visual.length > 0 ? '' : 'ml-auto '}inline-flex h-6 shrink-0 items-center gap-1 rounded-full border border-nomi-line px-2 text-micro text-nomi-ink-60 hover:border-nomi-accent hover:text-nomi-accent`}
        >
          {expanded ? <IconChevronUp size={12} stroke={1.8} /> : <IconChevronDown size={12} stroke={1.8} />}
          {expanded ? t('storyboardEditor.anchor.collapseAll') : t('storyboardEditor.anchor.expandAll')}
        </button>
      </div>

      {cards.length === 0 ? (
        <div className="py-2 text-caption text-nomi-ink-40">{t('storyboardEditor.noAnchors')}</div>
      ) : expanded ? (
        <div className="overflow-hidden rounded-nomi border border-nomi-line">
          {cards.map((runtime) => (
            <StoryboardAnchorRow
              key={runtime.anchor.id}
              runtime={runtime}
              aspect={aspect}
              modelOptions={imageModelOptions}
              nameInvalid={noNameAnchorIds?.has(runtime.anchor.id)}
              onUpdate={(patch) => props.onUpdateAnchor(runtime.anchor.id, patch)}
              onChangeKind={(kind) => props.onChangeKind(runtime.anchor.id, kind)}
              onRemove={() => props.onRemoveAnchor(runtime.anchor.id)}
              onGenerate={() => props.onGenerateAnchor(runtime)}
              onRegenerate={() => props.onRegenerateAnchor(runtime)}
              onRecover={props.onRecoverAnchor ? () => props.onRecoverAnchor?.(runtime) : undefined}
              onToggleLock={() => props.onToggleLockAnchor(runtime)}
              onOpenPreview={props.onOpenPreviewAnchor ? () => props.onOpenPreviewAnchor?.(runtime) : undefined}
              onFilterByAnchor={props.onFilterByAnchor ? () => props.onFilterByAnchor?.(runtime.anchor.id) : undefined}
            />
          ))}
        </div>
      ) : (
        <StoryboardAnchorStrip
          cards={cards}
          filterAnchorId={filterAnchorId}
          onFilterByAnchor={props.onFilterByAnchor}
          onAddAnchor={props.onAddAnchor}
        />
      )}

      {expanded && props.onAddAnchor ? (
        <button
          type="button"
          onClick={props.onAddAnchor}
          className="mt-2 inline-flex h-6 items-center gap-1 rounded-full border border-dashed border-nomi-ink-20 px-2.5 text-caption text-nomi-ink-60 hover:text-nomi-ink-80"
        >
          <IconPlus size={13} stroke={1.8} />
          {t('storyboardEditor.addAnchor')}
        </button>
      ) : null}
    </section>
  )
}
