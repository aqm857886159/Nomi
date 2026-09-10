/**
 * [INPUT]: 依赖 react / react-dom 的 createPortal、react-i18next、../../../../design 的 confirmDialog / TooltipProvider、
 *          ../fullscreenZIndex 的 FULLSCREEN_Z_INDEX、../../../../ui/app-shell/windowChrome 的 currentFullscreenOverlayTopOffset、
 *          ./model/directorStore 的 createDirectorStore、./DirectorEditorContext、
 *          ./panels/EditorSplit、./panels/side/SidePanels、./panels/viewport/DirectorViewport、./timeline/DirectorTimeline、./scene/ViewportApiContext、
 *          ./scene/viewSettings（偏好读写）、./useDirectorHotkeys、./useMobileCamera、./MobileCameraContext、
 *          ./panels/dialogs/{MobileConnectDialog, SettingsDialog, HelpDialog}、./model/directorTypes
 *          ./model/cameraCoordinateSpace / sceneObjectGraph 的当前世界视角转图层局部位姿、创建模式取消登记
 * [OUTPUT]: 对外提供 DirectorEditor（default）：全屏壳 —— 顶栏 / 视口 / 时间轴（S2）/ 右栏 五区域 + 可拖分栏 + 退出确认 + 自动保存 +
 *           区域感知快捷键 + 手机虚拟相机桥 + 本机偏好（漫游 / 灵敏度 / 视口主题）与设置 / 帮助对话框
 * [POS]: director 的页面根：创建并注入 store 与视口 API，负责「打开/关闭/写回」生命周期与区域布局（方案 §4.0 O1–O5）。
 *        壳从 Windows 自绘窗口栏之下起画（不是 inset-0 铺满）：那条 32px 是系统拖拽带，盖住它顶部工具条
 *        整条点不动、窗口控件也埋在下面（2026-09-04，与 issue #58 同根，见 windowChrome）。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import React from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { TooltipProvider, confirmDialog } from '../../../../design'
import { FULLSCREEN_Z_INDEX } from '../fullscreenZIndex'
import { toast } from '../../../../ui/toast'
import { currentFullscreenOverlayTopOffset } from '../../../../ui/app-shell/windowChrome'
import { NomiColorSchemeContext } from '../../../../theme/colorScheme'
import { CameraRecorderContext } from './CameraRecorderContext'
import { DirectorStoreContext, useDirectorStore, useDirectorStoreApi } from './DirectorEditorContext'
import { MobileCameraContext } from './MobileCameraContext'
import { useCameraMotionRecorder } from './useCameraMotionRecorder'
import { useMobileCamera } from './useMobileCamera'
import { createDirectorStore, type DirectorStore } from './model/directorStore'
import type { DirectorProject, DirectorLinkedAsset } from './model/directorTypes'
import type { DirectorHotkeyScope } from './model/hotkeys'
import { EditorSplit } from './panels/EditorSplit'
import { OutputsContext, type DirectorOutput } from './OutputsContext'
import { CanvasImagesContext, EMPTY_CANVAS_IMAGES, type CanvasImage } from './panels/CanvasImagesContext'
import { EMPTY_LINKED_ASSETS, LinkedAssetsContext } from './panels/LinkedAssetsContext'
import { useDirectorOutputs } from './useDirectorOutputs'
import { HelpDialog } from './panels/dialogs/HelpDialog'
import { MobileConnectDialog } from './panels/dialogs/MobileConnectDialog'
import { SettingsDialog } from './panels/dialogs/SettingsDialog'
import { SidePanels } from './panels/side/SidePanels'
import { CreationModeContext } from './panels/CreationModeContext'
import { DirectorTopBar } from './panels/topbar/DirectorTopBar'
import { useBoxDraw } from './scene/creation/useBoxDraw'
import { useCharacterPlacement } from './scene/creation/useCharacterPlacement'
import { DirectorViewport } from './panels/viewport/DirectorViewport'
import { readDirectorPreferences, writeDirectorPreferences, type DirectorPreferences } from './scene/viewSettings'
import { DirectorTimeline, TIMELINE_COLLAPSED_PX, TIMELINE_EMPTY_PX } from './timeline/DirectorTimeline'
import { ViewportApiContext, type ViewportApi } from './scene/ViewportApiContext'
import { isTextTarget, useDirectorHotkeys } from './useDirectorHotkeys'
import { transformCameraPose } from './model/cameraCoordinateSpace'
import { invertFrame, sceneFrame } from './model/sceneObjectGraph'
import { orderedTimelineEntities } from './model/timelineTracks'

export type DirectorEditorProps = {
  rawProject: unknown
  nodeTitle: string
  readOnly?: boolean
  // 画布连线带进来的全景 / 泼溅 / 模型引用（资产库「连线引用」目录），随连线增减，不入工程
  linkedAssets?: readonly DirectorLinkedAsset[]
  // 画布上所有带结果图的 Image 节点（AI 搭场景的「从画布选」参考图），开发入口为空
  canvasImages?: readonly CanvasImage[]
  // 所属画布节点 id（产物落盘的 owner）与「发送到画布」回调；开发入口都没有 → 发送按钮禁用
  nodeId?: string
  onSendToCanvas?: (output: DirectorOutput) => void
  onClose: () => void
  onProjectChange: (project: DirectorProject) => void
}

const AUTOSAVE_IDLE_MS = 2000

const TIMELINE_COLLAPSED_KEY = 'nomi:director:timelineCollapsed'

function readTimelineCollapsed(): boolean {
  try {
    return localStorage.getItem(TIMELINE_COLLAPSED_KEY) === '1'
  } catch {
    return false
  }
}

type EditorBodyProps = {
  scopeRef: React.MutableRefObject<DirectorHotkeyScope>
  onExit: () => void
  preferences: DirectorPreferences
  onChangePreferences: (next: DirectorPreferences) => void
  nodeId?: string
  onSendToCanvas?: (output: DirectorOutput) => void
}

type EditorStageProps = {
  scopeRef: React.MutableRefObject<DirectorHotkeyScope>
  preferences: DirectorPreferences
  cancelCreationRef: React.MutableRefObject<(() => void) | null>
  timelineCollapsed: boolean
  onToggleTimeline: () => void
  onResetView: () => void
  onExit: () => void
  onOpenSettings: () => void
  onOpenHelp: () => void
}

/**
 * 区域装配层。必须是 EditorBody 之下的独立组件：两个创建模式 hook 要读 ViewportApiContext，
 * 而那个 Provider 是 EditorBody 渲染的 —— 在 EditorBody 自己的函数体里调，拿到的是 provider 之外的空值，
 * useViewportApi() 当场抛错、整块懒加载壳落到「加载失败」（2026-09-09 真机走查抓到）。
 */
function EditorStage({ scopeRef, preferences, cancelCreationRef, timelineCollapsed, onToggleTimeline, onResetView, onExit, onOpenSettings, onOpenHelp }: EditorStageProps): JSX.Element {
  const { t } = useTranslation()
  // 创建模式只调一次 hook，经 CreationModeContext 下发：视口要指针路由与 ghost ref，顶栏「＋添加」要能发起。
  // 两处各调一次 = 两份互不知情的模式状态（P1 的并行版）。
  const placement = useCharacterPlacement({ characterName: (index) => t('director.creation.characterName', { index }) })
  const boxDraw = useBoxDraw({ boxName: (index) => t('director.creation.boxName', { index }) })
  const creationMode = React.useMemo(() => ({ placement, boxDraw }), [placement, boxDraw])
  // 时间轴上一个实体都没有时把它钉成一条：比例记忆不动，加了轨道立刻回到用户自己的分栏
  const timelineEmpty = useDirectorStore((state) => orderedTimelineEntities(state.activeScene()).length === 0)
  return (
    <CreationModeContext.Provider value={creationMode}>
      <div className="relative min-h-0 flex-1">
        {/* 右栏是压在视口上的浮窗（2026-09-09 第 2 期，获批样张形态）：3D 画面在卡片下连贯铺满。
            暗区靠指针穿透消掉——只有卡片本身挡指针，卡间空隙与留白点得到视口，判据见 SidePanels 的 POS。 */}
        <EditorSplit
          direction="vertical"
          storageKey="director.center"
          defaultRatio={0.8}
          minRatio={0.35}
          maxRatio={0.94}
          collapsedSecondPx={timelineCollapsed ? TIMELINE_COLLAPSED_PX : timelineEmpty ? TIMELINE_EMPTY_PX : undefined}
        >
          <div className="relative h-full w-full">
            <DirectorViewport
              theme={preferences.theme}
              viewSettings={preferences.view}
              scopeRef={scopeRef}
              placement={placement}
              boxDraw={boxDraw}
              cancelCreationRef={cancelCreationRef}
            />
            <SidePanels />
          </div>
          <DirectorTimeline collapsed={timelineCollapsed} onToggleCollapsed={onToggleTimeline} scopeRef={scopeRef} />
        </EditorSplit>
        <DirectorTopBar
          onResetView={onResetView}
          onExit={onExit}
          onCancelCreation={() => cancelCreationRef.current?.()}
          onOpenSettings={onOpenSettings}
          onOpenHelp={onOpenHelp}
        />
      </div>
    </CreationModeContext.Provider>
  )
}

function EditorBody({ scopeRef, onExit, preferences, onChangePreferences, nodeId, onSendToCanvas }: EditorBodyProps): JSX.Element {
  const apiRef = React.useRef<ViewportApi | null>(null)
  const cancelCreationRef = React.useRef<(() => void) | null>(null)
  const store = useDirectorStoreApi()
  const { t } = useTranslation()
  const recorder = useCameraMotionRecorder({ apiRef, notify: (key, params) => toast(t(key as 'director.camera.recordDone', params), 'info') })
  const mobile = useMobileCamera({ recorder, apiRef })
  const outputs = useDirectorOutputs({ apiRef, ownerNodeId: nodeId, onSendToCanvas })
  const [settingsOpen, setSettingsOpen] = React.useState(false)
  const [helpOpen, setHelpOpen] = React.useState(false)
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
      {/* 五个功能簇一条悬浮顶栏（2026-09-09 用户拍板，方案 docs/plan/2026-09-09-director-chrome-five-clusters.md）：
          2026-09-04 那条整行标题栏连同视口左缘 / 底中 / 右下三条浮层一起收进这里，视口四边不再有控件带。 */}
      <EditorStage
        scopeRef={scopeRef}
        preferences={preferences}
        cancelCreationRef={cancelCreationRef}
        timelineCollapsed={timelineCollapsed}
        onToggleTimeline={toggleTimeline}
        onResetView={() => apiRef.current?.resetView()}
        onExit={onExit}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenHelp={() => setHelpOpen(true)}
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
 */
function useDirectorForcedDark(): void {
  const scheme = React.useContext(NomiColorSchemeContext)
  const acquire = scheme?.acquireForcedDark
  React.useEffect(() => {
    if (!acquire) return
    return acquire()
  }, [acquire])
}

export default function DirectorEditor({ rawProject, nodeTitle, readOnly = false, linkedAssets = EMPTY_LINKED_ASSETS, canvasImages = EMPTY_CANVAS_IMAGES, nodeId, onSendToCanvas, onClose, onProjectChange }: DirectorEditorProps): JSX.Element {
  const { t } = useTranslation()
  useDirectorForcedDark()
  const storeRef = React.useRef<DirectorStore | null>(null)
  if (!storeRef.current) {
    storeRef.current = createDirectorStore({ rawProject, defaultSceneName: t('director.node.sceneDefaultName') })
  }
  const store = storeRef.current
  const onProjectChangeRef = React.useRef(onProjectChange)
  onProjectChangeRef.current = onProjectChange
  const scopeRef = React.useRef<DirectorHotkeyScope>('viewport')
  // 偏好（漫游 / 灵敏度 / 视口主题）只存本机：改一次立刻生效并落 localStorage，不入工程不进撤销栈
  const [preferences, setPreferences] = React.useState<DirectorPreferences>(readDirectorPreferences)
  const changePreferences = React.useCallback((next: DirectorPreferences) => {
    setPreferences(next)
    writeDirectorPreferences(next)
  }, [])

  // 自动保存：工程变化后 2s 空闲写回一次（崩溃保护）；关闭时再写一次
  React.useEffect(() => {
    if (readOnly) return undefined
    let timer: number | null = null
    let lastProject = store.getState().project
    const unsubscribe = store.subscribe((state) => {
      if (state.project === lastProject) return
      lastProject = state.project
      if (timer !== null) window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        timer = null
        onProjectChangeRef.current(store.getState().exportProject())
      }, AUTOSAVE_IDLE_MS)
    })
    return () => {
      unsubscribe()
      if (timer !== null) window.clearTimeout(timer)
    }
  }, [readOnly, store])

  // body 滚动锁（与 V1 壳同机制）
  React.useEffect(() => {
    if (typeof document === 'undefined') return undefined
    const { body } = document
    const previousOverflow = body.style.overflow
    const previousOverscroll = body.style.overscrollBehavior
    body.style.overflow = 'hidden'
    body.style.overscrollBehavior = 'none'
    return () => {
      body.style.overflow = previousOverflow
      body.style.overscrollBehavior = previousOverscroll
    }
  }, [])

  const handleExit = React.useCallback(async () => {
    const ok = await confirmDialog({
      title: t('director.editor.exitConfirmTitle'),
      message: t('director.editor.exitConfirmMessage'),
      confirmLabel: t('director.editor.exitConfirmOk'),
    })
    if (!ok) return
    if (!readOnly) onProjectChangeRef.current(store.getState().exportProject())
    onClose()
  }, [onClose, readOnly, store, t])

  // Esc 归属（O5）：浮层/模式先吃；再清工具 + 选择；再退 POV；都没有 → 退出确认
  React.useEffect(() => {
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
  }, [handleExit, store])

  const shell = (
    <LinkedAssetsContext.Provider value={linkedAssets}>
    <CanvasImagesContext.Provider value={canvasImages}>
    <DirectorStoreContext.Provider value={store}>
      <TooltipProvider>
        <div
          className="fixed inset-x-0 bottom-0 isolate flex flex-col overflow-hidden bg-nomi-bg text-nomi-ink font-nomi-sans"
          style={{ top: currentFullscreenOverlayTopOffset(), zIndex: FULLSCREEN_Z_INDEX }}
          role="dialog"
          aria-modal="true"
          aria-label={nodeTitle ? `${t('director.editor.aria')} · ${nodeTitle}` : t('director.editor.aria')}
          tabIndex={0}
          data-testid="director-editor"
          onKeyDown={(event) => event.stopPropagation()}
          onKeyUp={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
          onWheel={(event) => event.stopPropagation()}
        >
          <EditorBody scopeRef={scopeRef} onExit={() => void handleExit()} preferences={preferences} onChangePreferences={changePreferences} nodeId={nodeId} onSendToCanvas={onSendToCanvas} />
        </div>
      </TooltipProvider>
    </DirectorStoreContext.Provider>
    </CanvasImagesContext.Provider>
    </LinkedAssetsContext.Provider>
  )

  return typeof document === 'undefined' ? shell : createPortal(shell, document.body)
}
