/**
 * [INPUT]: 依赖 react、three、@react-three/fiber 的 useThree/useFrame、three/examples/jsm/postprocessing 的 EffectComposer / RenderPass /
 *          OutlinePass / OutputPass、../DirectorEditorContext、./SceneRegistryContext
 * [OUTPUT]: 对外提供 SelectionOutline：选中实体描边（OutlinePass 半分辨率），无选中时直接渲染
 * [POS]: director/scene 的渲染出口：接管 R3F 的自动渲染（useFrame 优先级 1），有选中走 composer，否则 gl.render；
 *        出片/画中画各自用独立渲染器，不经这里。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import React from 'react'
import * as THREE from 'three'
import { useFrame, useThree } from '@react-three/fiber'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { OutlinePass } from 'three/examples/jsm/postprocessing/OutlinePass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { useDirectorStore } from '../DirectorEditorContext'
import { useSceneRegistry } from './SceneRegistryContext'
import { CAMERA_STATE_COLORS } from './sceneTheme'

export function SelectionOutline(): null {
  const { gl, scene, camera, size } = useThree()
  const registry = useSceneRegistry()
  const selection = useDirectorStore((state) => state.selection)
  const composerRef = React.useRef<EffectComposer | null>(null)
  const outlineRef = React.useRef<OutlinePass | null>(null)

  React.useEffect(() => {
    const composer = new EffectComposer(gl)
    const renderPass = new RenderPass(scene, camera)
    const outline = new OutlinePass(new THREE.Vector2(size.width, size.height), scene, camera)
    outline.edgeStrength = 3
    outline.edgeGlow = 0
    outline.edgeThickness = 1
    outline.pulsePeriod = 0
    outline.visibleEdgeColor.set(CAMERA_STATE_COLORS.selected)
    outline.hiddenEdgeColor.set(0x3d3300)
    composer.addPass(renderPass)
    composer.addPass(outline)
    composer.addPass(new OutputPass())
    composerRef.current = composer
    outlineRef.current = outline
    return () => {
      composer.dispose()
      outline.dispose()
      composerRef.current = null
      outlineRef.current = null
    }
  }, [camera, gl, scene, size.height, size.width])

  React.useEffect(() => {
    const composer = composerRef.current
    const outline = outlineRef.current
    if (!composer || !outline) return
    composer.setSize(size.width, size.height)
    outline.resolution.set(Math.max(1, Math.floor(size.width * 0.5)), Math.max(1, Math.floor(size.height * 0.5)))
  }, [size.height, size.width])

  const selectedIds = React.useMemo(
    () => [selection.objectId, selection.cameraId, selection.lightId, ...selection.multiObjectIds].filter((id): id is string => Boolean(id)),
    [selection.cameraId, selection.lightId, selection.multiObjectIds, selection.objectId],
  )

  useFrame(() => {
    const composer = composerRef.current
    const outline = outlineRef.current
    if (!composer || !outline) {
      gl.render(scene, camera)
      return
    }
    const objects: THREE.Object3D[] = []
    for (const id of selectedIds) {
      const object = registry.get(id)
      if (object) objects.push(object)
    }
    if (objects.length === 0) {
      gl.render(scene, camera)
      return
    }
    outline.selectedObjects = objects
    composer.render()
  }, 1)

  return null
}
