/**
 * [INPUT]: 依赖 react、three、@react-three/fiber、../../model/directorTypes 的 DirectorLight、../../model/vec3 的 forwardFromAngles、
 *          ../sceneRefs 的 tagEntityObject / tagEditorOnly、../SceneRegistryContext 的 useSceneRegistry
 * [OUTPUT]: 对外提供 LightEntity：平行光 / 点光 / 聚光 + 可拾取的灯具小模型（editor-only）+ 照射方向指示
 * [POS]: director/scene/entities 的灯光渲染：光源参数（颜色/强度/锥角/柔化/距离/衰减/阴影）来自灯数据，朝向由 yaw/pitch
 *        换算成 target；灯具模型只在编辑器可见，出片隐藏。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import React from 'react'
import * as THREE from 'three'
import type { DirectorLight } from '../../model/directorTypes'
import { DEG_TO_RAD, forwardFromAngles } from '../../model/vec3'
import { tagEditorOnly, tagEntityObject } from '../sceneRefs'
import { useSceneRegistry } from '../SceneRegistryContext'

const HELPER_COLOR = 0xffe4ce

export function LightEntity({ light, selected }: { light: DirectorLight; selected: boolean }): JSX.Element {
  const registry = useSceneRegistry()
  const rootRef = React.useRef<THREE.Group>(null)
  const targetRef = React.useRef<THREE.Object3D>(new THREE.Object3D())
  const helperRef = React.useRef<THREE.Group>(null)
  const forward = forwardFromAngles(light.yaw, light.pitch)

  React.useLayoutEffect(() => {
    const root = rootRef.current
    if (!root) return undefined
    tagEntityObject(root, light.id, 'light')
    registry.register(light.id, root)
    return () => registry.unregister(light.id, root)
  }, [light.id, registry])

  React.useLayoutEffect(() => {
    if (helperRef.current) tagEditorOnly(helperRef.current)
  }, [])

  // spot / directional 的 target 放在灯前方 5m（three 需要 target 在场景图里）
  React.useLayoutEffect(() => {
    const target = targetRef.current
    const root = rootRef.current
    if (!root) return undefined
    target.position.set(forward.x * 5, forward.y * 5, forward.z * 5)
    root.add(target)
    return () => {
      root.remove(target)
    }
  }, [forward.x, forward.y, forward.z])

  const color = new THREE.Color(light.color || '#ffffff')
  const intensity = light.enabled ? light.intensity : 0
  const helperScale = selected ? 1.15 : 1

  return (
    <group ref={rootRef} position={[light.position.x, light.position.y, light.position.z]} visible={light.visible}>
      {light.type === 'directional' ? (
        <directionalLight color={color} intensity={intensity} castShadow={light.castShadow} target={targetRef.current} />
      ) : light.type === 'spot' ? (
        <spotLight
          color={color}
          intensity={intensity}
          distance={light.distance}
          decay={light.decay}
          angle={(light.spotAngle ?? 45) * DEG_TO_RAD}
          penumbra={light.spotPenumbra ?? 0.3}
          castShadow={light.castShadow}
          target={targetRef.current}
        />
      ) : (
        <pointLight color={color} intensity={intensity} distance={light.distance} decay={light.decay} castShadow={light.castShadow} />
      )}
      <group ref={helperRef} scale={helperScale}>
        <mesh>
          <sphereGeometry args={[0.12, 16, 12]} />
          <meshStandardMaterial color={selected ? 0xffcc00 : HELPER_COLOR} emissive={selected ? 0xffcc00 : HELPER_COLOR} emissiveIntensity={light.enabled ? 0.9 : 0.15} />
        </mesh>
        {light.type !== 'point' ? (
          <group quaternion={new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(forward.x, forward.y, forward.z).normalize())}>
            <mesh position={[0, 0, 0.45]} rotation={[Math.PI / 2, 0, 0]}>
              <coneGeometry args={[light.type === 'spot' ? 0.16 : 0.06, 0.5, 16, 1, true]} />
              <meshBasicMaterial color={selected ? 0xffcc00 : HELPER_COLOR} transparent opacity={0.35} side={THREE.DoubleSide} depthWrite={false} />
            </mesh>
          </group>
        ) : null}
      </group>
    </group>
  )
}
