/**
 * [INPUT]: 依赖 react、three、../../DirectorEditorContext 的 useDirectorStore、../../model/directorTypes、../sceneRefs、../SceneRegistryContext、
 *          ./PrimitiveEntity、./CharacterEntity、./SplatEntity、./ModelEntity、./LightEntity、./CameraEntity、../../model/vec3 的 DEG_TO_RAD
 * [OUTPUT]: 对外提供 DirectorEntities：把当前图层的 objects（含 parentId 树）、lights、cameras 物化为 three 场景图
 * [POS]: director/scene/entities 的装配层：全部实体挂在 globalSceneContainer（图层整体变换）下；对象位姿每帧由
 *        useTimelinePlayback 直接写到 Object3D（求值层），这里只负责静止位姿与树结构，避免每帧 React 重渲染。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import React from 'react'
import * as THREE from 'three'
import { useDirectorStore } from '../../DirectorEditorContext'
import type { DirectorModelDisplayMode, DirectorObject } from '../../model/directorTypes'
import { DEG_TO_RAD } from '../../model/vec3'
import { tagEntityObject } from '../sceneRefs'
import { useSceneRegistry } from '../SceneRegistryContext'
import { CameraEntity, type CameraVisualState } from './CameraEntity'
import { CharacterEntity } from './CharacterEntity'
import { LightEntity } from './LightEntity'
import { ModelEntity } from './ModelEntity'
import { PrimitiveEntity } from './PrimitiveEntity'
import { SplatEntity } from './SplatEntity'

function ObjectNode({
  object,
  childrenByParent,
  displayMode,
  selectedIds,
}: {
  object: DirectorObject
  childrenByParent: Map<string, DirectorObject[]>
  displayMode: DirectorModelDisplayMode
  selectedIds: Set<string>
}): JSX.Element {
  const registry = useSceneRegistry()
  const rootRef = React.useRef<THREE.Group>(null)
  const children = childrenByParent.get(object.id) ?? []

  React.useLayoutEffect(() => {
    const root = rootRef.current
    if (!root) return undefined
    tagEntityObject(root, object.id, 'object')
    registry.register(object.id, root)
    return () => registry.unregister(object.id, root)
  }, [object.id, registry])

  return (
    <group
      ref={rootRef}
      position={[object.position.x, object.position.y, object.position.z]}
      rotation={[object.rotation.x * DEG_TO_RAD, object.rotation.y * DEG_TO_RAD, object.rotation.z * DEG_TO_RAD]}
      scale={[object.scale.x, object.scale.y, object.scale.z]}
      visible={object.visible}
    >
      {object.type === 'character' ? (
        <CharacterEntity object={object} selected={selectedIds.has(object.id)} />
      ) : object.type === 'splat' ? (
        <SplatEntity object={object} />
      ) : object.type === 'model' ? (
        <ModelEntity object={object} />
      ) : object.type === 'group' ? null : (
        <PrimitiveEntity object={object} displayMode={displayMode} />
      )}
      {children.map((child) => (
        <ObjectNode key={child.id} object={child} childrenByParent={childrenByParent} displayMode={displayMode} selectedIds={selectedIds} />
      ))}
    </group>
  )
}

export function DirectorEntities(): JSX.Element {
  const scene = useDirectorStore((state) => state.activeScene())
  const selection = useDirectorStore((state) => state.selection)
  const activeCameraId = useDirectorStore((state) => state.activeCameraId)
  const previewCameraId = useDirectorStore((state) => state.previewCameraId)
  const displayMode = scene.sceneConfig.modelDisplayMode

  const { roots, childrenByParent } = React.useMemo(() => {
    const byParent = new Map<string, DirectorObject[]>()
    const ids = new Set(scene.objects.map((object) => object.id))
    const rootObjects: DirectorObject[] = []
    for (const object of scene.objects) {
      if (object.parentId && ids.has(object.parentId)) {
        const list = byParent.get(object.parentId) ?? []
        list.push(object)
        byParent.set(object.parentId, list)
      } else {
        rootObjects.push(object)
      }
    }
    return { roots: rootObjects, childrenByParent: byParent }
  }, [scene.objects])

  const selectedIds = React.useMemo(() => new Set([selection.objectId, ...selection.multiObjectIds].filter((id): id is string => Boolean(id))), [selection.objectId, selection.multiObjectIds])

  return (
    <group
      position={[scene.sceneConfig.position.x, scene.sceneConfig.position.y, scene.sceneConfig.position.z]}
      rotation={[scene.sceneConfig.rotation.x * DEG_TO_RAD, scene.sceneConfig.rotation.y * DEG_TO_RAD, scene.sceneConfig.rotation.z * DEG_TO_RAD]}
      scale={scene.sceneConfig.scale}
      visible={scene.visible}
      name="directorGlobalSceneContainer"
    >
      {roots.map((object) => (
        <ObjectNode key={object.id} object={object} childrenByParent={childrenByParent} displayMode={displayMode} selectedIds={selectedIds} />
      ))}
      {scene.lights.map((light) => (
        <LightEntity key={light.id} light={light} selected={selection.lightId === light.id} />
      ))}
      {scene.cameras.map((camera) => {
        const visualState: CameraVisualState =
          selection.cameraId === camera.id ? 'selected' : activeCameraId === camera.id ? 'active' : previewCameraId === camera.id ? 'preview' : 'idle'
        return <CameraEntity key={camera.id} camera={camera} visualState={visualState} hidden={activeCameraId === camera.id} />
      })}
    </group>
  )
}
