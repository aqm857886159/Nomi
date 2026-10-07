/**
 * [INPUT]: 依赖 react、three、@react-three/drei 的 Edges、../../model/directorSpace 的 PRIMITIVE_GEOMETRY、../../model/directorTypes 的 DirectorObject / DirectorModelDisplayMode、
 *          ../sceneTheme 的 CLAY_EDGE_COLOR、./primitiveMaterial 的 primitiveMaterialSpec
 * [OUTPUT]: 对外提供 PrimitiveGeometry、PrimitiveEntity（八种基础几何体 + 三种显示模式 solid / translucent / clay）
 * [POS]: director/scene/entities 的几何体渲染：材质属性（颜色/粗糙度/金属度/透明度/线框/平面着色）来自对象数据，
 *        显示模式来自图层配置；辅助物体（isAuxiliary）只在主视口可见，出片/画中画由上层按标记隐藏。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import React, { type JSX } from 'react'
import * as THREE from 'three'
import { Edges } from '@react-three/drei'
import { PRIMITIVE_GEOMETRY } from '../../model/directorSpace'
import type { DirectorModelDisplayMode, DirectorObject, DirectorPrimitiveType } from '../../model/directorTypes'
import { CLAY_EDGE_COLOR } from '../sceneTheme'
import { primitiveMaterialSpec } from './primitiveMaterial'

// 几何参数与网格抬高都读 model/directorSpace 的 PRIMITIVE_GEOMETRY——渲染与量尺同一份，不在这里再写数字
export function PrimitiveGeometry({ type }: { type: DirectorPrimitiveType }): JSX.Element {
  const spec = PRIMITIVE_GEOMETRY[type] ?? PRIMITIVE_GEOMETRY.cube
  return React.createElement(`${spec.geometry}Geometry`, { args: spec.args })
}

export function PrimitiveEntity({ object, displayMode }: { object: DirectorObject; displayMode: DirectorModelDisplayMode }): JSX.Element {
  const spec = primitiveMaterialSpec(object, displayMode)
  const auxiliary = object.isAuxiliary === true
  return (
    <mesh castShadow={!auxiliary} receiveShadow={!auxiliary} position={[0, (PRIMITIVE_GEOMETRY[object.type as DirectorPrimitiveType] ?? PRIMITIVE_GEOMETRY.cube).meshY, 0]}>
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
