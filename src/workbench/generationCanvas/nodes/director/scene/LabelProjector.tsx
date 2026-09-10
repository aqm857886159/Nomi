/**
 * [INPUT]: 依赖 react、three、@react-three/fiber 的 useThree/useFrame、../DirectorEditorContext 的 useDirectorStoreApi、./SceneRegistryContext、character/characterLabel 的共享世界锚点
 * [OUTPUT]: 对外提供 ProjectedLabel 类型、LabelProjector（每帧把可见角色的头顶投影成 2D 坐标，变化超过 0.5px 才通知）
 * [POS]: director/scene 的角色名标签数据源（清单 §2.4 叠加层）：DOM 层 ViewportLabels 用它画标签，截图/录像用同一算法
 *        烧进画面，保证「所见即所得」。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import React from 'react'
import * as THREE from 'three'
import { useFrame, useThree } from '@react-three/fiber'
import { useDirectorStoreApi } from '../DirectorEditorContext'
import { useSceneRegistry } from './SceneRegistryContext'
import { CHARACTER_HEIGHT } from './entities/CharacterEntity'
import { characterLabelAnchor } from './character/characterLabel'

export type ProjectedLabel = { id: string; name: string; x: number; y: number }

export function LabelProjector({ onLabels }: { onLabels: (labels: ProjectedLabel[]) => void }): null {
  const { camera, size } = useThree()
  const store = useDirectorStoreApi()
  const registry = useSceneRegistry()
  const lastRef = React.useRef<ProjectedLabel[]>([])
  const tmp = React.useMemo(() => new THREE.Vector3(), [])

  useFrame(() => {
    const state = store.getState()
    const scene = state.activeScene()
    const next: ProjectedLabel[] = []
    if (scene.sceneConfig.showCharacterLabels && scene.visible) {
      for (const object of scene.objects) {
        if (object.type !== 'character' || !object.visible) continue
        const root = registry.get(object.id)
        if (!root || !characterLabelAnchor(root, CHARACTER_HEIGHT, tmp)) continue
        tmp.project(camera)
        if (tmp.z > 1 || tmp.z < -1) continue
        next.push({ id: object.id, name: object.name, x: (tmp.x * 0.5 + 0.5) * size.width, y: (-tmp.y * 0.5 + 0.5) * size.height })
      }
    }
    const last = lastRef.current
    const changed = last.length !== next.length || next.some((label, index) => {
      const previous = last[index]
      return !previous || previous.id !== label.id || previous.name !== label.name || Math.abs(previous.x - label.x) > 0.5 || Math.abs(previous.y - label.y) > 0.5
    })
    if (changed) {
      lastRef.current = next
      onLabels(next)
    }
  })

  return null
}
