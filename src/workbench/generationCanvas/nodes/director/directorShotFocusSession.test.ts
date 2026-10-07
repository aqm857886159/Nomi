/**
 * 「正在改：镜头 N」的数据层（3c UI）：镜头条点卡 / 加选写编辑器 store 的选中 → 会话登记处的焦点；
 * 播放时 store 每帧都变，读口仍返回同一个对象；× 清的是编辑器的选中；Agent 改完计划（外部写口）选中与播放头不丢。
 * 走真实边界：真编译器出的工程、真编辑器 store、真画布 store 上的计划 meta、真会话登记处。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { directorPlanRevision, canonicalDirectorPlan } from '../../../../../electron/shared/director/planPatch'
import { parseDirectorPlan } from '../../../../../electron/shared/director/directorPlanSchema'
import { useGenerationCanvasStore } from '../../store/generationCanvasStore'
import { generationCanvasTools } from '../../agent/generationCanvasTools'
import { readDirectorShotFocus, registerDirectorSession, subscribeDirectorShotFocus, writeExternalDirectorProject } from './directorSessionRegistry'
import { createEditorShotFocusSession } from './directorShotFocusSession'
import { compileDirectorPlan } from './model/compiler/directorPlanCompiler'
import { DIRECTOR_NODE_KIND, DIRECTOR_PLAN_META_KEY, DIRECTOR_PROJECT_META_KEY } from './model/directorNodeMeta'
import { nextShotSelection } from './model/directorShotFocus'
import { createDirectorStore, type DirectorStore } from './model/directorStore'

const plan = canonicalDirectorPlan((() => {
  const parsed = parseDirectorPlan({
    scene: { environment: 'day', template: 'room', tags: ['书房'] },
    actors: [
      { id: 'reader', kind: 'person', desc: '读者', placement: { relation: 'at', ref: 's1-room-floor' } },
      { id: 'friend', kind: 'person', desc: '朋友', placement: { relation: 'in_front_of', ref: 'reader' } },
    ],
    shots: [
      { id: 'wide', window: [0, 3], transitionIn: 'cut', subject: 'reader', subjects: ['reader', 'friend'], size: '全景', angle: 'front', height: 'eye', move: { kind: 'static' } },
      { id: 'close', window: [3, 6], transitionIn: 'cut', subject: 'friend', size: '中景', angle: 'three_quarter', height: 'eye', move: { kind: 'push_in', speed: 'slow' } },
      { id: 'react', window: [6, 8], transitionIn: 'cut', subject: 'reader', size: '近景', angle: 'front', height: 'eye', move: { kind: 'static' } },
      { id: 'end', window: [8, 10], transitionIn: 'cut', subject: 'friend', size: '特写', angle: 'front', height: 'eye', move: { kind: 'static' } },
    ],
  })
  if (!parsed.success) throw new Error(parsed.error.message)
  return parsed.data
})())

let nodeId = ''
let store: DirectorStore
let off: () => void = () => undefined

beforeEach(() => {
  for (const node of [...useGenerationCanvasStore.getState().nodes]) useGenerationCanvasStore.getState().deleteNode(node.id)
  const compiled = compileDirectorPlan(plan)
  if (!compiled.ok) throw new Error('compile')
  const [node] = generationCanvasTools.create_nodes([{ kind: DIRECTOR_NODE_KIND, title: '预演', prompt: '', position: { x: 0, y: 0 }, meta: { [DIRECTOR_PROJECT_META_KEY]: compiled.project, [DIRECTOR_PLAN_META_KEY]: { plan, revision: directorPlanRevision(plan), issueCount: 0 } } }])
  nodeId = node.id
  store = createDirectorStore({ rawProject: compiled.project, defaultSceneName: 'S' })
  off = registerDirectorSession(nodeId, { store, defaultSceneName: 'S', ...createEditorShotFocusSession(nodeId, store) })
})
afterEach(() => off())

/** 镜头条点卡的同一套写法（DirectorShotStrip.pick）。 */
function clickCard(shotId: string, additive = false) {
  const state = store.getState()
  const current = state.selection.multiCameraIds.length ? state.selection.multiCameraIds : state.selection.cameraId ? [state.selection.cameraId] : []
  const next = nextShotSelection(current, `shot:${shotId}/camera`, additive)
  state.select({ cameraId: next[0] ?? null, multiCameraIds: next })
}

describe('镜头焦点会话', () => {
  it('没选中 → 没有焦点；点第 2 张卡 → 镜头 2 带实测；Ctrl 加选第 4 张 → 两镜按镜头条顺序', () => {
    expect(readDirectorShotFocus()).toBeNull()
    clickCard('close')
    const one = readDirectorShotFocus()
    expect(one?.shots.map((shot) => [shot.shotId, shot.index])).toEqual([['close', 2]])
    expect(one?.shots[0].measured?.cameraId).toBe('shot:close/camera')
    clickCard('end', true)
    clickCard('wide', true)
    expect(readDirectorShotFocus()?.shots.map((shot) => shot.index)).toEqual([1, 2, 4])
    clickCard('close', true)
    expect(readDirectorShotFocus()?.shots.map((shot) => shot.index)).toEqual([1, 4])
    clickCard('react')
    expect(readDirectorShotFocus()?.shots.map((shot) => shot.index)).toEqual([3])
  })

  it('播放头每帧变：读口返回同一个对象（输入框标签不跟着重渲）；订阅者会被叫到', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeDirectorShotFocus(listener)
    clickCard('close')
    expect(listener).toHaveBeenCalled()
    const first = readDirectorShotFocus()
    store.getState().setTimelineContext({ currentTime: 4.2 })
    store.getState().setTimelineContext({ currentTime: 4.3 })
    expect(readDirectorShotFocus()).toBe(first)
    unsubscribe()
  })

  it('× 清的是编辑器的选中（唯一 owner）', () => {
    clickCard('close')
    createEditorShotFocusSession(nodeId, store).clearShotFocus()
    expect(store.getState().selection.cameraId).toBeNull()
    expect(readDirectorShotFocus()).toBeNull()
  })

  it('Agent 改完计划（外部写口重载工程）：选中与播放头还在，标签还在', () => {
    clickCard('close')
    store.getState().setTimelineContext({ currentTime: 3 })
    const raw = useGenerationCanvasStore.getState().nodes.find((node) => node.id === nodeId)?.meta?.[DIRECTOR_PROJECT_META_KEY]
    expect(writeExternalDirectorProject(nodeId, JSON.parse(JSON.stringify(raw)))).toBe(true)
    expect(store.getState().selection.cameraId).toBe('shot:close/camera')
    expect(store.getState().timeline.currentTime).toBe(3)
    expect(readDirectorShotFocus()?.shots.map((shot) => shot.index)).toEqual([2])
  })
})
