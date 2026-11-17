import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { DocumentAnchorRef } from '../../../../electron/shared/capabilityTargeting'
import { formatAgentContextSnapshot } from '../../../../electron/shared/agentContextSnapshot'
import { useWorkbenchStore } from '../../workbenchStore'
import {
  residentSelectionInput,
  resolveResidentSelection,
  resolveResidentSelectionMembers,
  type ResidentSelectionSources,
} from './residentContextSnapshot'
import type { ResidentSurface } from './residentShellDisplay'

const anchor: DocumentAnchorRef = Object.freeze({ kind: 'range', from: 0, to: 4, selectedTextHash: 'h' })
const media = (id: string, label = id) => ({ id, type: 'video' as const, label, startFrame: 0, endFrame: 30 })
const text = (id: string, body: string) => ({ id, text: body, startFrame: 30, endFrame: 60 })

function sources(overrides: {
  selectedClips?: string[]
  selectedText?: string
  tracks?: ReturnType<typeof media>[]
  textClips?: ReturnType<typeof text>[]
  selectedNodes?: string[]
  nodes?: Array<{ id: string; title?: string; kind?: string }>
} = {}): ResidentSelectionSources {
  return {
    document: { id: 'doc-1', revision: 3, anchor, title: '文稿' },
    workbench: {
      timeline: { fps: 30, tracks: [{ clips: overrides.tracks ?? [media('a', '片段A'), media('b', '片段B')] }], textClips: overrides.textClips ?? [text('t', '标题')] },
      selectedTimelineClipIds: overrides.selectedClips ?? [],
      selectedTextClipId: overrides.selectedText ?? '',
    },
    canvas: {
      persistRevision: 8,
      nodes: overrides.nodes ?? [{ id: 'n1', title: '镜头1', kind: 'image' }, { id: 'n2', title: '镜头2', kind: 'video' }, { id: 'n3', title: '镜头3', kind: 'image' }],
      selectedNodeIds: overrides.selectedNodes ?? [],
    },
    readTimelineRevision: () => 'tl-1',
  }
}

const resolve = (surface: ResidentSurface, src: ResidentSelectionSources) => resolveResidentSelection(residentSelectionInput(surface, src))
const chipMembers = (surface: ResidentSurface, src: ResidentSelectionSources) => resolveResidentSelectionMembers(residentSelectionInput(surface, src))
const handleIds = (snapshot: ReturnType<typeof resolve>['snapshot'], kind: string) => snapshot.handles.filter((h) => h.kind === kind).map((h) => h.targetId)

describe('助手这一轮的选区只算一遍：目标、快照、芯片是同一批', () => {
  it('预览面：选两段媒体——目标、快照、芯片成员同序同批', () => {
    const src = sources({ selectedClips: ['b', 'a'] })
    const selection = resolve('preview', src)
    expect(selection.timelineClipIds).toEqual(['b', 'a'])
    expect(handleIds(selection.snapshot, 'timelineClip')).toEqual(['b', 'a'])
    expect(chipMembers('preview', src).timelineMembers.map((m) => m.id)).toEqual(['b', 'a'])
    expect(chipMembers('preview', src).timelineMembers.map((m) => m.title)).toEqual(['片段B', '片段A'])
  })

  it('画布面：选三个节点——目标与快照同序；预览域的选区这一轮不算', () => {
    const src = sources({ selectedNodes: ['n3', 'n1', 'n2'], selectedClips: ['a'] })
    const selection = resolve('generation', src)
    expect(selection.canvasNodeIds).toEqual(['n3', 'n1', 'n2'])
    expect(handleIds(selection.snapshot, 'canvasNode')).toEqual(['n3', 'n1', 'n2'])
    expect(selection.timelineClipIds).toEqual([])
    expect(handleIds(selection.snapshot, 'timelineClip')).toEqual([])
  })

  it('创作面与分镜面：只带文稿，没有任何画布 / 时间轴选区', () => {
    for (const surface of ['creation', 'storyboard'] as const) {
      const selection = resolve(surface, sources({ selectedNodes: ['n1'], selectedClips: ['a'], selectedText: 't' }))
      expect(selection.snapshot.handles.map((h) => h.kind), surface).toEqual(['document'])
      expect(selection.canvasNodeIds, surface).toEqual([])
      expect(selection.timelineClipIds, surface).toEqual([])
      expect(chipMembers(surface, sources({ selectedClips: ['a'] })).timelineMembers, surface).toEqual([])
    }
  })

  it('D1：预览里只选了文字——目标、快照、芯片都带它，助手收得到这段文字', () => {
    const src = sources({ selectedText: 't' })
    const selection = resolve('preview', src)
    expect(selection.timelineClipIds).toEqual(['t'])
    expect(handleIds(selection.snapshot, 'timelineClip')).toEqual(['t'])
    expect(selection.snapshot.handles.find((h) => h.targetId === 't')?.display).toMatchObject({ title: '标题', subtitle: 'text' })
    expect(chipMembers('preview', src).timelineMembers).toEqual([{ id: 't', title: '标题' }])
    expect(formatAgentContextSnapshot(selection.snapshot)).toContain('标题')
  })

  it('D1：媒体与文字同选——媒体在前、文字在后', () => {
    const selection = resolve('preview', sources({ selectedClips: ['a'], selectedText: 't' }))
    expect(selection.timelineClipIds).toEqual(['a', 't'])
  })

  it('D2：重复、不存在、带空白的项——三处都滤掉、去重、保持顺序', () => {
    const src = sources({ selectedClips: ['a', 'a', 'ghost', ' b '], selectedNodes: ['n2', 'n2', 'ghost', 'n1'] })
    const preview = resolve('preview', src)
    expect(preview.timelineClipIds).toEqual(['a', 'b'])
    expect(handleIds(preview.snapshot, 'timelineClip')).toEqual(['a', 'b'])
    expect(chipMembers('preview', src).timelineMembers.map((m) => m.id)).toEqual(['a', 'b'])
    const canvas = resolve('generation', src)
    expect(canvas.canvasNodeIds).toEqual(['n2', 'n1'])
    expect(handleIds(canvas.snapshot, 'canvasNode')).toEqual(['n2', 'n1'])
    // 不存在的文字片段不留空芯片
    expect(resolve('preview', sources({ selectedText: 'ghost' })).timelineClipIds).toEqual([])
  })

  it('D3：名字是空白——芯片和快照都回落成 ID，不出现空白芯片', () => {
    const src = sources({ tracks: [media('a', '   ')], textClips: [text('t', '  ')], selectedClips: ['a'], selectedText: 't' })
    const selection = resolve('preview', src)
    expect(selection.snapshot.handles.filter((h) => h.kind === 'timelineClip').map((h) => h.display.title)).toEqual(['a', 't'])
    expect(chipMembers('preview', src).timelineMembers.map((m) => m.title)).toEqual(['a', 't'])
    const canvas = sources({ nodes: [{ id: 'n1', title: '\t' }], selectedNodes: ['n1'] })
    expect(resolve('generation', canvas).canvasMembers).toEqual([{ id: 'n1', title: 'n1' }])
  })

  it('真实工作台里点选字幕：和上面同一份结果（选中状态来自真 store）', () => {
    const store = useWorkbenchStore.getState()
    const id = store.addTimelineTextClip('caption', 0)
    const state = useWorkbenchStore.getState()
    const selection = resolveResidentSelection(residentSelectionInput('preview', {
      workbench: state, canvas: { persistRevision: 1, nodes: [], selectedNodeIds: [] }, readTimelineRevision: () => 'r',
    }))
    expect(state.selectedTextClipId).toBe(id)
    expect(selection.timelineClipIds).toEqual([id])
    expect(selection.snapshot.handles).toHaveLength(1)
  })
})

describe('芯片只订阅时间轴切片：拖画布节点不会让助手面板重渲染', () => {
  // 这里没有 DOM 环境，量不了真实重渲染次数；改为盯住结构：芯片这一路不得订阅画布 store。
  it('芯片 hook 与助手面板数据层都不订阅生成画布 store', () => {
    for (const file of ['useResidentSelectionMembers.ts', '../v4/useAgentPanelV4Data.ts']) {
      const source = readFileSync(new URL(file, import.meta.url), 'utf8')
      expect(source, file).not.toMatch(/useGenerationCanvasStore/)
    }
  })
})

describe('芯片显示什么，助手就收到什么：片段被拖走后照常显示、照常发出，不再有「已变更」', () => {
  it('同一段片段换了位置：芯片名不变，快照带它新的位置，没有任何「已变更」的东西可显示', () => {
    const before = sources({ selectedClips: ['a'] })
    const moved = sources({ selectedClips: ['a'], tracks: [{ ...media('a', '片段A'), startFrame: 90, endFrame: 120 }, media('b', '片段B')] })
    expect(chipMembers('preview', moved).timelineMembers).toEqual(chipMembers('preview', before).timelineMembers)
    expect(resolve('preview', moved).snapshot.handles.find((h) => h.targetId === 'a')?.locator).toMatchObject({ type: 'timeRange', startMs: 3000 })
  })

  it('「已变更」的文案、记忆起止帧的 hook 都已删除，不会悄悄回来', () => {
    const files = ['../v4/useAgentPanelV4Data.ts', './timelineAgentSurface.tsx', '../../../i18n/locales/agentPanelV4.ts']
    for (const file of files) {
      const source = readFileSync(new URL(file, import.meta.url), 'utf8')
      expect(source, file).not.toMatch(/clipStale|staleFor|revisionFor|useTimelineSelectionRevisions|timelineClipRevision/)
    }
  })
})
