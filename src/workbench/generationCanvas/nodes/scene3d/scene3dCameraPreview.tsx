import React from 'react'
import * as THREE from 'three'
import { Canvas, useThree } from '@react-three/fiber'
import { Environment, Sky } from '@react-three/drei'
import { IconCamera, IconEye, IconRotate } from '@tabler/icons-react'
import { cn } from '../../../../utils/cn'
import { applySceneCameraPose, crowdCount } from './scene3dMath'
import { SCENE3D_ASPECT_OPTIONS, SCENE3D_ASPECT_RATIOS } from './scene3dTypes'
import type { Scene3DAspectRatio, Scene3DCamera, Scene3DObject, Scene3DState } from './scene3dTypes'
import {
  Scene3DMeshGeometry,
  ProceduralMannequin,
  Mannequin,
  ProceduralMannequinCrowd,
  LightObject,
  MannequinAssetBoundary,
} from './scene3dObjects'

export function cameraPreviewViewportStyle(aspectRatio: Scene3DAspectRatio): React.CSSProperties {
  const ratio = SCENE3D_ASPECT_RATIOS[aspectRatio]
  const maxWidth = 224
  const maxHeight = 240
  let width = maxWidth
  let height = width / ratio
  if (height > maxHeight) {
    height = maxHeight
    width = height * ratio
  }
  return {
    width: `${Math.round(width)}px`,
    height: `${Math.round(height)}px`,
  }
}

export function CameraPreviewPose({ cameraData }: { cameraData: Scene3DCamera }): null {
  const { camera } = useThree()

  React.useLayoutEffect(() => {
    applySceneCameraPose(camera, cameraData)
  }, [camera, cameraData])

  return null
}

export function PreviewObjectView({
  object,
  roleStartIndex = 0,
}: {
  object: Scene3DObject
  roleStartIndex?: number
}): JSX.Element {
  return (
    <group
      visible={object.visible}
      position={object.position}
      rotation={object.rotation}
      scale={object.scale}
    >
      {object.type === 'mannequin' ? (
        <MannequinAssetBoundary fallback={<ProceduralMannequin color={object.color || '#808080'} />}>
          <React.Suspense fallback={<ProceduralMannequin color={object.color || '#808080'} />}>
            <Mannequin color={object.color || '#808080'} pose={object.pose} />
          </React.Suspense>
        </MannequinAssetBoundary>
      ) : object.type === 'mannequinCrowd' ? (
        <ProceduralMannequinCrowd object={object} roleStartIndex={roleStartIndex} />
      ) : object.type === 'light' ? (
        <LightObject object={object} />
      ) : (
        <mesh>
          <Scene3DMeshGeometry geometry={object.geometry} />
          <meshStandardMaterial
            color={object.color || '#808080'}
            roughness={0.55}
            metalness={0.04}
            side={object.geometry === 'plane' ? THREE.DoubleSide : THREE.FrontSide}
          />
        </mesh>
      )}
    </group>
  )
}

export function CameraPreviewScene({
  state,
  cameraData,
}: {
  state: Scene3DState
  cameraData: Scene3DCamera
}): JSX.Element {
  let roleIndex = 0
  return (
    <>
      <color attach="background" args={[state.environment.backgroundColor]} />
      <ambientLight intensity={0.65} />
      {state.environment.showSky ? <Sky sunPosition={[2, 1, 4]} /> : null}
      {state.environment.preset ? (
        <React.Suspense fallback={null}>
          <Environment preset="city" />
        </React.Suspense>
      ) : null}
      {state.environment.showAxes ? <axesHelper args={[2]} /> : null}
      {state.objects.map((object) => {
        const roleStartIndex = roleIndex
        if (object.type === 'mannequin') roleIndex += 1
        if (object.type === 'mannequinCrowd') roleIndex += crowdCount(object)
        return <PreviewObjectView key={object.id} object={object} roleStartIndex={roleStartIndex} />
      })}
      <CameraPreviewPose cameraData={cameraData} />
    </>
  )
}

export function CameraPreview({
  camera,
  state,
  readOnly,
  cameraViewEditing,
  rightPanelCollapsed,
  onAspectChange,
  onLensDepthChange,
  onToggleViewEdit,
  onLevelCamera,
  onScreenshot,
}: {
  camera: Scene3DCamera
  state: Scene3DState
  readOnly: boolean
  cameraViewEditing: boolean
  rightPanelCollapsed: boolean
  onAspectChange: (aspectRatio: Scene3DAspectRatio) => void
  onLensDepthChange: (lensDepth: number) => void
  onToggleViewEdit: () => void
  onLevelCamera: () => void
  onScreenshot: () => void
}): JSX.Element {
  const previewStyle = React.useMemo(() => cameraPreviewViewportStyle(camera.aspectRatio), [camera.aspectRatio])
  const lensDepth = camera.lensDepth ?? 0

  return (
    <div
      className={cn(
        'absolute right-4 z-[3] w-[260px] rounded-nomi border border-[var(--nomi-line-soft)] bg-[var(--nomi-paper)] p-2 text-[var(--nomi-ink)] shadow-[var(--nomi-shadow-md)]',
        rightPanelCollapsed ? 'top-16' : 'top-4',
      )}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="min-w-0 truncate text-caption font-medium">{camera.name} · {camera.aspectRatio}</div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            className={cn(
              'inline-flex h-7 items-center gap-1 rounded-nomi-sm px-2 text-micro hover:bg-[var(--nomi-ink-10)] hover:text-[var(--nomi-ink)] disabled:opacity-40',
              cameraViewEditing ? 'bg-[var(--nomi-ink)] text-[var(--nomi-paper)]' : 'bg-[var(--nomi-ink-05)] text-[var(--nomi-ink-60)]',
            )}
            disabled={readOnly}
            type="button"
            title={cameraViewEditing ? '正在取景调整，按 Esc 或点击顶部退出' : '从相机视角调整'}
            onClick={onToggleViewEdit}
          >
            <IconEye size={14} />
            <span>取景</span>
          </button>
          <button
            className="grid size-7 place-items-center rounded-nomi-sm bg-[var(--nomi-ink-05)] text-[var(--nomi-ink-60)] hover:bg-[var(--nomi-ink-10)] hover:text-[var(--nomi-ink)] disabled:opacity-40"
            disabled={readOnly}
            type="button"
            title="水平摆正"
            onClick={onLevelCamera}
          >
            <IconRotate size={14} />
          </button>
          <button className="grid size-7 place-items-center rounded-nomi-sm bg-[var(--nomi-ink-05)] text-[var(--nomi-ink-60)] hover:bg-[var(--nomi-ink-10)] hover:text-[var(--nomi-ink)]" type="button" title="相机截图" onClick={onScreenshot}>
            <IconCamera size={15} />
          </button>
        </div>
      </div>
      <div className="flex min-h-[126px] items-center justify-center rounded-nomi-sm border border-[var(--nomi-line-soft)] bg-[var(--nomi-ink-05)] p-1">
        <div className="overflow-hidden rounded-nomi-sm bg-[var(--nomi-ink)]" style={previewStyle}>
          <Canvas
            camera={{
              fov: camera.fov,
              near: camera.near,
              far: camera.far,
              position: camera.position,
              rotation: camera.rotation,
            }}
            dpr={[1, 1.5]}
            frameloop="demand"
            gl={{ antialias: true, preserveDrawingBuffer: false }}
          >
            <CameraPreviewScene state={state} cameraData={camera} />
          </Canvas>
        </div>
      </div>
      <div className="mt-2 grid grid-cols-5 gap-1">
        {SCENE3D_ASPECT_OPTIONS.map((option) => (
          <button
            key={option}
            className={cn(
              'h-6 rounded-nomi-sm border border-[var(--nomi-line-soft)] text-micro text-[var(--nomi-ink-60)] hover:bg-[var(--nomi-ink-05)] hover:text-[var(--nomi-ink)]',
              option === camera.aspectRatio && 'bg-[var(--nomi-ink)] text-[var(--nomi-paper)]',
            )}
            disabled={readOnly}
            type="button"
            onClick={() => onAspectChange(option)}
          >
            {option}
          </button>
        ))}
      </div>
      <div className="mt-3 rounded-nomi-sm border border-[var(--nomi-line-soft)] bg-[var(--nomi-ink-05)] px-2 py-2">
        <div className="mb-1 flex items-center justify-between gap-2 text-micro text-[var(--nomi-ink-60)]">
          <span>镜头深度</span>
          <span className="font-medium text-[var(--nomi-ink)]">{Math.round(lensDepth)}%</span>
        </div>
        <input
          className="block h-1.5 w-full accent-[var(--nomi-ink)]"
          disabled={readOnly}
          max={100}
          min={-100}
          step={1}
          type="range"
          value={lensDepth}
          onChange={(event) => onLensDepthChange(Number(event.currentTarget.value))}
        />
        <div className="mt-1 grid grid-cols-3 text-micro text-[var(--nomi-ink-45)]">
          <span>-100%</span>
          <span className="text-center">0</span>
          <span className="text-right">100%</span>
        </div>
      </div>
    </div>
  )
}
