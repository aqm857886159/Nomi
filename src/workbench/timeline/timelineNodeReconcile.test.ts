import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useWorkbenchStore } from '../workbenchStore'
import { useGenerationCanvasStore } from '../generationCanvas/store/generationCanvasStore'
import type { GenerationCanvasNode } from '../generationCanvas/model/generationCanvasTypes'
import type { TimelineClip, TimelineState } from './timelineTypes'

// 删画布节点 → 时间轴对账（跨 store）：删了节点后时间轴不再放它的悬空 clip。
// 直接 setState 注入时间轴，绕过 normalizeClip 的快照要求，专测 deleteNode → reconcile 路径。

function makeNode(id: string): GenerationCanvasNode {
  return {
    id,
    kind: 'image',
    title: id,
    prompt: '',
    position: { x: 0, y: 0 },
    status: 'success',
    categoryId: 'shots',
  } as unknown as GenerationCanvasNode
}

function makeClip(id: string, sourceNodeId: string, type: TimelineClip['type'] = 'image'): TimelineClip {
  return {
    id,
    type,
    sourceNodeId,
    label: id,
    startFrame: 0,
    endFrame: 30,
    frameCount: 30,
    offsetStartFrame: 0,
    offsetEndFrame: 0,
    url: `file:///media/${id}`,
  }
}

function seedTimeline(imageClips: TimelineClip[], videoClips: TimelineClip[] = []): TimelineState {
  return {
    version: 1,
    fps: 30,
    scale: 1,
    playheadFrame: 0,
    tracks: [
      { id: 'imageTrack', type: 'image', label: '图片轨', clips: imageClips },
      { id: 'videoTrack', type: 'video', label: '媒体轨', clips: videoClips },
    ],
    textClips: [],
  }
}

function allClipIds(): string[] {
  return useWorkbenchStore
    .getState()
    .timeline.tracks.flatMap((track) => track.clips.map((clip) => clip.id))
}

describe('删画布节点 → 时间轴对账（跨 store）', () => {
  beforeEach(() => {
    useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [], edges: [], groups: [] })
  })
  afterEach(() => {
    useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [], edges: [], groups: [] })
    useWorkbenchStore.setState({ timeline: seedTimeline([]), selectedTimelineClipIds: [] })
  })

  it('deleteNode 删掉节点后，时间轴上引用该节点的 clip（含同节点多产物、跨轨）一并移除', () => {
    useGenerationCanvasStore.getState().restoreSnapshot({
      nodes: [makeNode('node-A'), makeNode('node-B')],
      edges: [],
      groups: [],
    })
    useWorkbenchStore.setState({
      timeline: seedTimeline(
        [makeClip('clip-A-r1', 'node-A'), makeClip('clip-B', 'node-B')],
        [makeClip('clip-A-r2', 'node-A', 'video')],
      ),
    })

    expect(allClipIds().sort()).toEqual(['clip-A-r1', 'clip-A-r2', 'clip-B'])

    useGenerationCanvasStore.getState().deleteNode('node-A')

    // node-A 的两个产物都没了，node-B 的留着
    expect(allClipIds()).toEqual(['clip-B'])
  })

  it('deleteSelectedNodes 多选删除后，所有被删节点的 clip 一并移除', () => {
    useGenerationCanvasStore.getState().restoreSnapshot({
      nodes: [makeNode('node-A'), makeNode('node-B'), makeNode('node-C')],
      edges: [],
      groups: [],
    })
    useWorkbenchStore.setState({
      timeline: seedTimeline([
        makeClip('clip-A', 'node-A'),
        makeClip('clip-B', 'node-B'),
        makeClip('clip-C', 'node-C'),
      ]),
    })
    useGenerationCanvasStore.setState({ selectedNodeIds: ['node-A', 'node-C'] })

    useGenerationCanvasStore.getState().deleteSelectedNodes()

    expect(allClipIds()).toEqual(['clip-B'])
  })

  it('删节点同时把指向已删 clip 的时间轴选区收口（不残留幽灵选中）', () => {
    useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [makeNode('node-A')], edges: [], groups: [] })
    useWorkbenchStore.setState({
      timeline: seedTimeline([makeClip('clip-A', 'node-A')]),
      selectedTimelineClipIds: ['clip-A'],
    })

    useGenerationCanvasStore.getState().deleteNode('node-A')

    expect(useWorkbenchStore.getState().selectedTimelineClipIds).toEqual([])
  })

  it('删的节点在时间轴上没有 clip 时不动时间轴（persistRevision 不自增）', () => {
    useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [makeNode('node-A')], edges: [], groups: [] })
    const timeline = seedTimeline([makeClip('clip-other', 'node-other')])
    useWorkbenchStore.setState({ timeline })
    const revBefore = useWorkbenchStore.getState().persistRevision

    useGenerationCanvasStore.getState().deleteNode('node-A')

    expect(useWorkbenchStore.getState().timeline).toBe(timeline) // 引用未变
    expect(useWorkbenchStore.getState().persistRevision).toBe(revBefore)
  })
})
