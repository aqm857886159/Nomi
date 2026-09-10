/**
 * [INPUT]: 依赖 ./directorStore 的 CommitProject / StoreGet / StoreSet 类型、./directorIds 的 createObjectId、./directorProject 的 createDefaultScene、
 *          ./directorTypes（DirectorObject / DirectorScene）、./aiScene 的 NormalizedAiScene
 * [OUTPUT]: 对外提供 DirectorAiSceneActions、createAiSceneActions：materializeAiScene（AI block-out → 组 + 几何体，落当前图层或新图层）
 * [POS]: director/model 的 AI 搭场景物化：每个 AI 组 = 一个 group 对象，元素挂其下；当前图层 = 再包一层「{场景名}」总成组便于整体移动 / 删除；
 *        新图层 = createDefaultScene + 天空色 / 地面透明度 + 激活。一次 commitProject 一次撤销。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { NormalizedAiScene } from './aiScene'
import { createObjectId } from './directorIds'
import { createDefaultScene } from './directorProject'
import { createAssetId } from './storeAssetActions'
import type { CommitProject, StoreGet, StoreSet } from './directorStore'
import type { DirectorAssetItem, DirectorObject, DirectorScene } from './directorTypes'

export type AiSceneLibraryAsset = Omit<DirectorAssetItem, 'id' | 'createdAt'>

export type AiSceneTarget = 'current_layer' | 'new_layer'

export type DirectorAiSceneActions = {
  // 返回落点：图层 id 与总成组 id（新图层时总成组 = 每个 AI 组直接挂图层根，rootGroupId 为 null）
  materializeAiScene: (scene: NormalizedAiScene, target: AiSceneTarget, targetSceneId?: string, asset?: AiSceneLibraryAsset) => { sceneId: string; rootGroupId: string | null; objectCount: number }
}

const IDENTITY = { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } }

function groupObject(name: string, parentId?: string): DirectorObject {
  return { id: createObjectId(), name, type: 'group', ...IDENTITY, visible: true, locked: false, ...(parentId ? { parentId } : {}) }
}

function buildObjects(scene: NormalizedAiScene, rootParentId: string | undefined): DirectorObject[] {
  const objects: DirectorObject[] = []
  for (const group of scene.groups) {
    const groupNode = groupObject(group.name, rootParentId)
    objects.push(groupNode)
    for (const element of group.elements) {
      objects.push({
        id: createObjectId(),
        name: element.name,
        type: element.type,
        position: element.position,
        rotation: element.rotation,
        scale: element.scale,
        color: element.color,
        roughness: element.roughness,
        metalness: element.metalness,
        opacity: element.opacity,
        wireframe: element.wireframe,
        flatShading: element.flatShading,
        visible: true,
        locked: false,
        parentId: groupNode.id,
      })
    }
  }
  return objects
}

function applySceneConfig(target: DirectorScene, scene: NormalizedAiScene): void {
  if (scene.skyColor) target.sceneConfig.skyColor = scene.skyColor
  if (scene.groundOpacity !== undefined) target.sceneConfig.groundOpacity = scene.groundOpacity
}

export function exportAiScene(scene: NormalizedAiScene): DirectorScene {
  const layer = createDefaultScene(scene.sceneName)
  layer.objects = buildObjects(scene, undefined)
  applySceneConfig(layer, scene)
  return layer
}

export function createAiSceneActions(set: StoreSet, get: StoreGet, commitProject: CommitProject): DirectorAiSceneActions {
  return {
    materializeAiScene: (scene, target, targetSceneId = get().project.activeSceneId, asset) => {
      if (target === 'current_layer' && !get().project.scenes.some((layer) => layer.id === targetSceneId)) throw new Error('AI target scene no longer exists')
      get().saveState()
      const libraryItem = asset ? { ...asset, id: createAssetId(), createdAt: Date.now() } : null
      if (target === 'new_layer') {
        const layer = exportAiScene(scene)
        commitProject((project) => {
          project.scenes.push(layer)
          project.activeSceneId = layer.id
          if (libraryItem) project.assets.items.push(libraryItem)
        })
        set({ activeCameraId: 'free' })
        return { sceneId: layer.id, rootGroupId: null, objectCount: layer.objects.length }
      }
      const root = groupObject(scene.sceneName)
      const objects = [root, ...buildObjects(scene, root.id)]
      commitProject((project) => {
        const layer = project.scenes.find((candidate) => candidate.id === targetSceneId)!
        layer.objects.push(...objects)
        applySceneConfig(layer, scene)
        if (libraryItem) project.assets.items.push(libraryItem)
      })
      if (get().project.activeSceneId === targetSceneId) get().select({ objectId: root.id, multiObjectIds: [root.id], cameraId: null, lightId: null })
      return { sceneId: targetSceneId, rootGroupId: root.id, objectCount: objects.length }
    },
  }
}
