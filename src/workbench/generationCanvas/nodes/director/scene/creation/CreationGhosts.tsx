/**
 * [INPUT]: 依赖 react、three、@react-three/fiber 的 useFrame、./useCharacterPlacement 的 PlacementGhostState、./useBoxDraw 的 BoxDrawGhostState、
 *          ../sceneTheme 的 PLACEMENT_RING_COLOR、../../model/vec3 的 DEG_TO_RAD、../sceneRefs 的 tagEditorOnly
 * [OUTPUT]: 对外提供 PlacementGhost（地面双环 + 朝向箭头 + 半透明胶囊）、BoxDrawGhost（半透明方块 + 边线），每帧从 ref 同步
 * [POS]: director/scene/creation 的幽灵体渲染：不进 store、不触发 React 重渲染；全部 editor-only。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import React from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { DEG_TO_RAD } from '../../model/vec3'
import { tagEditorOnly } from '../sceneRefs'
import { PLACEMENT_RING_COLOR } from '../sceneTheme'
import type { BoxDrawGhostState } from './useBoxDraw'
import type { PlacementGhostState } from './useCharacterPlacement'

export function PlacementGhost({ ghostRef }: { ghostRef: React.MutableRefObject<PlacementGhostState> }): JSX.Element {
  const rootRef = React.useRef<THREE.Group>(null)
  const arrowRef = React.useRef<THREE.Mesh>(null)

  React.useLayoutEffect(() => {
    if (rootRef.current) tagEditorOnly(rootRef.current)
  }, [])

  useFrame(() => {
    const root = rootRef.current
    if (!root) return
    const ghost = ghostRef.current
    root.visible = ghost.visible
    if (!ghost.visible) return
    root.position.set(ghost.position.x, ghost.position.y, ghost.position.z)
    root.rotation.y = ghost.headingDeg * DEG_TO_RAD
    if (arrowRef.current) arrowRef.current.visible = ghost.dragging && Math.abs(ghost.headingDeg) > 0.01
  })

  return (
    <group ref={rootRef} visible={false}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} renderOrder={999}>
        <ringGeometry args={[0.18, 0.22, 32]} />
        <meshBasicMaterial color={0xffffff} transparent opacity={0.8} depthTest={false} side={THREE.DoubleSide} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} renderOrder={999}>
        <ringGeometry args={[0.38, 0.41, 32]} />
        <meshBasicMaterial color={0xa1a1aa} transparent opacity={0.45} depthTest={false} side={THREE.DoubleSide} />
      </mesh>
      <mesh ref={arrowRef} position={[0, 0.01, 0.48]} rotation={[Math.PI / 2, 0, 0]} renderOrder={1000}>
        <coneGeometry args={[0.08, 0.2, 16]} />
        <meshBasicMaterial color={PLACEMENT_RING_COLOR} transparent opacity={0.9} depthTest={false} />
      </mesh>
      <mesh position={[0, 0.875, 0]} renderOrder={998}>
        <capsuleGeometry args={[0.25, 1.25, 8, 16]} />
        <meshBasicMaterial color={0xd4d4d8} transparent opacity={0.35} depthWrite={false} />
      </mesh>
    </group>
  )
}

export function BoxDrawGhost({ ghostRef }: { ghostRef: React.MutableRefObject<BoxDrawGhostState> }): JSX.Element {
  const rootRef = React.useRef<THREE.Group>(null)
  const meshRef = React.useRef<THREE.Mesh>(null)

  React.useLayoutEffect(() => {
    if (rootRef.current) tagEditorOnly(rootRef.current)
  }, [])

  useFrame(() => {
    const root = rootRef.current
    const mesh = meshRef.current
    if (!root || !mesh) return
    const ghost = ghostRef.current
    root.visible = ghost.visible && ghost.width > 0.001 && ghost.depth > 0.001
    if (!root.visible) return
    root.position.set(ghost.center.x, ghost.center.y + ghost.height / 2, ghost.center.z)
    mesh.scale.set(Math.max(0.001, ghost.width), Math.max(0.001, ghost.height), Math.max(0.001, ghost.depth))
  })

  return (
    <group ref={rootRef} visible={false}>
      <mesh ref={meshRef}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color={PLACEMENT_RING_COLOR} transparent opacity={0.35} depthWrite={false} />
      </mesh>
    </group>
  )
}
