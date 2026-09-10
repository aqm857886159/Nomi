/**
 * [INPUT]: 依赖 react、react-i18next、../../scene/DirectorCanvas、../../scene/ViewCamera 的 DEFAULT_VIEW_SETTINGS / ViewSettings、
 *          ../../scene/sceneTheme、../../scene/creation/usePathDraw、../../scene/LabelProjector 类型、./ViewportOverlays、
 *          ../ai/AiSceneBar、../../DirectorEditorContext、../../model/directorTypes、../../scene/ViewportApiContext
 *          ../../useDirectorHotkeys 的共享输入归属；统一创建模式 Esc、工具切换取消与 Orbit 生命周期
 *          角色放置 / 画框两个 API 由壳（DirectorEditor）持有并经 props 传入，顶栏「＋添加」是另一个发起方
 * [OUTPUT]: 对外提供 DirectorViewport：视口容器 —— 画布 + 标签层 + 模式提示 + 放置/画框 HUD + POV 卡 + 画中画 + AI 搭场景；
 *           指针事件先给创建模式 hook，再落到画布拾取；悬浮态写入 hoveredRef / scopeRef
 * [POS]: director/panels/viewport 的视口装配（清单 §2 全部 DOM 侧），three 世界在 scene/DirectorCanvas。
 *        2026-09-09 五簇重排后视口上不再有控件带：创建栏 / 底栏 / 显示模式三条已并进 topbar/DirectorTopBar，
 *        这里只剩内容与情境浮层（标签 / HUD / POV / 画中画 / AI 入口）。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import { useDirectorStore } from '../../DirectorEditorContext'
import { isDirectorKeyboardBlocked } from '../../useDirectorHotkeys'
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
import { AiSceneBar } from '../ai/AiSceneBar'
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
}

export function DirectorViewport({ theme, viewSettings = DEFAULT_VIEW_SETTINGS, scopeRef, placement, boxDraw, cancelCreationRef }: DirectorViewportProps): JSX.Element {
  const { t } = useTranslation()
  const hoveredRef = React.useRef(false)
  const apiRef = useViewportApi()
  const transformMode = useDirectorStore((state) => state.transformMode)
  const pickingEnabledRef = React.useRef(true)
  const hostRef = React.useRef<HTMLDivElement>(null)
  const pipRectRef = React.useRef<PipRect>(null)
  const recorder = useCameraRecorder()
  const [labels, setLabels] = React.useState<ProjectedLabel[]>([])
  const [aiOpen, setAiOpen] = React.useState(false)
  const exportRatio = useDirectorStore((state) => state.project.exportRatio)
  const reject = React.useCallback((key: string) => toast(t(key as 'director.reason.closeupLocked'), 'warning'), [t])
  const pathDraw = usePathDraw({ notify: (key, params) => toast(t(key as 'director.trajectory.created', params), 'info') })
  const { cancel: cancelPlacement } = placement
  const { cancel: cancelBox } = boxDraw
  const { cancel: cancelPath } = pathDraw
  const modeActive = placement.active || boxDraw.active || pathDraw.active
  pickingEnabledRef.current = !modeActive

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

  // Esc：先取消创建/画路径模式（O5 归属顺序里模式优先于选择/退出）
  React.useEffect(() => {
    if (!modeActive) return undefined
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || isDirectorKeyboardBlocked(event)) return
      event.preventDefault()
      event.stopImmediatePropagation()
      cancelCreation()
    }
    window.addEventListener('keydown', onKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true })
  }, [cancelCreation, modeActive])

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
        if (placement.onPointerDown(event) || boxDraw.onPointerDown(event) || pathDraw.onPointerDown(event)) event.stopPropagation()
      }}
      onPointerMove={(event) => {
        if (placement.onPointerMove(event) || boxDraw.onPointerMove(event) || pathDraw.onPointerMove(event)) event.stopPropagation()
      }}
      onPointerUp={(event) => {
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
      />
      <AspectGuide pipRectRef={pipRectRef} />
      <ViewportLabels labels={labels} />
      <CameraPovHud />
      <PlacementHud placement={placement} boxDraw={boxDraw} />
      <PathDrawHud pathDraw={pathDraw} />
      <PipViewport rectRef={pipRectRef} canvasHostRef={hostRef} />
      {/* AI 搭场景是视口底部中央唯一的常驻入口（原底栏那条 8 簇的胶囊 2026-09-09 已并入顶栏五簇） */}
      <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center">
        <AiSceneBar open={aiOpen} onClose={() => setAiOpen(false)} onOpen={() => setAiOpen(true)} />
      </div>
    </div>
  )
}
