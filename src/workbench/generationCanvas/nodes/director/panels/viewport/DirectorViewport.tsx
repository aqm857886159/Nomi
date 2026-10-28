/**
 * [INPUT]: 依赖 react、react-i18next、../../scene/DirectorCanvas、../../scene/viewSettings 的 DEFAULT_VIEW_SETTINGS / ViewSettings、
 *          ../../scene/sceneTheme、../../scene/creation/usePathDraw、../../scene/LabelProjector 类型、./ViewportOverlays、./AspectGuide、./CameraPovHud、./PipViewport、
 *          ../../DirectorEditorContext、../../CameraRecorderContext、../../model/cameraLens、../../scene/ViewportApiContext、../../../../../../ui/toast、
 *          ../../useDirectorHotkeys 的共享输入归属；统一创建模式 Esc、工具切换取消与 Orbit 生命周期
 *          角色放置 / 画框两个 API 由壳（DirectorEditor）持有并经 props 传入，顶栏「＋添加」是另一个发起方
 * [OUTPUT]: 对外提供 DirectorViewport：视口容器 —— 画布 + 机位取景框 + 标签层 + POV 卡 + 放置 / 画框 / 画线提示条 + 画中画；
 *           指针事件先给创建模式 hook，再落到画布拾取；悬浮态写入 hoveredRef / scopeRef；
 *           presentation（导演视图）时编辑辅助物不画、不可点选、小窗改说「正在播哪一镜」
 * [POS]: director/panels/viewport 的视口装配（清单 §2 全部 DOM 侧），three 世界在 scene/DirectorCanvas。
 *        2026-09-09 五簇重排后视口上不再有控件带：创建栏 / 底栏 / 显示模式三条已并进顶栏（今天是 topbar/RefineTopBar），
 *        这里只剩内容与情境浮层（取景框 / 标签 / POV / 提示条 / 画中画）；顶部锚定的浮层都让开悬浮顶栏（topbar/topChrome）。
 *        底部中央的「AI 搭场景」入口已随 8876f0c5d 删除（3D-BOX 成为唯一导演台，搭场景交给右侧 Agent 面板）。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import React, { type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { useDirectorStore, useDirectorStoreApi } from '../../DirectorEditorContext'
import { isDirectorKeyboardBlocked } from '../../useDirectorHotkeys'
import { useGenerationPageLayerActive } from '../../../../../generation/pageLayerContext'
import { useViewportApi } from '../../scene/ViewportApiContext'
import type { DirectorHotkeyScope } from '../../model/hotkeys'
import { toast } from '../../../../../../ui/toast'
import type { BoxDrawApi } from '../../scene/creation/useBoxDraw'
import type { CharacterPlacementApi } from '../../scene/creation/useCharacterPlacement'
import { usePathDraw } from '../../scene/creation/usePathDraw'
import { DirectorCanvas } from '../../scene/DirectorCanvas'
import type { ProjectedLabel } from '../../scene/LabelProjector'
import type { DirectorViewportTheme } from '../../scene/sceneTheme'
import { DEFAULT_VIEW_SETTINGS, type ViewSettings } from '../../scene/viewSettings'
import { useCameraRecorder } from '../../CameraRecorderContext'
import { exportAspectRatio } from '../../model/cameraLens'
import type { PipRect } from '../../scene/pipCamera'
import { AspectGuide } from './AspectGuide'
import { CameraPovHud } from './CameraPovHud'
import { PipViewport } from './PipViewport'
import { PathDrawHud, PlacementHud, ViewportLabels } from './ViewportOverlays'

export type DirectorViewportProps = {
  theme: DirectorViewportTheme
  viewSettings?: ViewSettings
  scopeRef: React.MutableRefObject<DirectorHotkeyScope>
  /** 角色放置 / 画框两个创建模式由壳持有（顶栏「＋添加」也要发起），这里只消费 */
  placement: CharacterPlacementApi
  boxDraw: BoxDrawApi
  cancelCreationRef?: React.MutableRefObject<(() => void) | null>
  /** 导演视图（3D-BOX）的看法：编辑辅助物不画、不可点选、小窗跟播放头的节目机位并说「正在播哪一镜」。缺省 = 精修。 */
  presentation?: DirectorViewportPresentation
}

export type DirectorViewportPresentation = { kind: 'director'; nowPlaying: string | null }

export function DirectorViewport({ theme, viewSettings = DEFAULT_VIEW_SETTINGS, scopeRef, placement, boxDraw, cancelCreationRef, presentation }: DirectorViewportProps): JSX.Element {
  const { t } = useTranslation()
  const hoveredRef = React.useRef(false)
  const apiRef = useViewportApi()
  const transformMode = useDirectorStore((state) => state.transformMode)
  const pickingEnabledRef = React.useRef(true)
  const hostRef = React.useRef<HTMLDivElement>(null)
  const pipRectRef = React.useRef<PipRect>(null)
  const recorder = useCameraRecorder()
  const [labels, setLabels] = React.useState<ProjectedLabel[]>([])
  const exportRatio = useDirectorStore((state) => state.project.exportRatio)
  const reject = React.useCallback((key: string) => toast(t(key as 'director.reason.closeupLocked'), 'warning'), [t])
  const pathDraw = usePathDraw({ notify: (key, params) => toast(t(key as 'director.trajectory.created', params), 'info') })
  const { cancel: cancelPlacement } = placement
  const { cancel: cancelBox } = boxDraw
  const { cancel: cancelPath } = pathDraw
  const modeActive = placement.active || boxDraw.active || pathDraw.active
  // 导演视图只看不点：编辑辅助物已不画，点选会选中看不见的机位；点 3D 画面空白处 = 取消镜头选中（画布「正在改：镜头 N」）
  pickingEnabledRef.current = !modeActive && !presentation
  const store = useDirectorStoreApi()
  const blankClickRef = React.useRef<{ x: number; y: number } | null>(null)

  const cancelCreation = React.useCallback(() => {
    cancelPlacement()
    cancelBox()
    cancelPath()
  }, [cancelPlacement, cancelBox, cancelPath])
  React.useEffect(() => {
    if (!cancelCreationRef) return
    cancelCreationRef.current = cancelCreation
    return () => { cancelCreationRef.current = null }
  }, [cancelCreation, cancelCreationRef])
  // 4/5 或 1/2/3 接管时，角色放置/画框必须退出；Orbit 的开关只由此聚合所有权控制。
  React.useEffect(() => {
    if (pathDraw.active || transformMode !== null) { cancelPlacement(); cancelBox() }
  }, [pathDraw.active, transformMode, cancelPlacement, cancelBox])
  React.useEffect(() => {
    const api = apiRef.current
    api?.setOrbitEnabled(!modeActive)
    return () => { api?.setOrbitEnabled(true) }
  }, [apiRef, modeActive])

  // Esc：先取消创建/画路径模式（O5 归属顺序里模式优先于选择/退出）；导演台藏着时不接（窗口级捕获期监听会吞掉别的页的 Esc）
  const layerActive = useGenerationPageLayerActive()
  React.useEffect(() => {
    if (!modeActive || !layerActive) return undefined
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || isDirectorKeyboardBlocked(event)) return
      event.preventDefault()
      event.stopImmediatePropagation()
      cancelCreation()
    }
    window.addEventListener('keydown', onKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true })
  }, [cancelCreation, layerActive, modeActive])

  return (
    <div
      ref={hostRef}
      className={`relative h-full w-full overflow-hidden bg-nomi-bg ${modeActive ? 'cursor-crosshair' : ''}`}
      data-testid="director-viewport"
      data-nomi-director-creation-mode={modeActive ? 'active' : undefined}
      onPointerEnter={() => {
        hoveredRef.current = true
        scopeRef.current = 'viewport'
      }}
      onPointerLeave={() => {
        hoveredRef.current = false
        placement.onPointerLeave()
        pathDraw.onPointerLeave()
      }}
      onPointerDown={(event) => {
        blankClickRef.current = presentation && event.button === 0 && event.target instanceof HTMLCanvasElement ? { x: event.clientX, y: event.clientY } : null
        if (placement.onPointerDown(event) || boxDraw.onPointerDown(event) || pathDraw.onPointerDown(event)) event.stopPropagation()
      }}
      onPointerMove={(event) => {
        if (placement.onPointerMove(event) || boxDraw.onPointerMove(event) || pathDraw.onPointerMove(event)) event.stopPropagation()
      }}
      onPointerUp={(event) => {
        const down = blankClickRef.current
        blankClickRef.current = null
        // 只认「点」不认「拖」（转视角）：位移 ≤ 5px 才清
        if (down && Math.hypot(event.clientX - down.x, event.clientY - down.y) <= 5) store.getState().select({ cameraId: null, multiCameraIds: [] })
        if (placement.onPointerUp(event) || boxDraw.onPointerUp(event) || pathDraw.onPointerUp(event)) event.stopPropagation()
      }}
      onContextMenu={(event) => {
        event.preventDefault()
        if (modeActive) {
          placement.cancel()
          boxDraw.cancel()
          pathDraw.cancel()
        }
      }}
    >
      <DirectorCanvas
        theme={theme}
        viewSettings={viewSettings}
        hoveredRef={hoveredRef}
        pickingEnabledRef={pickingEnabledRef}
        placementGhostRef={placement.ghostRef}
        boxGhostRef={boxDraw.ghostRef}
        pathGhostRef={pathDraw.ghostRef}
        recordingGhostRef={recorder.ghostRef}
        pipRectRef={pipRectRef}
        aspect={exportAspectRatio(exportRatio) ?? 16 / 9}
        onLabels={setLabels}
        onPovRejected={reject}
        presentation={presentation ? 'director' : 'edit'}
      />
      <AspectGuide pipRectRef={pipRectRef} />
      <ViewportLabels labels={labels} />
      <CameraPovHud />
      <PlacementHud placement={placement} boxDraw={boxDraw} />
      <PathDrawHud pathDraw={pathDraw} />
      <PipViewport rectRef={pipRectRef} canvasHostRef={hostRef} presentation={presentation} />
    </div>
  )
}
