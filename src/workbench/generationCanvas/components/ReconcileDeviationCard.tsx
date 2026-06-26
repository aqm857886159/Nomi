import React from 'react'
import { cn } from '../../../utils/cn'
import { WorkbenchButton } from '../../../design'
import type { ReconcileDeviation } from '../agent/reconcile'

type ReconcileDeviationCardProps = {
  deviations: ReconcileDeviation[]
  /** 一键整笔撤销(S6-2 后整笔提议=一个 undo barrier,一次 undo 即全退)。 */
  onUndoAll: () => void
  onDismiss: () => void
  /** 让 AI 用模型支持的方式把没接上的连接重连(完整版重设计,用户拍板 2026-06-13)。 */
  onAiFix?: () => void
  /** 时间线内嵌(方案三):去外框,导轨提供视觉结构。 */
  flat?: boolean
}

const trunc = (value: unknown, max = 40): string => {
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  return text.length > max ? `${text.slice(0, max)}…` : text
}

/** 边类偏差:where 已是「源标题」→「目标标题」,正文不再重复 field。 */
const isEdgeField = (field: string): boolean => field === '引用边' || field === '边语义'

/** 一条偏差的人话正文:边→为什么没接上;其余→批准 vs 实际。 */
function detailLine(d: ReconcileDeviation): string {
  if (d.field === '引用边') return d.reason ? `没接上 · ${d.reason}` : '这条连接没接上'
  if (d.field === '边语义') return `连接方式落地成了「${trunc(d.actual)}」，批准的是「${trunc(d.expected)}」`
  if (d.field === '节点') return `${trunc(d.expected)} → ${trunc(d.actual)}`
  return `批准「${trunc(d.expected)}」· 实际「${trunc(d.actual)}」`
}

/**
 * 对账偏差卡(S6-3,N12 → 2026-06-13 完整版重设计):用节点标题+人话说明「哪些没按计划生效、
 * 为什么」,而不是甩原始 id + 黑话。正常对账一致时永不出现——它是诚实纪律的兜底面,不是常驻 UI。
 */
export default function ReconcileDeviationCard({ deviations, onUndoAll, onDismiss, onAiFix, flat = false }: ReconcileDeviationCardProps): JSX.Element {
  const hasEdgeMiss = deviations.some((d) => d.field === '引用边')
  return (
    <div
      className={cn('flex flex-col gap-2', flat ? '' : 'p-3 rounded-nomi border border-nomi-line bg-nomi-paper')}
      data-reconcile-deviation-card="true"
      aria-label="执行与批准的出入"
    >
      <div className={cn('text-caption text-nomi-ink-60')}>
        你批准的计划里，下面这些没按计划生效；其它节点都已正常应用。
      </div>
      <ul className={cn('flex flex-col gap-1 list-none p-0 m-0')}>
        {deviations.map((deviation, index) => (
          <li key={index} className={cn('flex flex-col gap-[2px] p-2 rounded-nomi-sm bg-nomi-ink-05 text-caption')}>
            <span className={cn('text-nomi-ink font-medium')}>
              {deviation.where}
              {isEdgeField(deviation.field) ? '' : ` · ${deviation.field}`}
            </span>
            <span className={cn('text-nomi-ink-60')}>{detailLine(deviation)}</span>
          </li>
        ))}
      </ul>
      {/* flex-wrap + shrink-0:三个按钮在窄面板放不下时整组换行(AI 修一行、保持/撤销一行),不挤压不竖排。 */}
      <div className={cn('flex flex-wrap items-center gap-2')}>
        {onAiFix && hasEdgeMiss ? (
          <WorkbenchButton className={cn('shrink-0')} variant="accent" size="sm" data-reconcile-ai-fix="true" onClick={onAiFix}>
            让 AI 修一下
          </WorkbenchButton>
        ) : null}
        <div className={cn('flex items-center gap-2 ml-auto')}>
          <WorkbenchButton className={cn('shrink-0')} variant="default" size="sm" onClick={onDismiss}>
            保持现状
          </WorkbenchButton>
          <WorkbenchButton className={cn('shrink-0')} variant="primary" size="sm" data-reconcile-undo-all="true" onClick={onUndoAll}>
            撤销这次改动
          </WorkbenchButton>
        </div>
      </div>
    </div>
  )
}
