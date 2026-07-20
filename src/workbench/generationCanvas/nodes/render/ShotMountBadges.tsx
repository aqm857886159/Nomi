import React from 'react'
import { useTranslation } from 'react-i18next'
import { IconPhoto, IconUser } from '@tabler/icons-react'
import { cn } from '../../../../utils/cn'
import type { MountedCard } from '../../hooks/useNodeRelationships'

/**
 * 切片2：镜头面「挂了哪些设定卡」徽章（bottom-left caption）——不选中也能一眼看出挂了谁，
 * 免点开数连线（出片前可审计）。最多 2 个 + 「+N」，名字过长截断。角色=IconUser/场景=IconPhoto。
 * 空挂载返回 null（调用方无需再判，保持节点面干净）。
 */
export default function ShotMountBadges({ cards }: { cards: readonly MountedCard[] }): JSX.Element | null {
  const { t } = useTranslation()
  if (cards.length === 0) return null
  const rest = cards.slice(2)
  // +N 悬浮列表：截断名字唯一的可读回退，但别甩出整屏长串——超 5 个收成「…等 N 个」。
  const restTitle =
    rest.length > 5
      ? `${rest
          .slice(0, 5)
          .map((card) => card.title)
          .join('、')}…等 ${rest.length} 个`
      : rest.map((card) => card.title).join('、')
  return (
    // 行本身 pointer-events-none（空隙不挡画布拖拽/选中）；每个 chip 单独放开指针事件，
    // 否则截断名字 / +N 的 title 悬浮提示永远不触发（截断的唯一查看回退就失效了）。
    <div
      className={cn(
        'absolute bottom-[10px] left-[10px] z-[2] flex items-center gap-1 max-w-[calc(100%-20px)] overflow-hidden',
        'pointer-events-none',
      )}
    >
      {cards.slice(0, 2).map((card) => (
        <span
          key={card.id}
          title={t('generationCommon.node.mountTitle', { title: card.title })}
          className={cn(
            'pointer-events-auto cursor-default inline-flex items-center gap-1 min-w-0 py-[3px] px-2 rounded-nomi-sm',
            'text-micro text-nomi-ink-60 bg-nomi-paper/[0.82] backdrop-blur-[8px]',
          )}
        >
          {card.kind === 'character' ? (
            <IconUser size={11} stroke={1.8} aria-hidden="true" />
          ) : (
            <IconPhoto size={11} stroke={1.8} aria-hidden="true" />
          )}
          <span className="truncate max-w-[88px]">{card.title}</span>
        </span>
      ))}
      {rest.length > 0 ? (
        <span
          title={restTitle}
          className={cn(
            'pointer-events-auto cursor-default py-[3px] px-2 rounded-nomi-sm text-micro text-nomi-ink-60',
            'bg-nomi-paper/[0.82] backdrop-blur-[8px]',
          )}
        >
          +{rest.length}
        </span>
      ) : null}
    </div>
  )
}
