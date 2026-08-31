import React from 'react'

import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import {
  VideoDeconstructionPanel,
  type VideoDeconstructionView,
} from './VideoDeconstructionPanel'

type OpenState = {
  nodeId: string
  view: VideoDeconstructionView
  analysisId: string | null
  shotId: number | null
}

export function VideoDeconstructionHost({ projectId }: { projectId: string | null }): JSX.Element | null {
  const [opened, setOpened] = React.useState<OpenState | null>(null)
  const node = useGenerationCanvasStore((state) => opened
    ? state.nodes.find((candidate) => candidate.id === opened.nodeId) ?? null
    : null)

  React.useEffect(() => {
    setOpened(null)
  }, [projectId])

  React.useEffect(() => {
    const handleOpen = (event: Event): void => {
      const detail = (event as CustomEvent<Record<string, unknown>>).detail ?? {}
      const nodeId = typeof detail.nodeId === 'string' ? detail.nodeId.trim() : ''
      if (!nodeId) return
      setOpened({
        nodeId,
        view: detail.view === 'cuts' ? 'cuts' : detail.view === 'structure' || typeof detail.analysisId === 'string' ? 'structure' : 'cuts',
        analysisId: typeof detail.analysisId === 'string' ? detail.analysisId : null,
        shotId: typeof detail.shotId === 'number' && Number.isInteger(detail.shotId) ? detail.shotId : null,
      })
    }
    window.addEventListener('nomi-open-video-deconstruction', handleOpen)
    return () => window.removeEventListener('nomi-open-video-deconstruction', handleOpen)
  }, [])

  React.useEffect(() => {
    if (opened && !node) setOpened(null)
  }, [node, opened])

  if (!opened || !node || !projectId || node.result?.type !== 'video') return null
  return (
    <VideoDeconstructionPanel
      key={`${opened.nodeId}:${opened.analysisId ?? 'latest'}:${opened.view}`}
      node={node}
      projectId={projectId}
      initialView={opened.view}
      initialAnalysisId={opened.analysisId}
      initialShotId={opened.shotId}
      onClose={() => setOpened(null)}
    />
  )
}
