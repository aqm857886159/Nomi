/**
 * [INPUT]: 依赖 react、three、../../model/directorTypes 的 DirectorCamera、../../model/vec3 的 DEG_TO_RAD、../cameraMath 的 cameraQuaternion、
 *          ../sceneRefs 的 tagEntityObject / tagEditorOnly、../SceneRegistryContext、../sceneTheme 的 CAMERA_STATE_COLORS / CAMERA_BODY_COLOR
 * [OUTPUT]: 对外提供 CameraEntity：场内可见的虚拟相机（程序化机身：盒体 + 朝 +Z 的镜筒 + 顶部取景器）+ 16:9 视锥线（深 0.9，顶上一枚「朝上」三角）+ 5m 虚线射线，
 *           按 选中 / 激活 / 预览 / 默认 四态换色（线色四态、机身 emissive 只分选中 / 其它、缩放 1.15 / 1.1 / 1）
 * [POS]: director/scene/entities 的机位渲染：位姿走 yaw/pitch/roll（YXZ，yaw 从 +Z 起），机身几何就地生成、不依赖任何模型文件；
 *        主视口正处于该机位视角时隐藏整组（activeCameraId 的 mesh / line / frustum 全不显示），showRayHelper 关掉射线与视锥；整体 editor-only（出片不渲染）。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import React from 'react'
import * as THREE from 'three'
import type { DirectorCamera } from '../../model/directorTypes'
import { DEG_TO_RAD } from '../../model/vec3'
import { cameraQuaternion } from '../cameraMath'
import { tagEditorOnly, tagEntityObject } from '../sceneRefs'
import { useSceneRegistry } from '../SceneRegistryContext'
import { CAMERA_BODY_COLOR, CAMERA_STATE_COLORS } from '../sceneTheme'

export type CameraVisualState = 'selected' | 'active' | 'preview' | 'idle'

/** 视锥固定 16:9、深 0.9；4 条棱 + 4 条边 + 顶边中点上方 25% 高的「朝上」三角 */
const FRUSTUM_ASPECT = 16 / 9
const FRUSTUM_DEPTH = 0.9
function frustumPoints(fovDeg: number): Float32Array {
  const height = 2 * FRUSTUM_DEPTH * Math.tan((fovDeg * DEG_TO_RAD) / 2)
  const width = height * FRUSTUM_ASPECT
  const z = FRUSTUM_DEPTH
  const tl = [-width / 2, height / 2, z]
  const tr = [width / 2, height / 2, z]
  const br = [width / 2, -height / 2, z]
  const bl = [-width / 2, -height / 2, z]
  const apex = [0, height / 2 + height * 0.25, z]
  const origin = [0, 0, 0]
  return new Float32Array([
    ...origin, ...tl, ...origin, ...tr, ...origin, ...br, ...origin, ...bl,
    ...tl, ...tr, ...tr, ...br, ...br, ...bl, ...bl, ...tl,
    ...tl, ...apex, ...tr, ...apex,
  ])
}

/** 线材质按四态换色 / 透明度；机身 emissive 只分「选中」与「其它」 */
function lineStyle(state: CameraVisualState): { color: number; opacity: number } {
  return { color: CAMERA_STATE_COLORS[state], opacity: state === 'selected' || state === 'active' ? 0.9 : state === 'preview' ? 0.7 : 0.45 }
}

/** 机身：盒体 + 朝 +Z 的镜筒 + 顶部取景器，三件共用一份金属材质（metalness 0.8 / roughness 0.2）；emissive 选中 0x00FFCC×1、否则 0x00A2FF×0.25 */
function CameraBody({ selected }: { selected: boolean }): JSX.Element {
  const material = React.useMemo(() => new THREE.MeshStandardMaterial({ color: CAMERA_BODY_COLOR, metalness: 0.8, roughness: 0.2 }), [])
  React.useEffect(() => () => material.dispose(), [material])
  React.useLayoutEffect(() => {
    material.emissive.setHex(selected ? CAMERA_STATE_COLORS.selected : CAMERA_STATE_COLORS.idle)
    material.emissiveIntensity = selected ? 1 : 0.25
  }, [material, selected])
  return (
    <group>
      <mesh material={material} position={[0, 0, -0.04]}>
        <boxGeometry args={[0.18, 0.13, 0.2]} />
      </mesh>
      <mesh material={material} position={[0, 0, 0.11]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.045, 0.05, 0.1, 24]} />
      </mesh>
      <mesh material={material} position={[0, 0.083, -0.06]}>
        <boxGeometry args={[0.06, 0.035, 0.08]} />
      </mesh>
    </group>
  )
}

export function CameraEntity({ camera, visualState, hidden }: { camera: DirectorCamera; visualState: CameraVisualState; hidden: boolean }): JSX.Element {
  const registry = useSceneRegistry()
  const rootRef = React.useRef<THREE.Group>(null)
  const { color, opacity } = lineStyle(visualState)
  const quaternion = React.useMemo(() => cameraQuaternion(camera.pitch, camera.yaw, camera.roll), [camera.pitch, camera.yaw, camera.roll])
  const frustum = React.useMemo(() => frustumPoints(camera.fov), [camera.fov])
  const rayLine = React.useMemo(() => {
    const geometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, 5)])
    const material = new THREE.LineDashedMaterial({ color, dashSize: 0.15, gapSize: 0.1, transparent: true, opacity })
    const line = new THREE.Line(geometry, material)
    line.computeLineDistances()
    line.raycast = () => null
    return line
  }, [color, opacity])
  React.useEffect(
    () => () => {
      rayLine.geometry.dispose()
      ;(rayLine.material as THREE.Material).dispose()
    },
    [rayLine],
  )
  const scale = visualState === 'selected' ? 1.15 : visualState === 'preview' ? 1.1 : 1

  React.useLayoutEffect(() => {
    const root = rootRef.current
    if (!root) return undefined
    tagEntityObject(root, camera.id, 'camera')
    tagEditorOnly(root)
    registry.register(camera.id, root)
    return () => registry.unregister(camera.id, root)
  }, [camera.id, registry])

  return (
    <group ref={rootRef} name={`cam_${camera.id}`} position={[camera.position.x, camera.position.y, camera.position.z]} quaternion={quaternion} visible={!hidden}>
      <group scale={scale}>
        <CameraBody selected={visualState === 'selected'} />
      </group>
      {camera.showRayHelper !== false ? (
        <>
          <lineSegments raycast={() => null}>
            <bufferGeometry>
              <bufferAttribute attach="attributes-position" args={[frustum, 3]} />
            </bufferGeometry>
            <lineBasicMaterial color={color} transparent opacity={opacity} />
          </lineSegments>
          <primitive object={rayLine} />
        </>
      ) : null}
    </group>
  )
}
