import React from 'react'
import { cn } from '../../../utils/cn'
import { WorkbenchButton } from '../../../design'
import type { ReconcileDeviation } from '../agent/reconcile'

type ReconcileDeviationCardProps = {
  deviations: ReconcileDeviation[]
  /** 一键整笔撤销(S6-2 后整笔提议=一个 undo barrier,一次 undo 即全退)。 */
  onUndoAll: () => void
  onDismiss: () => void
  /** 时间线内嵌(方案三):去外框,导轨提供视觉结构。 */
  flat?: boolean
}

const formatValue = (value: unknown): string => {
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  return text.length > 60 ? `${text.slice(0, 60)}…` : text
}

/**
 * 对账偏差卡(S6-3,N12):「执行与批准有 N 处出入」+ per-field diff + 一键整笔撤销。
 * 正常对账一致时这张卡永远不出现(M1:用户什么都看不见)——它是诚实纪律的兜底面,
 * 不是常驻 UI。样式复用 pending 工具卡的卡式(同层级、同密度),警示色用 --nomi-snap-tag。
 */
export default function ReconcileDeviationCard({ deviations, onUndoAll, onDismiss, flat = false }: ReconcileDeviationCardProps): JSX.Element {
  return (
    <div
      className={cn('flex flex-col gap-2', flat ? '' : 'p-3 rounded-nomi border border-nomi-line bg-nomi-paper')}
      data-reconcile-deviation-card="true"
      aria-label="执行与批准的出入"
    >
      <div className={cn('text-[12px] font-medium uppercase tracking-wider text-[var(--nomi-snap-tag)]')}>
        ⚠ 执行与批准有 {deviations.length} 处出入
      </div>
      <ul className={cn('flex flex-col gap-1 list-none p-0 m-0')}>
        {deviations.map((deviation, index) => (
          <li key={index} className={cn('flex flex-col gap-[2px] p-2 rounded-nomi-sm bg-nomi-ink-05 text-caption')}>
            <span className={cn('text-nomi-ink font-medium')}>{deviation.where} · {deviation.field}</span>
            <span className={cn('text-nomi-ink-60')}>
              批准的：{formatValue(deviation.expected)}
            </span>
            <span className={cn('text-[var(--nomi-snap-tag)]')}>
              实际的：{formatValue(deviation.actual)}
            </span>
          </li>
        ))}
      </ul>
      <div className={cn('flex items-center justify-end gap-2')}>
        <WorkbenchButton
          className={cn(
            'h-7 px-3 rounded-nomi-sm border border-nomi-line bg-nomi-paper text-nomi-ink-80 text-[12px] cursor-pointer hover:bg-nomi-ink-05',
          )}
          onClick={onDismiss}
        >
          保留现状
        </WorkbenchButton>
        <WorkbenchButton
          className={cn(
            'h-7 px-3 rounded-nomi-sm border-0 bg-nomi-ink text-nomi-paper text-[12px] cursor-pointer hover:bg-nomi-accent',
          )}
          data-reconcile-undo-all="true"
          onClick={onUndoAll}
        >
          整笔撤销
        </WorkbenchButton>
      </div>
    </div>
  )
}
