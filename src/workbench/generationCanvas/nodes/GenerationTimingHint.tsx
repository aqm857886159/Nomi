import React, { type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { selectStableCanvasNodes } from '../store/canvasNodeProjection'
import { nodeSelectedModelAddress } from './controls/parameterControlModel'
import { localGenerationMedian } from '../../observability/generationTiming'
import { admitNumber } from '../../../../electron/shared/videoCapabilities/paramValue'

export function GenerationTimingHint({ node }: { node: GenerationCanvasNode }): JSX.Element | null {
  const { t } = useTranslation()
  const nodes = useGenerationCanvasStore(selectStableCanvasNodes)
  const median = React.useMemo(() => localGenerationMedian(nodes, nodeSelectedModelAddress(node.meta), admitNumber(node.meta?.durationSeconds ?? node.meta?.videoDuration) ?? Number.NaN), [nodes, node.meta])
  if (median === undefined || median < 60000) return null
  // Round a measured median outward to minute bounds; no provider-wide guessed averages.
  const min = Math.max(1, Math.floor(median / 60000))
  const max = Math.max(min, Math.ceil(median / 60000))
  return <span data-process-timing-hint className="absolute bottom-3 left-3 rounded-full bg-nomi-paper px-3 py-1 text-caption text-nomi-ink-60">
    {t('generationCommon.observability.progress.typicalDuration', { min, max })}
  </span>
}
