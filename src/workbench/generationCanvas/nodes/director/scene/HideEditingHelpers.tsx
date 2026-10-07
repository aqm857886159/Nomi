/**
 * [INPUT]: 依赖 react、three、@react-three/fiber 的 useFrame/useThree、./sceneRefs 的 isEditorOnly / isReferenceHelper
 * [OUTPUT]: 对外提供 HideEditingHelpers：挂着时每帧把「编辑辅助物里除参照（网格 / 地面）以外的」全部隐藏，卸载时还原
 * [POS]: 导演视图（3D-BOX）的视口可读规则（方案 §7 第 7 条）：机位模型 / 视锥线框、路标、操纵把手、gizmo 一律收掉，只留看空间的参照。
 *        判据复用出片与画中画已认的 editor-only 旗（一个 owner），参照旗只从里面挑出要留的两样；新长出来的辅助物下一帧自动被收。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import React from 'react'
import type * as THREE from 'three'
import { useFrame, useThree } from '@react-three/fiber'
import { isEditorOnly, isReferenceHelper } from './sceneRefs'

export function HideEditingHelpers(): null {
  const { scene } = useThree()
  const hiddenRef = React.useRef(new Set<THREE.Object3D>())

  // 默认优先级（0）：在主渲染（SelectionOutline，优先级 1）与画中画（2）之前跑
  useFrame(() => {
    scene.traverse((object) => {
      if (!object.visible || !isEditorOnly(object) || isReferenceHelper(object)) return
      object.visible = false
      hiddenRef.current.add(object)
    })
  })

  React.useEffect(() => {
    const hidden = hiddenRef.current
    return () => {
      for (const object of hidden) object.visible = true
      hidden.clear()
    }
  }, [])

  return null
}
