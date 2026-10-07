import type { JSX } from 'react'
import { useTranslation } from 'react-i18next'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import { isDerivedPromptReady } from './deriveFromNode'

/**
 * 派生出来、提示词已填好、还没生成的节点：标题行里紧跟标题的小标「已备好 · 未生成」（绿点 + success-soft 底 + success-edge 边）。
 * 判据是节点数据上的派生标记（`isDerivedPromptReady`），不是「提示词非空」；点 ↑ 开跑后标记失效，小标消失。
 */
export function DerivedReadyBadge({ node }: { node: Pick<GenerationCanvasNode, 'meta' | 'status' | 'runs' | 'result'> }): JSX.Element | null {
  const { t } = useTranslation()
  if (!isDerivedPromptReady(node)) return null
  return (
    <span
      data-derived-ready-badge="true"
      className="inline-flex h-5 shrink-0 items-center gap-1 rounded-full border border-nomi-success-edge bg-nomi-success-soft px-2 text-micro text-nomi-success-ink"
    >
      <span className="size-1.5 rounded-full bg-nomi-success" aria-hidden="true" />
      {t('generationCommon.quickActions.derivedReadyBadge')}
    </span>
  )
}
