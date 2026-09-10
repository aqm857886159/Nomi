/**
 * [INPUT]: 依赖 immer 的 produce（commitProject 草稿写入）、zustand/vanilla 的 createStore、./directorTypes、./directorProject（默认工程/克隆/归一）、
 *          ./timeGrid（sceneContentEndSeconds / ensureDurationSeconds / DIRECTOR_MAX_DURATION_SECONDS）、./storeEntityActions、./storeClipActions
 * [OUTPUT]: 对外提供 DirectorStore / DirectorStoreState / DirectorSelection / TimelineEditContext、createDirectorStore、
 *           HISTORY_LIMIT
 * [POS]: director/model 的编辑器真相源：每次打开导演台创建一个 vanilla store（React 用 useStore 订阅，渲染循环直接
 *        getState），关闭时 exportProject 写回节点 meta。撤销 = 整树快照 50 步（滚轮/拖拽 200ms 合并）；选择态、
 *        时间轴上下文、面板显隐是瞬态不进工程。实体/片段的具体 action 拆在 storeEntityActions / storeClipActions。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { produce } from 'immer'
import { createStore, type StoreApi } from 'zustand/vanilla'
import { cloneDirectorProject, createDefaultProject, normalizeDirectorProject, remapSceneIds } from './directorProject'
import type {
  DirectorCamera,
  DirectorExportRatio,
  DirectorExportResolution,
  DirectorLight,
  DirectorObject,
  DirectorProject,
  DirectorScene,
} from './directorTypes'
import { createCameraActions, type DirectorCameraActions, type RecordingSession } from './storeCameraActions'
import { createCharacterActions, type DirectorCharacterActions } from './storeCharacterActions'
import { createAssetActions, type DirectorAssetActions } from './storeAssetActions'
import { createOutputActions, type DirectorOutputActions, type VideoRecordingProgress } from './storeOutputActions'
import { createAiSceneActions, type DirectorAiSceneActions } from './storeAiSceneActions'
import { createClipActions, type DirectorClipActions } from './storeClipActions'
import { createEntityActions, type DirectorEntityActions } from './storeEntityActions'
import { createTimelineActions, type DirectorTimelineActions } from './storeTimelineActions'
import type { ClipboardPayload } from './timelineClipboard'
import { DIRECTOR_MAX_DURATION_SECONDS, ensureDurationSeconds, sceneContentEndSeconds } from './timeGrid'

export const HISTORY_LIMIT = 50
const WHEEL_MERGE_MS = 200

export type SelectedClipType = 'trajectory' | 'action' | 'closeup' | 'lookat' | null
export type TransformMode = 'translate' | 'rotate' | 'scale' | null
// 视口画路径工具（顶栏 4 / 5）：与 gizmo 工具互斥，setTransformMode 会清掉它
export type DrawMode = 'pencil' | 'waypoint' | null

export type DirectorSelection = {
  objectId: string | null
  cameraId: string | null
  lightId: string | null
  multiObjectIds: string[]
  activeWaypointId: string | null
  selectedWaypointIds: string[]
  clipId: string | null
  clipType: SelectedClipType
  boneKey: string | null
  ikTarget: string | null
  boneKeyframeId: string | null
  boneClipId: string | null
}

export type TimelineEditContext = {
  currentTime: number
  autoKey: boolean
  totalDuration: number
  isPlaying: boolean
}

export type EvaluatedPose = { position: { x: number; y: number; z: number }; rotation: { x: number; y: number; z: number }; fov?: number; lookAtCoords?: { x: number; y: number; z: number } }

type HistoryEntry = { project: DirectorProject }

export type DirectorStoreState = {
  project: DirectorProject
  selection: DirectorSelection
  activeCameraId: string // 'free' 或机位 id（主视口视角）
  previewCameraId: string // 画中画目标机位
  transformMode: TransformMode
  drawMode: DrawMode
  clipboard: ClipboardPayload | null
  playbackRate: number
  snapEnabled: boolean
  // 录制运镜会话（瞬态）：录制中的机位由视口相机驱动，求值循环跳过它
  recording: RecordingSession | null
  timeline: TimelineEditContext
  isTimelineDragging: boolean
  isKeyframeTimeDragging: boolean
  ikModeEnabled: boolean
  isSkeletonEditing: boolean
  // 泼溅 / 全景显现中的黑幕计数（>0 时天空盖黑），瞬态不入工程
  revealBackdropCount: number
  // 当前全景贴图的真实像素尺寸（由 PanoramaSphere 载入贴图时量出），瞬态不入工程；
  // 检查器据它常驻显示「非 2:1 可能拉伸」，提示与全景本身同生共死，不做一次性通知
  panoramaDimensions: { width: number; height: number } | null
  // MP4 录制进度（null = 没在录），瞬态不入工程
  videoRecording: VideoRecordingProgress | null
  evaluatedPoses: Record<string, EvaluatedPose>
  // 每个实体当前「正在编辑」的路径片段（画笔/逐点/录制都往它里面写）
  activeTrajectoryClipIds: Record<string, string>
  pendingSeek: number | null
  undoStack: HistoryEntry[]
  redoStack: HistoryEntry[]
  showLeftPanel: boolean
  showRightPanel: boolean
  showCameraPreview: boolean
  // ── 派生读取 ──
  activeScene: () => DirectorScene
  contentEndSeconds: () => number
  findObject: (id: string | null | undefined) => DirectorObject | undefined
  findCamera: (id: string | null | undefined) => DirectorCamera | undefined
  findLight: (id: string | null | undefined) => DirectorLight | undefined
  // ── 历史 ──
  saveState: () => void
  saveStateForWheel: () => void
  withHistory: <T>(action: () => T) => T
  undo: () => void
  redo: () => void
  // ── 工程 ──
  loadProject: (raw: unknown, defaultSceneName: string) => void
  resetSession: (defaultSceneName: string) => void
  exportProject: () => DirectorProject
  setExportRatio: (ratio: DirectorExportRatio) => void
  setExportResolution: (resolution: DirectorExportResolution) => void
  patchSceneConfig: (patch: Partial<DirectorScene['sceneConfig']>) => void
  patchPanoramaConfig: (patch: Partial<DirectorScene['panoramaConfig']>) => void
  // ── 图层 ──
  createSceneLayer: (name: string) => string
  duplicateSceneLayer: (sceneId: string, suffix: string) => string
  deleteSceneLayer: (sceneId: string) => boolean
  renameSceneLayer: (sceneId: string, name: string) => void
  setActiveScene: (sceneId: string) => void
  toggleSceneVisible: (sceneId: string) => void
  // ── 选择与视角 ──
  select: (patch: Partial<DirectorSelection>) => void
  clearSelection: () => void
  setActiveCamera: (cameraId: string) => void
  setPreviewCamera: (cameraId: string) => void
  setTransformMode: (mode: TransformMode) => void
  setPlaybackRate: (rate: number) => void
  setSnapEnabled: (enabled: boolean) => void
  setPanelVisibility: (patch: Partial<Pick<DirectorStoreState, 'showLeftPanel' | 'showRightPanel' | 'showCameraPreview'>>) => void
  setIkModeEnabled: (enabled: boolean) => void
  setSkeletonEditing: (editing: boolean) => void
  beginRevealBackdrop: () => void
  endRevealBackdrop: () => void
  setPanoramaDimensions: (dimensions: { width: number; height: number } | null) => void
  // ── 时间轴上下文 ──
  setTimelineContext: (patch: Partial<TimelineEditContext>) => void
  ensureDuration: (seconds: number, margin?: number) => void
  requestSeek: (seconds: number) => void
  consumeSeek: () => number | null
  setTimelineDragging: (dragging: boolean) => void
  setKeyframeTimeDragging: (dragging: boolean) => void
  setEvaluatedPose: (entityId: string, pose: EvaluatedPose | null) => void
  getEvaluatedPose: (entityId: string) => EvaluatedPose | null
  // ── 轨道顺序/钉住/折叠 ──
  reorderTimelineTracks: (order: string[]) => void
  toggleTimelineTrackPin: (entityId: string) => void
  toggleTimelineTrackFold: (entityId: string) => void
} & DirectorEntityActions & DirectorClipActions & DirectorTimelineActions & DirectorCameraActions & DirectorCharacterActions & DirectorAssetActions & DirectorOutputActions & DirectorAiSceneActions

export type DirectorStore = StoreApi<DirectorStoreState>

export function emptySelection(): DirectorSelection {
  return {
    objectId: null,
    cameraId: null,
    lightId: null,
    multiObjectIds: [],
    activeWaypointId: null,
    selectedWaypointIds: [],
    clipId: null,
    clipType: null,
    boneKey: null,
    ikTarget: null,
    boneKeyframeId: null,
    boneClipId: null,
  }
}

function activeSceneOf(project: DirectorProject): DirectorScene {
  return project.scenes.find((scene) => scene.id === project.activeSceneId) ?? project.scenes[0]
}

// 删实体/切图层后清掉悬空的选择态
function pruneSelection(selection: DirectorSelection, scene: DirectorScene): DirectorSelection {
  const objectIds = new Set(scene.objects.map((object) => object.id))
  const cameraIds = new Set(scene.cameras.map((camera) => camera.id))
  const lightIds = new Set(scene.lights.map((light) => light.id))
  const next: DirectorSelection = { ...selection }
  if (next.objectId && !objectIds.has(next.objectId)) {
    next.objectId = null
    next.boneKey = null
    next.ikTarget = null
  }
  if (next.cameraId && !cameraIds.has(next.cameraId)) next.cameraId = null
  if (next.lightId && !lightIds.has(next.lightId)) next.lightId = null
  next.multiObjectIds = next.multiObjectIds.filter((id) => objectIds.has(id))
  const object = scene.objects.find(item => item.id === next.objectId)
  const entity = object ?? scene.cameras.find(item => item.id === next.cameraId)
  const waypointIds = new Set((entity?.motionTrajectory ?? []).map(point => point.id))
  if (next.activeWaypointId && !waypointIds.has(next.activeWaypointId)) next.activeWaypointId = null
  next.selectedWaypointIds = next.selectedWaypointIds.filter((id) => waypointIds.has(id))
  const clips = next.clipType === 'trajectory' ? entity?.trajectoryClips
    : next.clipType === 'action' ? object?.actionClips
      : next.clipType === 'lookat' ? object?.lookAtClips
        : next.clipType === 'closeup' && entity && 'fov' in entity ? entity.closeupClips : undefined
  if (!next.clipId || !clips?.some(clip => clip.id === next.clipId)) {
    next.clipId = null
    next.clipType = null
  }
  const boneClip = object?.actionClips?.find(clip => clip.id === next.boneClipId)
  if (!next.boneKeyframeId || !boneClip?.keyframes?.some(frame => frame.id === next.boneKeyframeId)) {
    next.boneKeyframeId = null
    next.boneClipId = null
  }
  if (object?.type !== 'character') { next.boneKey = null; next.ikTarget = null }
  return next
}

export type CreateDirectorStoreOptions = {
  rawProject?: unknown
  defaultSceneName: string
  now?: () => number
}

export function createDirectorStore(options: CreateDirectorStoreOptions): DirectorStore {
  const now = options.now ?? (() => Date.now())
  let lastWheelSaveAt = -Infinity
  let historyDepth = 0

  return createStore<DirectorStoreState>()((set, get) => {
    const snapshot = (): HistoryEntry => ({ project: cloneDirectorProject(get().project) })

    // 所有项目数据的写入口。动作按「改草稿」写，immer 产出结构共享的新树：被改到的实体 / 数组 / 场景 /
    // 项目全部换新引用，没改到的保持原引用——订阅方（useStore 的 Object.is 比对、React.memo）据此判断
    // 该不该重渲染。2026-09-02 栽过：原地 push 后 scene / objects 引用不变，视口与大纲都不重渲染，
    // 只有 `.length` 这类原始值选择器动了。产物被 immer 冻结，任何绕过此入口的原地改写会直接抛错。
    const commitProject = (mutate: (project: DirectorProject, scene: DirectorScene) => void) => {
      set((state) => {
        const project = produce(state.project, (draft) => {
          mutate(draft, activeSceneOf(draft))
        })
        const scene = activeSceneOf(project)
        const timeline = { ...state.timeline }
        const contentEnd = sceneContentEndSeconds(scene)
        if (contentEnd > timeline.totalDuration) timeline.totalDuration = Math.min(DIRECTOR_MAX_DURATION_SECONDS, contentEnd)
        return {
          project,
          selection: pruneSelection(state.selection, scene),
          activeTrajectoryClipIds: Object.fromEntries(Object.entries(state.activeTrajectoryClipIds).filter(([id, clipId]) =>
            [...scene.objects, ...scene.cameras].find(entity => entity.id === id)?.trajectoryClips?.some(clip => clip.id === clipId))),
          evaluatedPoses: Object.fromEntries(Object.entries(state.evaluatedPoses).filter(([id]) => {
            const entity = [...scene.objects, ...scene.cameras].find(item => item.id === id)
            return entity && (entity.trajectoryClips?.length || ('fov' in entity && (entity.closeupClips?.length || entity.lookAtObjectId || entity.lookAtType === 'coordinates')))
          })),
          activeCameraId: state.activeCameraId !== 'free' && !scene.cameras.some((camera) => camera.id === state.activeCameraId) ? 'free' : state.activeCameraId,
          previewCameraId: scene.cameras.some((camera) => camera.id === state.previewCameraId) ? state.previewCameraId : scene.cameras[0]?.id ?? '',
          timeline,
        }
      })
    }

    const base: Omit<DirectorStoreState, keyof DirectorEntityActions | keyof DirectorClipActions | keyof DirectorTimelineActions | keyof DirectorCameraActions | keyof DirectorCharacterActions | keyof DirectorAssetActions | keyof DirectorOutputActions | keyof DirectorAiSceneActions> = {
      project: normalizeDirectorProject(options.rawProject, options.defaultSceneName),
      selection: emptySelection(),
      activeCameraId: 'free',
      previewCameraId: '',
      transformMode: 'translate',
      drawMode: null,
      clipboard: null,
      playbackRate: 1,
      snapEnabled: true,
      recording: null,
      timeline: { currentTime: 0, autoKey: false, totalDuration: DIRECTOR_MAX_DURATION_SECONDS, isPlaying: false },
      isTimelineDragging: false,
      isKeyframeTimeDragging: false,
      ikModeEnabled: true,
      isSkeletonEditing: false,
      revealBackdropCount: 0,
      panoramaDimensions: null,
      videoRecording: null,
      evaluatedPoses: {},
      activeTrajectoryClipIds: {},
      pendingSeek: null,
      undoStack: [],
      redoStack: [],
      showLeftPanel: true,
      showRightPanel: true,
      showCameraPreview: true,

      activeScene: () => activeSceneOf(get().project),
      contentEndSeconds: () => sceneContentEndSeconds(activeSceneOf(get().project)),
      findObject: (id) => (id ? activeSceneOf(get().project).objects.find((object) => object.id === id) : undefined),
      findCamera: (id) => (id ? activeSceneOf(get().project).cameras.find((camera) => camera.id === id) : undefined),
      findLight: (id) => (id ? activeSceneOf(get().project).lights.find((light) => light.id === id) : undefined),

      saveState: () => {
        if (historyDepth > 0) return
        const entry = snapshot()
        set((state) => {
          const last = state.undoStack[state.undoStack.length - 1]
          if (last && JSON.stringify(last.project) === JSON.stringify(entry.project)) return state
          const undoStack = [...state.undoStack, entry]
          if (undoStack.length > HISTORY_LIMIT) undoStack.shift()
          return { undoStack, redoStack: [] }
        })
      },
      saveStateForWheel: () => {
        const at = now()
        if (at - lastWheelSaveAt < WHEEL_MERGE_MS) {
          lastWheelSaveAt = at
          return
        }
        lastWheelSaveAt = at
        get().saveState()
      },
      withHistory: <T,>(action: () => T): T => {
        if (historyDepth > 0) return action()
        const before = get()
        historyDepth += 1
        try {
          const result = action()
          if (JSON.stringify(before.project) !== JSON.stringify(get().project)) {
            const last = before.undoStack[before.undoStack.length - 1]
            const stack = last && JSON.stringify(last.project) === JSON.stringify(before.project)
              ? before.undoStack : [...before.undoStack, { project: cloneDirectorProject(before.project) }]
            set({ undoStack: stack.slice(-HISTORY_LIMIT), redoStack: [] })
          }
          return result
        } catch (error) {
          set(before)
          throw error
        } finally {
          historyDepth -= 1
        }
      },
      undo: () => {
        const state = get()
        const entry = state.undoStack[state.undoStack.length - 1]
        if (!entry) return
        const current = snapshot()
        set({ undoStack: state.undoStack.slice(0, -1), redoStack: [...state.redoStack, current] })
        commitProject((project) => {
          Object.assign(project, entry.project)
        })
        set({ evaluatedPoses: {} })
      },
      redo: () => {
        const state = get()
        const entry = state.redoStack[state.redoStack.length - 1]
        if (!entry) return
        const current = snapshot()
        set({ redoStack: state.redoStack.slice(0, -1), undoStack: [...state.undoStack, current] })
        commitProject((project) => {
          Object.assign(project, entry.project)
        })
        set({ evaluatedPoses: {} })
      },

      loadProject: (raw, defaultSceneName) => {
        const project = normalizeDirectorProject(raw, defaultSceneName)
        const scene = activeSceneOf(project)
        set({
          project,
          selection: emptySelection(),
          activeCameraId: 'free',
          previewCameraId: scene.cameras[0]?.id ?? '',
          evaluatedPoses: {},
          activeTrajectoryClipIds: {},
          drawMode: null,
          clipboard: null,
          recording: null,
          videoRecording: null,
          pendingSeek: null,
          isTimelineDragging: false,
          isKeyframeTimeDragging: false,
          isSkeletonEditing: false,
          undoStack: [],
          redoStack: [],
          timeline: { currentTime: 0, autoKey: false, totalDuration: Math.max(sceneContentEndSeconds(scene), 1) > 1 ? Math.min(DIRECTOR_MAX_DURATION_SECONDS, Math.max(sceneContentEndSeconds(scene) + 2, 10)) : DIRECTOR_MAX_DURATION_SECONDS, isPlaying: false },
        })
      },
      resetSession: (defaultSceneName) => {
        get().loadProject(createDefaultProject(defaultSceneName), defaultSceneName)
        set({
          transformMode: 'translate',
          playbackRate: 1,
          snapEnabled: true,
          ikModeEnabled: true,
          revealBackdropCount: 0,
          panoramaDimensions: null,
          showLeftPanel: true,
          showRightPanel: true,
          showCameraPreview: true,
        })
      },
      exportProject: () => cloneDirectorProject(get().project),
      setExportRatio: (ratio) => get().withHistory(() => commitProject(project => { project.exportRatio = ratio })),
      setExportResolution: (resolution) => get().withHistory(() => commitProject(project => { project.exportResolution = resolution })),
      patchSceneConfig: (patch) => commitProject((_, scene) => Object.assign(scene.sceneConfig, patch)),
      patchPanoramaConfig: (patch) => commitProject((_, scene) => Object.assign(scene.panoramaConfig, patch)),

      createSceneLayer: (name) => {
        get().saveState()
        const scene = { ...createDefaultSceneFrom(get().project, name) }
        commitProject((project) => {
          project.scenes.push(scene)
          project.activeSceneId = scene.id
        })
        set({ selection: emptySelection(), activeCameraId: 'free', previewCameraId: '' })
        return scene.id
      },
      duplicateSceneLayer: (sceneId, suffix) => {
        const source = get().project.scenes.find((scene) => scene.id === sceneId)
        if (!source) return ''
        get().saveState()
        const copy = remapSceneIds(source, 'copy')
        copy.name = `${source.name}${suffix}`
        commitProject((project) => {
          const index = project.scenes.findIndex((scene) => scene.id === sceneId)
          project.scenes.splice(index + 1, 0, copy)
          project.activeSceneId = copy.id
        })
        set({ selection: emptySelection(), activeCameraId: 'free' })
        return copy.id
      },
      deleteSceneLayer: (sceneId) => {
        const project = get().project
        if (project.scenes.length <= 1) return false
        const index = project.scenes.findIndex((scene) => scene.id === sceneId)
        if (index === -1) return false
        get().saveState()
        commitProject((next) => {
          next.scenes.splice(index, 1)
          if (next.activeSceneId === sceneId) next.activeSceneId = next.scenes[Math.max(0, index - 1)].id
        })
        set({ selection: emptySelection(), activeCameraId: 'free' })
        return true
      },
      renameSceneLayer: (sceneId, name) => {
        if (!name.trim()) return
        get().saveState()
        commitProject((project) => {
          const scene = project.scenes.find((item) => item.id === sceneId)
          if (scene) scene.name = name.trim()
        })
      },
      setActiveScene: (sceneId) => {
        if (get().project.activeSceneId === sceneId) return
        if (!get().project.scenes.some((scene) => scene.id === sceneId)) return
        commitProject((project) => {
          project.activeSceneId = sceneId
        })
        set({ selection: emptySelection(), activeCameraId: 'free', evaluatedPoses: {} })
      },
      toggleSceneVisible: (sceneId) => {
        get().saveState()
        commitProject((project) => {
          const scene = project.scenes.find((item) => item.id === sceneId)
          if (scene) scene.visible = !scene.visible
        })
      },

      select: (patch) => set((state) => {
        const owner = patch.objectId ? 'objectId' : patch.cameraId ? 'cameraId' : patch.lightId ? 'lightId' : null
        const next = owner ? {
          ...patch,
          objectId: owner === 'objectId' ? patch.objectId! : null,
          cameraId: owner === 'cameraId' ? patch.cameraId! : null,
          lightId: owner === 'lightId' ? patch.lightId! : null,
          multiObjectIds: patch.multiObjectIds ?? (owner === 'objectId' ? state.selection.objectId === patch.objectId ? state.selection.multiObjectIds : [patch.objectId!] : []),
        } : patch
        const changedOwner = (['objectId', 'cameraId', 'lightId'] as const).some(key => key in next && next[key] !== state.selection[key])
        const cleared = changedOwner ? { clipId: null, clipType: null, activeWaypointId: null, selectedWaypointIds: [], boneKeyframeId: null, boneClipId: null, boneKey: null, ikTarget: null } : {}
        return { selection: pruneSelection({ ...state.selection, ...cleared, ...next }, activeSceneOf(state.project)) }
      }),
      clearSelection: () => set({ selection: emptySelection() }),
      setActiveCamera: (cameraId) => set({ activeCameraId: cameraId }),
      setPreviewCamera: (cameraId) => set({ previewCameraId: cameraId }),
      // 选了 gizmo 工具就退出画路径；置 null（选择工具 / 创建模式）不动 drawMode，画路径模式自己会把 gizmo 关掉
      setTransformMode: (mode) => set((state) => ({ transformMode: mode, drawMode: mode === null ? state.drawMode : null })),
      setPlaybackRate: (rate) => set({ playbackRate: Math.min(2, Math.max(0.25, rate)) }),
      setSnapEnabled: (enabled) => set({ snapEnabled: enabled }),
      setPanelVisibility: (patch) => set(patch),
      setIkModeEnabled: (enabled) => set({ ikModeEnabled: enabled }),
      setSkeletonEditing: (editing) => set({ isSkeletonEditing: editing }),
      beginRevealBackdrop: () => set((state) => ({ revealBackdropCount: state.revealBackdropCount + 1 })),
      endRevealBackdrop: () => set((state) => ({ revealBackdropCount: Math.max(0, state.revealBackdropCount - 1) })),
      setPanoramaDimensions: (panoramaDimensions) => set({ panoramaDimensions }),

      setTimelineContext: (patch) => set((state) => ({ timeline: { ...state.timeline, ...patch } })),
      ensureDuration: (seconds, margin) =>
        set((state) => ({ timeline: { ...state.timeline, totalDuration: ensureDurationSeconds(state.timeline.totalDuration, seconds, margin) } })),
      requestSeek: (seconds) => set({ pendingSeek: seconds }),
      consumeSeek: () => {
        const value = get().pendingSeek
        if (value !== null) set({ pendingSeek: null })
        return value
      },
      setTimelineDragging: (dragging) => set({ isTimelineDragging: dragging }),
      setKeyframeTimeDragging: (dragging) => set({ isKeyframeTimeDragging: dragging }),
      setEvaluatedPose: (entityId, pose) =>
        set((state) => {
          const evaluatedPoses = { ...state.evaluatedPoses }
          if (pose) evaluatedPoses[entityId] = pose
          else delete evaluatedPoses[entityId]
          return { evaluatedPoses }
        }),
      getEvaluatedPose: (entityId) => get().evaluatedPoses[entityId] ?? null,

      reorderTimelineTracks: (order) => get().withHistory(() => commitProject((_, scene) => {
        scene.timelineTrackOrder = [...order]
      })),
      toggleTimelineTrackPin: (entityId) => get().withHistory(() => commitProject((_, scene) => {
        scene.timelineTrackPins = scene.timelineTrackPins.includes(entityId)
          ? scene.timelineTrackPins.filter((id) => id !== entityId)
          : [...scene.timelineTrackPins, entityId]
      })),
      toggleTimelineTrackFold: (entityId) => get().withHistory(() => commitProject((_, scene) => {
        scene.timelineTrackFolds = scene.timelineTrackFolds.includes(entityId)
          ? scene.timelineTrackFolds.filter((id) => id !== entityId)
          : [...scene.timelineTrackFolds, entityId]
      })),
    }

    return {
      ...base,
      ...createEntityActions(set, get, commitProject),
      ...createClipActions(set, get, commitProject),
      ...createTimelineActions(set, get, commitProject),
      ...createCameraActions(set, get, commitProject),
      ...createCharacterActions(set, get, commitProject),
      ...createAssetActions(set, get, commitProject),
      ...createOutputActions(set, get, commitProject),
      ...createAiSceneActions(set, get, commitProject),
    }
  })
}

function createDefaultSceneFrom(project: DirectorProject, name: string): DirectorScene {
  const scene = createDefaultProject(name).scenes[0]
  // 沿用当前图层的显示模式/网格偏好，让新图层和现有视口一致
  const active = activeSceneOf(project)
  scene.sceneConfig.modelDisplayMode = active.sceneConfig.modelDisplayMode
  scene.sceneConfig.gridVisible = active.sceneConfig.gridVisible
  scene.sceneConfig.showCharacterLabels = active.sceneConfig.showCharacterLabels
  return scene
}

export type CommitProject = (mutate: (project: DirectorProject, scene: DirectorScene) => void) => void
export type StoreSet = StoreApi<DirectorStoreState>['setState']
export type StoreGet = StoreApi<DirectorStoreState>['getState']
