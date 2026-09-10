/**
 * [INPUT]: 依赖 react、three、@react-three/drei 的 useGLTF / useFBX、three/examples/jsm/utils/SkeletonUtils 的 clone、react-i18next、
 *          ../../../../../../ui/toast、../../DirectorEditorContext、../../model/directorTypes 的 DirectorObject、../character/characterAsset（isFbxUrl / hasMixamoRig）、../sceneTheme 的 CLAY_COLOR
 * [OUTPUT]: 对外提供 ModelEntity（type='model' 的用户模型：GLB / GLTF 走 useGLTF、FBX 走 useFBX，加载中 / 失败退化线框盒）
 * [POS]: director/scene/entities 的普通模型物化（清单 §3.2「导入本地模型 → 自动判 Mixamo 角色 vs 普通模型」）：加载后发现 mixamorig 骨骼
 *        就把对象升格为 character（走 CharacterEntity 的骨骼管线），否则原样静态渲染。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import React from 'react'
import * as THREE from 'three'
import { useFBX, useGLTF } from '@react-three/drei'
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { useTranslation } from 'react-i18next'
import { toast } from '../../../../../../ui/toast'
import { useDirectorStoreApi } from '../../DirectorEditorContext'
import type { DirectorObject } from '../../model/directorTypes'
import { hasMixamoRig, isFbxUrl } from '../character/characterAsset'
import { CLAY_COLOR } from '../sceneTheme'

function FallbackBox(): JSX.Element {
  return (
    <mesh position={[0, 0.5, 0]}>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial color={CLAY_COLOR} wireframe />
    </mesh>
  )
}

type BoundaryState = { failed: boolean }

class ModelBoundary extends React.Component<{ fallback: React.ReactNode; onError: () => void; children: React.ReactNode }, BoundaryState> {
  state: BoundaryState = { failed: false }
  static getDerivedStateFromError(): BoundaryState {
    return { failed: true }
  }
  componentDidCatch(): void {
    this.props.onError()
  }
  render(): React.ReactNode {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}

function LoadedModel({ objectId, source }: { objectId: string; source: THREE.Object3D }): JSX.Element {
  const store = useDirectorStoreApi()
  const instance = React.useMemo(() => cloneSkeleton(source), [source])
  React.useEffect(() => {
    if (!hasMixamoRig(instance)) return
    // 上传的是 Mixamo 骨骼角色 → 升格为角色，走骨骼管线（动作 / 姿态 / IK / 视线）
    store.getState().updateObject(objectId, { type: 'character', rig: 'mixamo', isSystemModel: false })
  }, [instance, objectId, store])
  return <primitive object={instance} />
}

function GltfModel({ objectId, url }: { objectId: string; url: string }): JSX.Element {
  const gltf = useGLTF(url)
  return <LoadedModel objectId={objectId} source={gltf.scene} />
}

function FbxModel({ objectId, url }: { objectId: string; url: string }): JSX.Element {
  const fbx = useFBX(url)
  return <LoadedModel objectId={objectId} source={fbx} />
}

export function ModelEntity({ object }: { object: DirectorObject }): JSX.Element {
  const { t } = useTranslation()
  const url = object.modelPath ?? ''
  const name = object.name
  const onError = React.useCallback(() => toast(t('director.environment.modelLoadFailed', { name }), 'error'), [name, t])
  if (!url) return <FallbackBox />
  return (
    <ModelBoundary fallback={<FallbackBox />} onError={onError}>
      <React.Suspense fallback={<FallbackBox />}>
        {isFbxUrl(url) ? <FbxModel objectId={object.id} url={url} /> : <GltfModel objectId={object.id} url={url} />}
      </React.Suspense>
    </ModelBoundary>
  )
}
