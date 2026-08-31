import React from 'react'
import { useTranslation } from 'react-i18next'
import { IconAlertTriangle, IconCheck, IconLink, IconLoader2 } from '@tabler/icons-react'

import { cn } from '../../../utils/cn'
import { getActiveWorkbenchProjectId } from '../../project/workbenchProjectSession'
import {
  selectVideoAnalysisTasks,
  useVideoAnalysisProjectionStore,
} from '../../videoAnalysis/videoAnalysisProjectionStore'
import { resolveVideoAnalysisNodeState } from './videoDeconstructionModel'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import type { StructureExtractionAnalysis } from './videoDeconstructionModel'

export function VideoAnalysisNodeBadge({ nodeId }: { nodeId: string }): JSX.Element | null {
  const { t } = useTranslation()
  const projectId = getActiveWorkbenchProjectId()
  const tasks = useVideoAnalysisProjectionStore((state) => selectVideoAnalysisTasks(state, projectId))
  const projection = React.useMemo(() => resolveVideoAnalysisNodeState(tasks, nodeId), [nodeId, tasks])
  if (!projection) return null
  const Icon = projection.state === 'analyzing' ? IconLoader2 : projection.state === 'complete' ? IconCheck : IconAlertTriangle
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-nomi-sm bg-nomi-paper/[0.82] px-2 py-[3px] backdrop-blur-[8px]',
        'text-micro font-medium text-nomi-ink-60',
        projection.state === 'complete' && 'bg-workbench-success-soft text-workbench-success-ink',
        projection.state === 'attention' && 'bg-nomi-ink-05 text-nomi-warning',
      )}
      title={t(`generationCommon.node.videoDeconstruction.status.${projection.state}`)}
    >
      <Icon size={12} stroke={1.8} className={projection.state === 'analyzing' ? 'animate-spin' : undefined} aria-hidden />
      {t(`generationCommon.node.videoDeconstruction.status.${projection.state}`)}
    </span>
  )
}

function analysisMeta(node: GenerationCanvasNode): StructureExtractionAnalysis | null {
  const value = node.meta?.videoAnalysis
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const candidate = value as Partial<StructureExtractionAnalysis>
  if (!candidate.analysisId || !candidate.shotId || !candidate.sourceNodeId) return null
  return candidate as StructureExtractionAnalysis
}

export function VideoAnalysisProvenanceBadge({ node }: { node: GenerationCanvasNode }): JSX.Element | null {
  const { t } = useTranslation()
  const analysis = analysisMeta(node)
  if (!analysis) return null
  const source = analysis.sourceTitle || t('generationCommon.node.videoDeconstruction.sourceVideo')
  return (
    <button
      type="button"
      className="absolute left-1.5 top-7 z-[3] inline-flex h-6 max-w-[calc(100%-12px)] items-center gap-1 rounded-nomi-sm bg-nomi-paper/[0.9] px-2 text-micro font-medium text-nomi-ink-60 shadow-nomi-sm backdrop-blur-[8px] hover:text-nomi-ink"
      title={t('generationCommon.node.videoDeconstruction.provenanceTitle', { source, time: analysis.timeRange, shot: analysis.shotId })}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation()
        window.dispatchEvent(new CustomEvent('nomi-open-video-deconstruction', {
          detail: { nodeId: analysis.sourceNodeId, view: 'structure', analysisId: analysis.analysisId, shotId: analysis.shotId },
        }))
      }}
    >
      <IconLink size={12} stroke={1.8} className="shrink-0" aria-hidden />
      <span className="truncate">{t('generationCommon.node.videoDeconstruction.provenanceBadge', { source, time: analysis.timeRange })}</span>
    </button>
  )
}
