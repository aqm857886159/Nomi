import React from 'react'
import { useTranslation } from 'react-i18next'
import { IconCut, IconX } from '@tabler/icons-react'

import { NomiSegmented } from '../../../design'
import { cn } from '../../../utils/cn'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import { VideoAnalysisStructureView } from './VideoAnalysisStructureView'
import { VideoShotCutsView } from './VideoShotCutsView'

export type VideoDeconstructionView = 'cuts' | 'structure'

export function VideoDeconstructionPanel({
  node,
  projectId,
  initialView,
  initialAnalysisId,
  initialShotId,
  onClose,
}: {
  node: GenerationCanvasNode
  projectId: string
  initialView: VideoDeconstructionView
  initialAnalysisId: string | null
  initialShotId: number | null
  onClose: () => void
}): JSX.Element {
  const { t } = useTranslation()
  const [view, setView] = React.useState<VideoDeconstructionView>(initialView)
  const [analysisId, setAnalysisId] = React.useState<string | null>(initialAnalysisId)

  React.useEffect(() => {
    const handleKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      onClose()
    }
    window.addEventListener('keydown', handleKey, true)
    return () => window.removeEventListener('keydown', handleKey, true)
  }, [onClose])

  return (
    <section
      className={cn(
        'absolute inset-0 z-[90] flex min-h-0 min-w-0 flex-col overflow-hidden bg-nomi-paper shadow-nomi-lg',
        'min-[1200px]:inset-y-0 min-[1200px]:left-auto min-[1200px]:right-0 min-[1200px]:w-[520px] min-[1200px]:border-l min-[1200px]:border-nomi-line',
      )}
      role="dialog"
      aria-modal="false"
      aria-label={t('generationCommon.node.videoDeconstruction.title')}
      data-video-deconstruction-panel="true"
    >
      <header className="flex shrink-0 items-center gap-3 border-b border-nomi-line px-4 py-3 max-[719px]:flex-wrap">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <IconCut size={17} stroke={1.8} className="shrink-0 text-nomi-ink-60" aria-hidden />
          <div className="min-w-0">
            <h2 className="truncate text-title text-nomi-ink">{t('generationCommon.node.videoDeconstruction.title')}</h2>
            <div className="truncate text-micro text-nomi-ink-40">{node.title}</div>
          </div>
        </div>
        <NomiSegmented
          className="w-56 shrink-0 max-[719px]:order-3 max-[719px]:w-full"
          value={view}
          ariaLabel={t('generationCommon.node.videoDeconstruction.mode')}
          options={[
            { value: 'cuts', label: t('generationCommon.node.videoDeconstruction.cuts') },
            { value: 'structure', label: t('generationCommon.node.videoDeconstruction.structure') },
          ]}
          onChange={(value) => setView(value as VideoDeconstructionView)}
        />
        <button
          type="button"
          className="grid size-8 shrink-0 place-items-center rounded-nomi-sm border-0 bg-transparent text-nomi-ink-60 hover:bg-nomi-ink-05 hover:text-nomi-ink"
          aria-label={t('generationCommon.node.videoDeconstruction.close')}
          title={t('generationCommon.node.videoDeconstruction.closeHint')}
          onClick={onClose}
        >
          <IconX size={16} stroke={1.8} aria-hidden />
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-hidden">
        {view === 'cuts' ? (
          <VideoShotCutsView node={node} projectId={projectId} onDone={onClose} />
        ) : (
          <VideoAnalysisStructureView
            node={node}
            projectId={projectId}
            analysisId={analysisId}
            focusedShotId={initialShotId}
            onAnalysisIdChange={setAnalysisId}
            onDone={onClose}
          />
        )}
      </div>
    </section>
  )
}
