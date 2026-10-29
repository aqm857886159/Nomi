/**
 * [INPUT]: 依赖 react、react-i18next、../../../../design 的 confirmDialog / TooltipProvider、
 *          ../../../generation/pageLayerContext 的 useGenerationPageLayerActive（这一格此刻看不看得见）、
 *          ./model/directorStore 的 createDirectorStore、./DirectorEditorContext、
 *          ./scene/ViewportApiContext、
 *          ./scene/viewSettings（偏好读写）、./useDirectorHotkeys、./useMobileCamera、./MobileCameraContext、
 *          ./panels/dialogs/{MobileConnectDialog, SettingsDialog, HelpDialog}、./model/directorTypes、./DirectorViewShell、./DirectorRefineShell、./directorSessionRegistry、./directorEditorPersistence（写回规矩的唯一 owner）
 *          ./model/cameraCoordinateSpace / sceneObjectGraph 的当前世界视角转图层局部位姿、创建模式取消登记
 * [OUTPUT]: 对外提供 DirectorEditor（default）：导演台页面根 —— 精修（DirectorRefineShell：顶栏 / 满宽视口 / 选中才出的属性卡 / 时间轴）+ 退出确认 + 写回接线（规矩住 directorEditorPersistence）+
 *           占画布区的导演视图外壳（默认；2026-10-16 起唯一的导演台，开关与旧导演台已删），镜头条只读且沿用实测模块；编辑器会话登记为外部 AI 写入入口
 *           区域感知快捷键 + 手机虚拟相机桥 + 本机偏好（漫游 / 灵敏度 / 视口主题）与设置 / 帮助对话框
 * [POS]: director 的页面根：创建并注入 store 与视口 API，负责「打开/关闭/写回」生命周期与区域布局（方案 §4.0 O1–O5）。
 *        2026-10-29 起它是**生成页里的一块**（DirectorNode 经 GenerationPageLayer 把它挂进画布那一格），根 `size-full` 铺满所在容器：
 *        版面（右边让不让停靠栏、顶栏 / 左栏在哪）归 GenerationWorkspace 的网格，这里不读 Agent 形态也不算偏移；
 *        藏着（切走生成页 / 列表视图，useGenerationPageLayerActive 为假）时：Esc 监听摘掉（不吞别的页的 Esc）、暗色锁释放、录制中的运镜放弃，
 *        快捷键 / 视口漫游 / 3D 渲染循环在各自的家里跟着停。窗口栏 / 顶栏不再靠顶偏移让开——页格本来就在顶栏之下
 *        （Windows 那条 32px 拖拽带的场景见 docs/fixes/2026-09-04-fullscreen-overlay-windows-windowbar.root-cause.json，仍由构造保证）。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import React, { type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { TooltipProvider, confirmDialog } from '../../../../design'
import { toast } from '../../../../ui/toast'
import { useGenerationPageLayerActive } from '../../../generation/pageLayerContext'
import { NomiColorSchemeContext } from '../../../../theme/colorScheme'
import { CameraRecorderContext } from './CameraRecorderContext'
import { DirectorStoreContext, useDirectorStore, useDirectorStoreApi } from './DirectorEditorContext'
import { MobileCameraContext } from './MobileCameraContext'
import { useCameraMotionRecorder } from './useCameraMotionRecorder'
import { useMobileCamera } from './useMobileCamera'
import { ualMigrationNoteOf } from './model/directorProject'
import { createDirectorStore, type DirectorStore } from './model/directorStore'
import type { DirectorProject, DirectorLinkedAsset } from './model/directorTypes'
import type { DirectorHotkeyScope } from './model/hotkeys'
import { OutputsContext, type DirectorOutput } from './OutputsContext'
import { EMPTY_LINKED_ASSETS, LinkedAssetsContext } from './panels/LinkedAssetsContext'
import { useDirectorOutputs } from './useDirectorOutputs'
import { HelpDialog } from './panels/dialogs/HelpDialog'
import { MobileConnectDialog } from './panels/dialogs/MobileConnectDialog'
import { SettingsDialog } from './panels/dialogs/SettingsDialog'
import { CreationModeContext } from './panels/CreationModeContext'
import { useBoxDraw } from './scene/creation/useBoxDraw'
import { useCharacterPlacement } from './scene/creation/useCharacterPlacement'
import { readDirectorPreferences, writeDirectorPreferences, type DirectorPreferences } from './scene/viewSettings'
import { ViewportApiContext, type ViewportApi } from './scene/ViewportApiContext'
import { isTextTarget, useDirectorHotkeys } from './useDirectorHotkeys'
import { transformCameraPose } from './model/cameraCoordinateSpace'
import { invertFrame, sceneFrame } from './model/sceneObjectGraph'
import { orderedTimelineEntities } from './model/timelineTracks'
import { registerDirectorSession } from './directorSessionRegistry'
import { createDirectorEditorPersistence, type DirectorEditorPersistence } from './directorEditorPersistence'
import { prepareProduceFromPreview } from './agent/directorProduce'
import { readDirectorPreview } from './model/directorPreviewState'
import type { ProduceControl } from './panels/topbar/ProduceButton'
import { useGenerationCanvasStore } from '../../store/generationCanvasStore'
import { viewNodeInCanvas } from '../../../generation/list/generationListSource'
import { createEditorShotFocusSession } from './directorShotFocusSession'
import { DirectorViewShell, type DirectorViewMode } from './DirectorViewShell'
import { DirectorRefineShell } from './DirectorRefineShell'

export type DirectorEditorProps = {
  rawProject: unknown
  nodeTitle: string
  readOnly?: boolean
  // 画布连线带进来的全景 / 泼溅 / 模型引用（资产库「连线引用」目录），随连线增减，不入工程
  linkedAssets?: readonly DirectorLinkedAsset[]
  // 所属画布节点 id（产物落盘的 owner）与「发送到画布」回调；开发入口都没有 → 发送按钮禁用
  nodeId?: string
  onSendToCanvas?: (output: DirectorOutput) => void
  onClose: () => void
  onProjectChange: (project: DirectorProject) => void
}

const TIMELINE_COLLAPSED_KEY = 'nomi:director:timelineCollapsed'

function readTimelineCollapsed(): boolean {
  try {
    return localStorage.getItem(TIMELINE_COLLAPSED_KEY) === '1'
  } catch {
    return false
  }
}

type EditorBodyProps = {
  nodeTitle: string
  scopeRef: React.MutableRefObject<DirectorHotkeyScope>
  onExit: () => void
  preferences: DirectorPreferences
  onChangePreferences: (next: DirectorPreferences) => void
  nodeId?: string
  onSendToCanvas?: (output: DirectorOutput) => void
  onExternalProjectChange?: (project: DirectorProject) => void
  produce: ProduceControl
}

type EditorStageProps = {
  nodeTitle: string
  scopeRef: React.MutableRefObject<DirectorHotkeyScope>
  preferences: DirectorPreferences
  cancelCreationRef: React.MutableRefObject<(() => void) | null>
  timelineCollapsed: boolean
  onToggleTimeline: () => void
  onResetView: () => void
  onExit: () => void
  onOpenSettings: () => void
  onOpenHelp: () => void
  viewMode: DirectorViewMode
  onViewModeChange: (mode: DirectorViewMode) => void
  produce: ProduceControl
}

/**
 * 区域装配层。必须是 EditorBody 之下的独立组件：两个创建模式 hook 要读 ViewportApiContext，
 * 而那个 Provider 是 EditorBody 渲染的 —— 在 EditorBody 自己的函数体里调，拿到的是 provider 之外的空值，
 * useViewportApi() 当场抛错、整块懒加载壳落到「加载失败」（2026-09-09 真机走查抓到）。
 */
function EditorStage({ nodeTitle, scopeRef, preferences, cancelCreationRef, timelineCollapsed, onToggleTimeline, onResetView, onExit, onOpenSettings, onOpenHelp, viewMode, onViewModeChange, produce }: EditorStageProps): JSX.Element {
  const { t } = useTranslation()
  // 创建模式只调一次 hook，经 CreationModeContext 下发：视口要指针路由与 ghost ref，顶栏「＋添加」要能发起。
  // 两处各调一次 = 两份互不知情的模式状态（P1 的并行版）。
  const placement = useCharacterPlacement({
    characterName: (index) => t('director.creation.characterName', { index }),
    crowdNames: { group: t('director.creation.crowdGroupName'), member: t('director.creation.crowdMemberName') },
  })
  const boxDraw = useBoxDraw({ boxName: (index) => t('director.creation.boxName', { index }) })
  const creationMode = React.useMemo(() => ({ placement, boxDraw }), [placement, boxDraw])
  // 时间轴上一个实体都没有时把它钉成一条：比例记忆不动，加了轨道立刻回到用户自己的分栏
  const timelineEmpty = useDirectorStore((state) => orderedTimelineEntities(state.activeScene()).length === 0)
  if (viewMode === 'director') {
    return <DirectorViewShell
      nodeTitle={nodeTitle}
      scopeRef={scopeRef}
      placement={placement}
      boxDraw={boxDraw}
      cancelCreationRef={cancelCreationRef}
      theme={preferences.theme}
      viewSettings={preferences.view}
      onExit={onExit}
      onViewModeChange={onViewModeChange}
      produce={produce}
    />
  }
  // 精修 = 「选中才出」（2026-10-04 用户拍板方向 A）
  return (
    <CreationModeContext.Provider value={creationMode}>
      <DirectorRefineShell
        scopeRef={scopeRef}
        placement={placement}
        boxDraw={boxDraw}
        cancelCreationRef={cancelCreationRef}
        theme={preferences.theme}
        viewSettings={preferences.view}
        timelineCollapsed={timelineCollapsed}
        timelineEmpty={timelineEmpty}
        onToggleTimeline={onToggleTimeline}
        onResetView={onResetView}
        onExit={onExit}
        onOpenSettings={onOpenSettings}
        onOpenHelp={onOpenHelp}
        viewMode={{ value: viewMode, onChange: onViewModeChange }}
      />
    </CreationModeContext.Provider>
  )
}

function EditorBody({ nodeTitle, scopeRef, onExit, preferences, onChangePreferences, nodeId, onSendToCanvas, onExternalProjectChange, produce }: EditorBodyProps): JSX.Element {
  const apiRef = React.useRef<ViewportApi | null>(null)
  const cancelCreationRef = React.useRef<(() => void) | null>(null)
  const store = useDirectorStoreApi()
  const { t } = useTranslation()
  const recorder = useCameraMotionRecorder({ apiRef, notify: (key, params) => toast(t(key as 'director.camera.recordDone', params), 'info') })
  // 切走（生成页被藏 / 列表视图）就放弃本次录制，和 Esc 同语义：采样循环是 DOM 侧 rAF，不看页面藏没藏，放着不管会在后台把时间轴一路录下去。
  const layerActive = useGenerationPageLayerActive()
  const { active: recording, cancel: cancelRecording } = recorder
  React.useEffect(() => {
    if (!layerActive && recording) cancelRecording()
  }, [layerActive, recording, cancelRecording])
  const mobile = useMobileCamera({ recorder, apiRef })
  const outputs = useDirectorOutputs({ apiRef, ownerNodeId: nodeId, onSendToCanvas })
  const [settingsOpen, setSettingsOpen] = React.useState(false)
  const [helpOpen, setHelpOpen] = React.useState(false)
  const [viewMode, setViewMode] = React.useState<DirectorViewMode>('director')
  const [timelineCollapsed, setTimelineCollapsed] = React.useState(readTimelineCollapsed)
  const toggleTimeline = React.useCallback(() => {
    setTimelineCollapsed((collapsed) => {
      try {
        localStorage.setItem(TIMELINE_COLLAPSED_KEY, collapsed ? '0' : '1')
      } catch {
        // 无本地存储时静默：折叠只是本机便利偏好
      }
      return !collapsed
    })
  }, [])

  React.useEffect(() => registerDirectorSession(nodeId, {
    store,
    defaultSceneName: t('director.node.sceneDefaultName'),
    onExternalProjectChange,
    // 3D-BOX：「正在改：镜头 N」的读口（Agent 发送时带上；输入框上的标签订阅它）
    ...(nodeId ? createEditorShotFocusSession(nodeId, store) : {}),
  }), [nodeId, onExternalProjectChange, store, t])

  useDirectorHotkeys({
    scopeRef,
    handlers: {
      resetCamera: () => apiRef.current?.resetView(),
      // Shift+A：自由视角固化成新机位（清单 §6 C3）
      captureCamera: () => {
        const pose = apiRef.current?.getViewPose()
        const state = store.getState()
        if (!pose) return
        // 机位视角里固化 = 在同一位置再造一台机位（模型会糊在眼前），只在自由视角允许
        if (state.activeCameraId !== 'free') {
          toast(t('director.camera.captureNeedsFree'), 'warning')
          return
        }
        const name = t('director.creation.cameraName', { index: state.activeScene().cameras.length + 1 })
        state.captureCurrentView(transformCameraPose(pose, invertFrame(sceneFrame(state.activeScene().sceneConfig))), name)
        toast(t('director.camera.captured', { name }), 'success')
      },
      recordMotion: () => (recorder.active ? recorder.stop() : recorder.start()),
      screenshot: () => {
        void outputs.takeScreenshot()
      },
      focusEntity: () => {
        const { selection } = store.getState()
        const entityId = selection.objectId ?? selection.cameraId ?? selection.lightId
        if (entityId) apiRef.current?.focusEntity(entityId)
      },
      select: undefined,
    },
  })

  return (
    <ViewportApiContext.Provider value={apiRef}>
    <OutputsContext.Provider value={outputs}>
      <CameraRecorderContext.Provider value={recorder}>
      <MobileCameraContext.Provider value={mobile}>
      {/* 精修布局（顶栏 / 视口 / 属性卡 / 时间轴）在 DirectorRefineShell，导演视图在 DirectorViewShell；这里只管装配与生命周期 */}
      <EditorStage
        nodeTitle={nodeTitle}
        scopeRef={scopeRef}
        preferences={preferences}
        cancelCreationRef={cancelCreationRef}
        timelineCollapsed={timelineCollapsed}
        onToggleTimeline={toggleTimeline}
        onResetView={() => apiRef.current?.resetView()}
        onExit={onExit}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenHelp={() => setHelpOpen(true)}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        produce={produce}
      />
      <MobileConnectDialog />
      <SettingsDialog
        open={settingsOpen}
        preferences={preferences}
        onChange={onChangePreferences}
        onClose={() => setSettingsOpen(false)}
        onOpenHelp={() => {
          setSettingsOpen(false)
          setHelpOpen(true)
        }}
      />
      <HelpDialog open={helpOpen} onClose={() => setHelpOpen(false)} />
      </MobileCameraContext.Provider>
      </CameraRecorderContext.Provider>
    </OutputsContext.Provider>
    </ViewportApiContext.Provider>
  )
}

/**
 * 导演台永远是暗的（2026-09-09 用户拍板：这个面默认深色）。和剪辑 / 调色台同理 —— 判断画面明暗的地方
 * 不能让外壳底色跟着白天变。经 provider 的暗色锁声明，不自己写 DOM：那样会被「天黑自动暗」的定时器改回去。
 * 锁是整个 App 的：导演台藏着（切去创作 / 预览页）时必须释放，否则别的页跟着变暗；回到生成页再按下。
 */
function useDirectorForcedDark(active: boolean): void {
  const scheme = React.useContext(NomiColorSchemeContext)
  const acquire = scheme?.acquireForcedDark
  React.useEffect(() => {
    if (!acquire || !active) return
    return acquire()
  }, [acquire, active])
}

export default function DirectorEditor({ rawProject, nodeTitle, readOnly = false, linkedAssets = EMPTY_LINKED_ASSETS, nodeId, onSendToCanvas, onClose, onProjectChange }: DirectorEditorProps): JSX.Element {
  const { t } = useTranslation()
  const layerActive = useGenerationPageLayerActive()
  useDirectorForcedDark(layerActive)
  const storeRef = React.useRef<DirectorStore | null>(null)
  if (!storeRef.current) {
    storeRef.current = createDirectorStore({ rawProject, defaultSceneName: t('director.node.sceneDefaultName') })
  }
  const store = storeRef.current
  const onProjectChangeRef = React.useRef(onProjectChange)
  onProjectChangeRef.current = onProjectChange
  // 写回规矩（一个写者、外部改动重载、空闲自动保存、撤销前落盘）只有 directorEditorPersistence 一个家，不看界面模式（导演 / 精修）。
  // 打开看一眼不写（读时迁移的结果不写回去——旧人偶工程改了才落盘）。
  const persistenceRef = React.useRef<DirectorEditorPersistence | null>(null)
  if (!persistenceRef.current) persistenceRef.current = createDirectorEditorPersistence({ store, defaultSceneName: t('director.node.sceneDefaultName'), initialRaw: rawProject, write: (project) => onProjectChangeRef.current(project) })
  const persistence = persistenceRef.current
  // 读档时把旧人偶迁成了 UAL 且有动作 / 手调骨骼没法原样保留：打开时说一次（不写进工程）
  const migrationToastShownRef = React.useRef(false)
  React.useEffect(() => {
    if (migrationToastShownRef.current) return
    migrationToastShownRef.current = true
    const note = ualMigrationNoteOf(store.getState().project)
    if (note && note.approximatedActions + note.droppedBoneKeys > 0) toast(t('director.editor.ualMigrated', { actions: note.approximatedActions, bones: note.droppedBoneKeys }), 'info')
  }, [store, t])
  // 节点上的工程被外部换掉（Agent 撤销 / 画布 ⌘Z）→ 编辑器当场重载；自己写出去的那份回来不算
  React.useEffect(() => {
    if (!readOnly) persistence.adoptNodeProject(rawProject)
  }, [persistence, rawProject, readOnly])
  // 空闲自动保存 + 提议事务 / 撤销前先落盘
  React.useEffect(() => (readOnly ? undefined : persistence.start()), [persistence, readOnly])
  const scopeRef = React.useRef<DirectorHotkeyScope>('viewport')
  // 偏好（漫游 / 灵敏度 / 视口主题）只存本机：改一次立刻生效并落 localStorage，不入工程不进撤销栈
  const [preferences, setPreferences] = React.useState<DirectorPreferences>(readDirectorPreferences)
  const changePreferences = React.useCallback((next: DirectorPreferences) => {
    setPreferences(next)
    writeDirectorPreferences(next)
  }, [])

  // 「出成片」（设计卡 docs/plan/2026-10-16-director-3dbox-produce-design-card.md，选项 A）：只做准备，不花钱——
  // 先把没落盘的手改落盘（预演过期判据与重渲都读节点上的工程），预演最新就挂到视频镜头、回画布选中它；
  // 过期 / 没出过 → 请求重渲并记下「在等」，预演好了自动接着做；用户点节点 ↑ 才花钱。
  const [producePending, setProducePending] = React.useState(false)
  const produce = React.useCallback(() => {
    if (readOnly || !nodeId) return
    persistence.saveNow()
    const outcome = prepareProduceFromPreview(nodeId, store.getState().exportProject())
    if (outcome.kind === 'rendering') {
      setProducePending(true)
      return
    }
    setProducePending(false)
    if (outcome.kind === 'blocked') return
    if (outcome.toast) toast(outcome.toast.message, outcome.toast.level)
    onClose()
    viewNodeInCanvas(outcome.videoNodeId)
  }, [nodeId, onClose, persistence, readOnly, store])
  const previewStatus = useGenerationCanvasStore((state) => (nodeId ? readDirectorPreview(state.nodes.find((node) => node.id === nodeId))?.status : undefined))
  React.useEffect(() => {
    if (!producePending) return
    if (previewStatus === 'ready') produce()
    else if (previewStatus === 'failed') setProducePending(false)
  }, [previewStatus, produce, producePending])
  const produceControl = React.useMemo<ProduceControl>(() => ({ nodeId, readOnly, pending: producePending, onProduce: produce }), [nodeId, produce, producePending, readOnly])

  const handleExit = React.useCallback(async () => {
    const ok = await confirmDialog({
      title: t('director.editor.exitConfirmTitle'),
      message: t('director.editor.exitConfirmMessage'),
      confirmLabel: t('director.editor.exitConfirmOk'),
    })
    if (!ok) return
    if (!readOnly) persistence.saveNow()
    onClose()
  }, [onClose, persistence, readOnly, t])

  // Esc 归属（O5）：浮层/模式先吃；再清工具 + 选择；再退 POV；都没有 → 退出确认
  // 藏着（切去别的页 / 列表视图）时整条监听摘掉：它在 window 捕获期、会 stopPropagation，留着就吞掉那一页的 Esc。
  React.useEffect(() => {
    if (!layerActive) return undefined
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (isTextTarget(event.target)) return
      if (document.querySelector('[data-nomi-escape-layer]')) return
      // 创建模式 effect 按需挂载，可能晚于壳监听；先让位，避免一次 Esc 同时清掉选择。
      if (document.querySelector('[data-nomi-director-creation-mode]')) return
      event.preventDefault()
      event.stopPropagation()
      const state = store.getState()
      // 录制中 Esc = 放弃本次录制
      if (state.recording) {
        state.cancelRecording()
        return
      }
      // 模式已由视口先吃；否则清工具（transformMode = null，gizmo 全部 detach）+ 清全部选中
      const hasSelection = Boolean(state.selection.objectId || state.selection.cameraId || state.selection.lightId || state.selection.multiObjectIds.length || state.selection.clipId || state.selection.boneKey || state.selection.ikTarget)
      if (state.transformMode !== null || hasSelection) {
        state.setTransformMode(null)
        state.clearSelection()
        return
      }
      // 再按：机位视角里退回自由视角；都没有 → 退出确认（这两步是壳自己的归属）
      if (state.activeCameraId !== 'free') {
        state.exitCameraPOV()
        return
      }
      void handleExit()
    }
    // 捕获期：壳根节点 onKeyDown 会 stopPropagation（隔离画布快捷键），冒泡到 window 的监听在壳内按键时永远收不到
    window.addEventListener('keydown', onKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true })
  }, [handleExit, layerActive, store])

  return (
    <LinkedAssetsContext.Provider value={linkedAssets}>
    <DirectorStoreContext.Provider value={store}>
      <TooltipProvider>
        <div
          className="isolate flex size-full flex-col overflow-hidden bg-nomi-bg text-nomi-ink font-nomi-sans"
          role="region"
          aria-label={nodeTitle ? `${t('director.editor.aria')} · ${nodeTitle}` : t('director.editor.aria')}
          tabIndex={0}
          data-testid="director-editor"
          onKeyDown={(event) => event.stopPropagation()}
          onKeyUp={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
          onWheel={(event) => event.stopPropagation()}
        >
          <EditorBody
            nodeTitle={nodeTitle}
            scopeRef={scopeRef}
            onExit={() => void handleExit()}
            preferences={preferences}
            onChangePreferences={changePreferences}
            nodeId={nodeId}
            onSendToCanvas={onSendToCanvas}
            onExternalProjectChange={persistence.persist}
            produce={produceControl}
          />
        </div>
      </TooltipProvider>
    </DirectorStoreContext.Provider>
    </LinkedAssetsContext.Provider>
  )
}
