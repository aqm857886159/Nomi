/**
 * [INPUT]: 依赖 react、three、@react-three/fiber、@react-three/drei 的 GizmoHelper / GizmoViewcube、../../fencedCanvas 的 FencedCanvas、
 *          ./webglContextRecovery 的 attachWebGLContextRecovery、./SceneRegistryContext、./sceneRefs、
 *          ./environment/{SkyGround, PanoramaSphere, SparkHost}、./entities/DirectorEntities、./ViewCamera、./TransformGizmo、./SelectionOutline、./LabelProjector、
 *          ./useViewportPicking、./useTimelinePlayback、./creation/CreationGhosts、./creation/usePathDraw 的 PathDrawGhostState、./TrajectoryVisuals、
 *          ./PipRenderer（画中画剪裁渲染）、./HideEditingHelpers（导演视图收编辑辅助物）、./E2EBridge（E2E 取证桥）、./capture/CaptureBinder（出片渲染登记）、../useCameraMotionRecorder 的 RecordingGhostState、./ViewportApiContext
 *          ../DirectorEditorContext 的 recording：录制运镜中消费视图立方点击，防止跳机位
 *          ../../../../generation/pageLayerContext 的 useGenerationPageLayerActive：导演台藏着时停渲染循环
 * [OUTPUT]: 对外提供 DirectorCanvas：主视口的 R3F 画布（frameloop always、阴影、上下文丢失恢复）+ 全部场景子系统 + 视图立方；
 *           presentation='director'（3D-BOX 导演视图）时不挂视图立方、收掉编辑辅助物、画中画跟节目机位
 * [POS]: director/scene 的装配根：DOM 层只把 refs/回调传进来，three 世界的一切从这里长出去。
 *        导演台藏着（切去别的页 / 列表视图）时渲染循环停（FrameloopGate：R3F 的 frameloop 切 never，回来切 always 并 invalidate 重新起循环），
 *        否则一个看不见的 3D 视口会一直占着 GPU / CPU 拖慢别的页；场景树与 store 都留着，回来原样接着画。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import React, { type JSX } from 'react'
import * as THREE from 'three'
import { useThree } from '@react-three/fiber'
import { GizmoHelper, GizmoViewcube } from '@react-three/drei'
import { FencedCanvas } from '../../fencedCanvas'
import { attachWebGLContextRecovery } from './webglContextRecovery'
import { BoxDrawGhost, PlacementGhost } from './creation/CreationGhosts'
import type { BoxDrawGhostState } from './creation/useBoxDraw'
import type { PlacementGhostState } from './creation/useCharacterPlacement'
import type { PathDrawGhostState } from './creation/usePathDraw'
import type { RecordingGhostState } from '../useCameraMotionRecorder'
import type { PipRect } from './pipCamera'
import { E2EBridge } from './E2EBridge'
import { CaptureBinder } from './capture/CaptureBinder'
import { PipRenderer } from './PipRenderer'
import { TrajectoryVisuals } from './TrajectoryVisuals'
import { HideEditingHelpers } from './HideEditingHelpers'
import { DirectorEntities } from './entities/DirectorEntities'
import { SkyGround } from './environment/SkyGround'
import { PanoramaSphere } from './environment/PanoramaSphere'
import { SparkHost } from './environment/SparkHost'
import { LabelProjector, type ProjectedLabel } from './LabelProjector'
import { createSceneRefRegistry, tagEditorOnly } from './sceneRefs'
import { SceneRegistryContext } from './SceneRegistryContext'
import { SelectionOutline } from './SelectionOutline'
import type { DirectorViewportTheme } from './sceneTheme'
import { TransformGizmo } from './TransformGizmo'
import { useTimelinePlayback } from './useTimelinePlayback'
import { useViewportPicking } from './useViewportPicking'
import { ViewCamera } from './ViewCamera'
import { FREE_CAMERA_HOME, type ViewSettings } from './viewSettings'
import { useDirectorStore } from '../DirectorEditorContext'
import { useGenerationPageLayerActive } from '../../../../generation/pageLayerContext'

export type DirectorCanvasProps = {
  theme: DirectorViewportTheme
  viewSettings: ViewSettings
  hoveredRef: React.MutableRefObject<boolean>
  pickingEnabledRef: React.MutableRefObject<boolean>
  placementGhostRef: React.MutableRefObject<PlacementGhostState>
  boxGhostRef: React.MutableRefObject<BoxDrawGhostState>
  pathGhostRef: React.MutableRefObject<PathDrawGhostState>
  recordingGhostRef: React.MutableRefObject<RecordingGhostState>
  pipRectRef: React.MutableRefObject<PipRect>
  aspect: number
  onLabels: (labels: ProjectedLabel[]) => void
  onPovRejected: (reasonKey: string) => void
  presentation?: 'edit' | 'director'
}

function PickingBinder({ enabledRef, onPovRejected }: { enabledRef: React.MutableRefObject<boolean>; onPovRejected: (reasonKey: string) => void }): null {
  useViewportPicking({ enabledRef, onPovRejected })
  return null
}

function PlaybackBinder(): null {
  useTimelinePlayback()
  return null
}

/**
 * 导演台看不见时停掉 R3F 的渲染循环，看得见了再起。frameloop 走 store 的 setFrameloop（Canvas 的 frameloop 属性一直是 always、没变，
 * 所以别的重配不会把它改回去）；从 never 回到 always 时循环已经停了，必须 invalidate 一次才会重新起（setFrameloop 自己不起循环）。
 */
function FrameloopGate(): null {
  const active = useGenerationPageLayerActive()
  const setFrameloop = useThree((state) => state.setFrameloop)
  const invalidate = useThree((state) => state.invalidate)
  const get = useThree((state) => state.get)
  React.useEffect(() => {
    const wanted = active ? 'always' : 'never'
    if (get().frameloop === wanted) return
    setFrameloop(wanted)
    if (active) invalidate()
  }, [active, get, invalidate, setFrameloop])
  return null
}

function ContextRecovery(): null {
  const { gl, invalidate } = useThree()
  React.useEffect(() => attachWebGLContextRecovery(gl.domElement, invalidate), [gl, invalidate])
  return null
}

/** 视图立方住右下：右上是精修属性卡出现的地方（2026-10-04「选中才出」），卡一出就把它盖住。 */
function ViewCube(): JSX.Element {
  const recording = useDirectorStore((state) => Boolean(state.recording))
  const groupRef = React.useRef<THREE.Group>(null)
  React.useLayoutEffect(() => {
    if (groupRef.current) tagEditorOnly(groupRef.current)
  }, [])
  return (
    <group ref={groupRef}>
      <GizmoHelper alignment="bottom-right" margin={[56, 56]}>
        <GizmoViewcube color="#2a2d33" hoverColor="#3b82f6" textColor="#e5e7eb" strokeColor="#6b7280" opacity={0.9} font="20px sans-serif" onClick={recording ? (event) => { event.stopPropagation(); return null } : undefined} />
      </GizmoHelper>
    </group>
  )
}

export function DirectorCanvas(props: DirectorCanvasProps): JSX.Element {
  const registry = React.useMemo(() => createSceneRefRegistry(), [])
  return (
    <FencedCanvas
      frameloop="always"
      shadows="percentage"
      dpr={[1, 2]}
      gl={{ antialias: true, alpha: false, preserveDrawingBuffer: false, powerPreference: 'high-performance' }}
      camera={{ fov: FREE_CAMERA_HOME.fov, near: 0.1, far: 2000, position: [FREE_CAMERA_HOME.position.x, FREE_CAMERA_HOME.position.y, FREE_CAMERA_HOME.position.z] }}
      style={{ width: '100%', height: '100%' }}
      onCreated={({ gl }) => {
        gl.outputColorSpace = THREE.SRGBColorSpace
      }}
    >
      <SceneRegistryContext.Provider value={registry}>
        <ContextRecovery />
        <FrameloopGate />
        <SkyGround theme={props.theme} />
        <PanoramaSphere />
        <SparkHost />
        <DirectorEntities />
        <ViewCamera settings={props.viewSettings} hoveredRef={props.hoveredRef} />
        <TransformGizmo />
        <PlacementGhost ghostRef={props.placementGhostRef} />
        <BoxDrawGhost ghostRef={props.boxGhostRef} />
        <TrajectoryVisuals ghostRef={props.pathGhostRef} recordingGhostRef={props.recordingGhostRef} />
        <PickingBinder enabledRef={props.pickingEnabledRef} onPovRejected={props.onPovRejected} />
        <PlaybackBinder />
        <LabelProjector onLabels={props.onLabels} />
        {props.presentation === 'director' ? <HideEditingHelpers /> : <ViewCube />}
        <SelectionOutline />
        <PipRenderer rectRef={props.pipRectRef} followProgram={props.presentation === 'director'} />
        <CaptureBinder />
        <E2EBridge />
      </SceneRegistryContext.Provider>
    </FencedCanvas>
  )
}
