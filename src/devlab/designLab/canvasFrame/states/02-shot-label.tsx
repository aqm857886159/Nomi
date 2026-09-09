import React from 'react'
import type { ShotLabelFixture } from '../shotLabelFixture'
import type { LabState } from '../../labScreen'
import BaseGenerationNode from '../../../../workbench/generationCanvas/nodes/BaseGenerationNode'
import { useGenerationCanvasStore } from '../../../../workbench/generationCanvas/store/generationCanvasStore'
import { useWorkbenchStore } from '../../../../workbench/workbenchStore'
import type { GenerationCanvasNode } from '../../../../workbench/generationCanvas/model/generationCanvasTypes'

function ShotLabelStage(): JSX.Element {
  const [ready, setReady] = React.useState(false)
  const node = useGenerationCanvasStore((s) => s.nodes.find((n) => n.id === 'label-shot'))
  const selected = useGenerationCanvasStore((s) => s.selectedNodeIds.includes('label-shot'))
  const zoom = useWorkbenchStore((s) => s.categoryViewports.shots?.zoom ?? 1)
  React.useEffect(() => {
    const update = (event: Event) => {
      const { kind, zoom, selected, details = false, nodePatch } = (event as CustomEvent<ShotLabelFixture>).detail
      const shot = useGenerationCanvasStore.getState().nodes.find((n) => n.id === 'label-shot')!
      const reference: GenerationCanvasNode = { id: 'label-reference', kind: 'character', title: '阿青', categoryId: 'characters', position: { x: 0, y: 0 }, status: 'idle' }
      useGenerationCanvasStore.setState({ nodes: [{ ...shot,
        kind: kind === 'empty' ? 'image' : kind, status: details && kind === 'image' ? 'running' : kind === 'empty' ? 'idle' : 'success',
        title: details ? '雨夜街口非常长的镜头标题验证截断与参考角色共存' : '雨夜街口',
        progress: details && kind === 'image' ? { phase: 'generating', updatedAt: 1 } : undefined,
        meta: details && kind === 'video' ? { videoDeconstruction: { shots: [{ index: 1 }] } } : undefined,
        result: kind === 'empty' ? undefined : { id: 'label-result', type: kind === 'video' ? 'video' : 'image', url: kind === 'video' ? '/fixtures/node-label-video.mp4' : '/fixtures/process-feedback-frame.svg', createdAt: 1 },
        ...nodePatch,
      }, ...(details ? [reference] : [])],
        edges: details ? [{ id: 'label-reference-edge', source: reference.id, target: shot.id }] : [],
        selectedNodeIds: selected ? ['label-shot'] : [] })
      useWorkbenchStore.getState().rememberCategoryViewport('shots', { zoom, offset: { x: 0, y: 0 } })
    }
    window.addEventListener('nomi-label-fixture', update)
    return () => window.removeEventListener('nomi-label-fixture', update)
  }, [])
  React.useLayoutEffect(() => {
    const shot: GenerationCanvasNode = {
      id: 'label-shot', kind: 'image', categoryId: 'shots', title: '雨夜街口', shotIndex: 2,
      position: { x: 0, y: 0 }, size: { width: 340, height: 240 }, status: 'idle',
    }
    useWorkbenchStore.setState({ activeCategoryId: 'shots' })
    useWorkbenchStore.getState().rememberCategoryViewport('shots', { zoom: 1, offset: { x: 0, y: 0 } })
    useGenerationCanvasStore.setState({ nodes: [shot], edges: [], selectedNodeIds: [] })
    setReady(true)
  }, [])
  return <div data-label-stage className="workbench-generation__canvas relative bg-nomi-paper" style={{ width: 800, height: 560 }}>
    {ready && node ? <div className="absolute" style={{ left: 160, top: 160, transform: `scale(${zoom})`, transformOrigin: 'top left' }}>
      <BaseGenerationNode node={node} selected={selected} />
    </div> : null}
  </div>
}

export const SHOT_LABEL_STATES: readonly LabState[] = [
  {
    id: 'canvas-frame-shot-label-outside',
    name: '镜头标签 · 框外左上',
    source: 'docs/plan/2026-09-09-node-label-outside.md',
    coverage: 'shell',
    render: () => <ShotLabelStage />,
  },
]
