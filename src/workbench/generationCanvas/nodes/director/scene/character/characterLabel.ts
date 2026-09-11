/**
 * [INPUT]: three 的 Object3D / Vector3 类型、../sceneRefs 的 isWorldVisible
 * [OUTPUT]: characterLabelAnchor：可见角色的完整世界头顶锚点
 * [POS]: 视口与离屏出片共享标签锚点，继承场景/父组/对象的可见性与完整变换。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type * as THREE from 'three'
import { isWorldVisible } from '../sceneRefs'

export function characterLabelAnchor(root: THREE.Object3D, height: number, target: THREE.Vector3): boolean {
  if (!isWorldVisible(root)) return false
  root.localToWorld(target.set(0, height * 1.05, 0))
  return true
}
