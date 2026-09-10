/**
 * [INPUT]: 依赖 react、three、@react-three/drei 的 Edges、../../model/directorTypes 的 DirectorObject / DirectorModelDisplayMode、
 *          ../sceneTheme 的 CLAY_EDGE_COLOR、./primitiveMaterial 的 primitiveMaterialSpec
 * [OUTPUT]: 对外提供 PrimitiveGeometry、PrimitiveEntity（八种基础几何体 + 三种显示模式 solid / translucent / clay）
 * [POS]: director/scene/entities 的几何体渲染：材质属性（颜色/粗糙度/金属度/透明度/线框/平面着色）来自对象数据，
 *        显示模式来自图层配置；辅助物体（isAuxiliary）只在主视口可见，出片/画中画由上层按标记隐藏。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import React from 'react'
import * as THREE from 'three'
import { Edges } from '@react-three/drei'
import type { DirectorModelDisplayMode, DirectorObject, DirectorPrimitiveType } from '../../model/directorTypes'
import { CLAY_EDGE_COLOR } from '../sceneTheme'
import { primitiveMaterialSpec } from './primitiveMaterial'

export function PrimitiveGeometry({ type }: { type: DirectorPrimitiveType }): JSX.Element {
  switch (type) {
    case 'sphere':
      return <sphereGeometry args={[0.5, 32, 24]} />
    case 'plane':
      return <boxGeometry args={[1, 0.02, 1]} />
    case 'cylinder':
      return <cylinderGeometry args={[0.5, 0.5, 1, 32]} />
    case 'cone':
      return <coneGeometry args={[0.5, 1, 32]} />
    case 'torus':
      return <torusGeometry args={[0.4, 0.15, 16, 48]} />
    case 'tetrahedron':
      return <tetrahedronGeometry args={[0.6]} />
    case 'icosahedron':
      return <icosahedronGeometry args={[0.55]} />
    case 'cube':
    default:
      return <boxGeometry args={[1, 1, 1]} />
  }
}

export function PrimitiveEntity({ object, displayMode }: { object: DirectorObject; displayMode: DirectorModelDisplayMode }): JSX.Element {
  const spec = primitiveMaterialSpec(object, displayMode)
  const auxiliary = object.isAuxiliary === true
  return (
    <mesh castShadow={!auxiliary} receiveShadow={!auxiliary} position={[0, object.type === 'plane' ? 0 : 0.5, 0]}>
      <PrimitiveGeometry type={object.type as DirectorPrimitiveType} />
      <meshStandardMaterial
        color={spec.color}
        roughness={spec.roughness}
        metalness={spec.metalness}
        opacity={auxiliary ? Math.min(spec.opacity, 0.5) : spec.opacity}
        transparent={spec.transparent || auxiliary}
        depthWrite={spec.depthWrite}
        wireframe={spec.wireframe}
        flatShading={spec.flatShading}
        side={THREE.DoubleSide}
        polygonOffset={displayMode === 'clay'}
        polygonOffsetFactor={displayMode === 'clay' ? 1 : 0}
        polygonOffsetUnits={displayMode === 'clay' ? 1 : 0}
      />
      {displayMode === 'clay' ? <Edges color={CLAY_EDGE_COLOR} threshold={20} /> : null}
    </mesh>
  )
}
