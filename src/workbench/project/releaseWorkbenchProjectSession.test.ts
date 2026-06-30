import { afterEach, describe, expect, it } from 'vitest'
import type { GenerationCanvasNode } from '../generationCanvas/model/generationCanvasTypes'
import { useGenerationCanvasStore } from '../generationCanvas/store/generationCanvasStore'
import { useWorkbenchStore } from '../workbenchStore'
import { createDefaultTimeline } from '../timeline/timelineMath'
import { releaseWorkbenchProjectRuntimeState } from './releaseWorkbenchProjectSession'

function node(id: string): GenerationCanvasNode {
  return {
    id,
    kind: 'image',
    title: id,
    prompt: '',
    position: { x: 0, y: 0 },
  } as GenerationCanvasNode
}

describe('releaseWorkbenchProjectRuntimeState', () => {
  afterEach(() => {
    releaseWorkbenchProjectRuntimeState()
  })

  it('clears heavy project state without resetting store actions', () => {
    const addNode = useGenerationCanvasStore.getState().addNode
    useGenerationCanvasStore.setState({
      isReady: true,
      nodes: [node('n1')],
      edges: [{ id: 'e1', source: 'n1', target: 'n2' }],
      groups: [{ id: 'g1', name: 'Group', categoryId: 'shots', nodeIds: ['n1'] }],
      selectedNodeIds: ['n1'],
      generationAiDraft: 'draft',
      generationAiMessages: [{ id: 'm1', role: 'assistant', content: 'hello' }],
      hasClipboard: true,
    })
    useWorkbenchStore.setState({
      creationAiMessages: [{ id: 'm2', role: 'user', content: 'hello' }],
      storyboardPlan: { title: 'plan', anchors: [], shots: [] },
      storyboardPlanCommitted: true,
      timeline: { ...createDefaultTimeline(), playheadFrame: 24 },
      selectedTimelineClipIds: ['clip1'],
      timelineUndoStack: [createDefaultTimeline()],
    })

    releaseWorkbenchProjectRuntimeState()

    const canvas = useGenerationCanvasStore.getState()
    expect(canvas.nodes).toEqual([])
    expect(canvas.edges).toEqual([])
    expect(canvas.groups).toEqual([])
    expect(canvas.selectedNodeIds).toEqual([])
    expect(canvas.generationAiDraft).toBe('')
    expect(canvas.generationAiMessages).toEqual([])
    expect(canvas.addNode).toBe(addNode)

    const workbench = useWorkbenchStore.getState()
    expect(workbench.creationAiMessages).toEqual([])
    expect(workbench.storyboardPlan).toBeNull()
    expect(workbench.storyboardPlanCommitted).toBe(false)
    expect(workbench.timeline).toEqual(createDefaultTimeline())
    expect(workbench.selectedTimelineClipIds).toEqual([])
    expect(workbench.timelineUndoStack).toEqual([])
  })
})
