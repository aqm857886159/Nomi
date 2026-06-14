import React from 'react'
import { IconChevronDown, IconChevronRight } from '@tabler/icons-react'
import { cn } from '../../../utils/cn'
import { WorkbenchButton } from '../../../design'
import { useWorkbenchStore } from '../../workbenchStore'
import {
  detectLostUserEdits,
  runProposalUndo,
  type CommittedProposalRecord,
} from '../agent/proposalUndo'

/**
 * 已应用提议卡(S6-5):commit 后存活到下一笔提议或本会话结束(约束①)。
 * 「查看步骤」= 最小轨迹视图(本笔事务的人话步骤+对账状态);
 * 「整笔撤销」= 补偿事务回退本笔,期间用户工作保留;用户改过提议节点时先列明再丢(N13)。
 */
export default function CommittedProposalCard({ record, onUndone, flat = false }: {
  record: CommittedProposalRecord
  onUndone?: () => void
  /** 时间线内嵌(方案三):去外框,导轨提供视觉结构。 */
  flat?: boolean
}): JSX.Element {
  const [stepsOpen, setStepsOpen] = React.useState(false)
  const [lostEdits, setLostEdits] = React.useState<string[] | null>(null)
  const setActiveCategoryId = useWorkbenchStore((state) => state.setActiveCategoryId)
  const activeCategoryId = useWorkbenchStore((state) => state.activeCategoryId)
  // 落点回报(审计 A1):本笔节点落进了哪些分类——非当前分类的给跳转 chip,
  // 否则跨分类产物(定妆卡等)对停在分镜视图的用户等于凭空消失。
  const jumpTargets = (record.categoryCounts ?? []).filter((item) => item.count > 0)

  const handleUndo = () => {
    const lost = detectLostUserEdits(record)
    if (lost.length && lostEdits === null) {
      setLostEdits(lost) // 先列明将丢失的修改,等第二次确认
      return
    }
    runProposalUndo(record)
    onUndone?.()
  }

  return (
    <div
      className={cn('flex flex-col gap-2', flat ? '' : 'p-3 rounded-nomi border border-nomi-line-soft bg-nomi-ink-05/60')}
      data-committed-proposal-card={record.proposalId}
    >
      <div className={cn('flex items-center gap-2')}>
        <span className={cn('text-caption text-nomi-ink-80')}>✓ 已应用：{record.summary}</span>
        {!record.reconciliationOk ? (
          <span className={cn('text-caption text-[var(--nomi-snap-tag)]')}>有出入</span>
        ) : null}
        <button
          type='button'
          className={cn(
            'ml-auto inline-flex items-center gap-1 border-0 bg-transparent p-0 cursor-pointer',
            'text-caption text-nomi-ink-60 hover:text-nomi-ink',
          )}
          onClick={() => setStepsOpen((open) => !open)}
        >
          {stepsOpen ? <IconChevronDown size={12} stroke={2} /> : <IconChevronRight size={12} stroke={2} />}
          查看步骤
        </button>
        <WorkbenchButton
          variant='default'
          size='sm'
          data-proposal-undo-all='true'
          onClick={handleUndo}
        >
          整笔撤销
        </WorkbenchButton>
      </div>
      {jumpTargets.length > 0 ? (
        <div className={cn('flex flex-wrap items-center gap-1')}>
          {jumpTargets.map((item) => (
            <button
              key={item.categoryId}
              type='button'
              data-proposal-category-jump={item.categoryId}
              className={cn(
                'inline-flex items-center h-5 px-2 rounded-full border text-micro cursor-pointer',
                item.categoryId === activeCategoryId
                  ? 'border-nomi-line-soft bg-nomi-ink-05 text-nomi-ink-60 cursor-default'
                  : 'border-nomi-line bg-nomi-paper text-nomi-ink-80 hover:bg-nomi-ink-05',
              )}
              onClick={() => setActiveCategoryId(item.categoryId)}
            >
              {item.label} {item.count}
            </button>
          ))}
        </div>
      ) : null}
      {stepsOpen ? (
        <ol className={cn('flex flex-col gap-1 list-none p-0 m-0')}>
          {record.stepLabels.map((label, index) => (
            <li key={index} className={cn('text-caption text-nomi-ink-60')}>
              {index + 1}. {label}
            </li>
          ))}
        </ol>
      ) : null}
      {lostEdits ? (
        <div className={cn('flex flex-col gap-2 p-2 rounded-nomi-sm bg-nomi-paper border border-nomi-line')}>
          <span className={cn('text-caption font-medium text-[var(--nomi-snap-tag)]')}>
            撤销将一并丢失你 commit 后的修改：
          </span>
          {lostEdits.map((line, index) => (
            <span key={index} className={cn('text-caption text-nomi-ink-80')}>· {line}</span>
          ))}
          <div className={cn('flex items-center justify-end gap-2')}>
            <WorkbenchButton variant='default' size='sm' onClick={() => setLostEdits(null)}>
              取消
            </WorkbenchButton>
            <WorkbenchButton variant='primary' size='sm' data-proposal-undo-confirm='true' onClick={handleUndo}>
              仍要撤销
            </WorkbenchButton>
          </div>
        </div>
      ) : null}
    </div>
  )
}
