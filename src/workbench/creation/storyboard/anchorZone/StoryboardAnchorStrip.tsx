import React from 'react'
import { useTranslation } from 'react-i18next'
import { IconBox, IconLetterCase, IconLock, IconPalette, IconPhoto, IconPlus, IconUser } from '../../../../vendor/tablerIcons'
import { cn } from '../../../../utils/cn'
import { NomiImage } from '../../../../design/media'
import type { PlanAnchorKind } from '../../../generationCanvas/agent/storyboardPlan'
import type { AnchorCardRuntime } from '../exec/storyboardRowStatus'

/**
 * 锚区的**收起态**（合同 v6 §2.2）：一条紧凑参考条，每张锚 = 40px 缩略 + 名字 + 一行小字
 * （被 N 镜引用 / 生成状态），排不下自动换行。
 *
 * 关键的一句（用户原话）：收起态**不是「少了」或「不用了」，只是收起来排在那里**——它依然是锚的
 * 完整表示，不是摘要视图。所以每一枚芯片都能点（反查只看引用它的镜）、都带得出它现在的生成态。
 */

const KIND_ICON: Record<PlanAnchorKind, typeof IconUser> = {
  character: IconUser,
  scene: IconPhoto,
  prop: IconBox,
  style: IconPalette,
}

type Props = {
  cards: readonly AnchorCardRuntime[]
  filterAnchorId?: string | null
  onFilterByAnchor?: ((anchorId: string) => void) | undefined
  onAddAnchor?: (() => void) | undefined
}

export default function StoryboardAnchorStrip({ cards, filterAnchorId, onFilterByAnchor, onAddAnchor }: Props): JSX.Element {
  const { t } = useTranslation()
  return (
    <div className="flex flex-wrap items-center gap-2" data-storyboard-anchor-strip="true">
      {cards.map((card) => {
        const name = card.anchor.name.trim() || t('storyboardEditor.unnamed')
        const KindIcon = KIND_ICON[card.anchor.kind]
        const stat = !card.visual
          ? t('storyboardEditor.anchor.stat.textOnly')
          : card.generating
            ? t('storyboardEditor.frame.generating')
            : card.failed
              ? t('storyboardEditor.frame.failed')
              // 可找回是中性态：不进红、也不写「失败」——钱已经花了，只是还没拉回来。
              : card.recoverable
                ? t('storyboardEditor.frame.recoverable')
                : card.waitingShotCount > 0
                  ? t('storyboardEditor.anchor.stat.waitedBy', { count: card.waitingShotCount })
                  : card.resultUrl
                    // 已出图但没锁：批量为保一致性等锁，所以"未锁定"是行动信号，不是装饰。
                    ? card.locked
                      ? t('storyboardEditor.anchor.stat.referenced', { count: card.referencedByCount })
                      : t('storyboardEditor.anchor.stat.unlockedHint')
                    : t('storyboardEditor.anchor.stat.ungenerated')
        return (
          <button
            key={card.anchor.id}
            type="button"
            onClick={() => onFilterByAnchor?.(card.anchor.id)}
            data-storyboard-anchor-chip={card.anchor.id}
            data-anchor-card={card.anchor.id}
            aria-pressed={filterAnchorId === card.anchor.id}
            className={cn(
              'flex h-12 min-w-0 max-w-[220px] items-center gap-2 rounded-nomi border bg-nomi-paper px-2 text-left',
              filterAnchorId === card.anchor.id ? 'border-nomi-accent' : 'border-nomi-line hover:border-nomi-ink-20',
            )}
          >
            <span className="relative size-10 shrink-0 overflow-hidden rounded-nomi-sm border border-nomi-line-soft bg-nomi-ink-05">
              {card.resultUrl ? (
                <NomiImage src={card.resultUrl} alt={name} className="absolute inset-0 h-full w-full object-cover" />
              ) : (
                <span className="grid h-full w-full place-items-center text-nomi-ink-30">
                  {card.visual ? <KindIcon size={16} stroke={1.6} /> : <IconLetterCase size={16} stroke={1.6} />}
                </span>
              )}
              {card.locked ? (
                <span className="absolute right-0 top-0 grid place-items-center rounded-bl-nomi-sm bg-nomi-overlay-chip-strong px-0.5 text-nomi-paper">
                  <IconLock size={9} stroke={2} aria-label={t('storyboardEditor.frame.lockedBadge')} />
                </span>
              ) : null}
            </span>
            <span className="flex min-w-0 flex-col">
              <span className="min-w-0 truncate text-caption font-medium text-nomi-ink-80">{name}</span>
              <span className={cn('min-w-0 truncate text-micro', card.failed ? 'text-workbench-danger' : 'text-nomi-ink-40')}>{stat}</span>
            </span>
          </button>
        )
      })}
      {onAddAnchor ? (
        <button
          type="button"
          onClick={onAddAnchor}
          className="inline-flex h-12 shrink-0 items-center gap-1 rounded-nomi border border-dashed border-nomi-ink-20 px-2.5 text-caption text-nomi-ink-40 hover:border-nomi-ink-40 hover:text-nomi-ink-60"
        >
          <IconPlus size={14} stroke={1.8} />
          {t('storyboardEditor.addAnchor')}
        </button>
      ) : null}
    </div>
  )
}
