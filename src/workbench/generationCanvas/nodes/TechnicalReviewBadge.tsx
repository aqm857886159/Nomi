// 技术自检 ⚠ 徽标(harness S4-2b)。只标记不裁决:tooltip 给人话原因,内容原样保留。
// 外挂组件:BaseGenerationNode 是白名单巨壳(R12),不往里塞实现。
import React from 'react'
import { cn } from '../../../utils/cn'

type TechnicalReview = { verdict?: string; checks?: { suspect: boolean; detail: string }[] }

export function TechnicalReviewBadge({ meta }: { meta?: Record<string, unknown> }): JSX.Element | null {
  const review = (meta as { technicalReview?: TechnicalReview } | undefined)?.technicalReview
  if (review?.verdict !== 'suspect') return null
  const reasons = (review.checks || []).filter((check) => check.suspect).map((check) => check.detail).join(';')
  return (
    <span
      className={cn('text-micro py-[3px] px-2 rounded-nomi-sm bg-workbench-danger-soft text-workbench-danger')}
      title={`自检提醒:${reasons || '结果可能有问题'} — 内容不变,仅提醒;可重新生成`}
      data-technical-review='suspect'
    >
      ⚠
    </span>
  )
}
