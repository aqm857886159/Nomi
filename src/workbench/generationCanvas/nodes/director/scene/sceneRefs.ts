/**
 * [INPUT]: 依赖 three 的 Object3D 类型、../model/directorTypes 的 DirectorScene
 * [OUTPUT]: 对外提供 DIRECTOR_ENTITY_ID_KEY / DIRECTOR_ENTITY_KIND_KEY / DIRECTOR_EDITOR_ONLY_KEY、SceneRefRegistry、
 *           createSceneRefRegistry、tagEntityObject、findEntityFromObject、isWorldVisible / isDirectorObjectVisible（继承可见性）
 * [POS]: director/scene 的运行时对象表：store 只存数据，three 对象由各 Entity 组件挂载后登记到这里；拾取、gizmo 挂载、
 *        标签投影、离屏出片都靠 id ↔ Object3D 互查。编辑器专用对象（把手/辅助线）打 editor-only 标记，出片时统一隐藏。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type * as THREE from 'three'
import type { DirectorScene } from '../model/directorTypes'
import type { CaptureFrameRequest, CaptureFrameResult } from './ViewportApiContext'

export const DIRECTOR_ENTITY_ID_KEY = 'directorEntityId'
export const DIRECTOR_ENTITY_KIND_KEY = 'directorEntityKind'
export const DIRECTOR_EDITOR_ONLY_KEY = 'directorEditorOnly'

export type DirectorEntityKind = 'object' | 'camera' | 'light' | 'ikHandle'

export type SceneRefRegistry = {
  register: (id: string, object: THREE.Object3D) => void
  unregister: (id: string, object: THREE.Object3D) => void
  get: (id: string) => THREE.Object3D | undefined
  entries: () => IterableIterator<[string, THREE.Object3D]>
  // 角色「双脚吸附地面」处理器：需要蒙皮几何，住在 CharacterEntity 内；登记在这张表（画布装配时就存在）而不是 ViewportApi 上——
  // ViewportApi 由 ViewCamera 的 effect 才填上，比实体 effect 晚一拍，登记会落空（2026-09-02 走查栽过）
  registerFeetSnapper: (id: string, snap: (() => void) | null) => void
  snapFeet: (id: string) => boolean
  // 出片渲染器：需要 gl / scene（住 scene/capture/CaptureBinder），同样登记在这张表由 ViewportApi 转发
  registerFrameCapturer: (capture: FrameCapturer | null) => void
  captureFrame: FrameCapturer
}

export type FrameCapturer = (request: CaptureFrameRequest) => Promise<CaptureFrameResult | null>

export function createSceneRefRegistry(): SceneRefRegistry {
  const map = new Map<string, THREE.Object3D>()
  const feetSnappers = new Map<string, () => void>()
  let frameCapturer: FrameCapturer | null = null
  return {
    register: (id, object) => {
      map.set(id, object)
    },
    unregister: (id, object) => {
      if (map.get(id) === object) map.delete(id)
    },
    get: (id) => map.get(id),
    entries: () => map.entries(),
    registerFeetSnapper: (id, snap) => {
      if (snap) feetSnappers.set(id, snap)
      else feetSnappers.delete(id)
    },
    snapFeet: (id) => {
      const snap = feetSnappers.get(id)
      if (!snap) return false
      snap()
      return true
    },
    registerFrameCapturer: (capture) => {
      frameCapturer = capture
    },
    captureFrame: (request) => (frameCapturer ? frameCapturer(request) : Promise.resolve(null)),
  }
}

export function tagEntityObject(object: THREE.Object3D, id: string, kind: DirectorEntityKind): void {
  object.userData[DIRECTOR_ENTITY_ID_KEY] = id
  object.userData[DIRECTOR_ENTITY_KIND_KEY] = kind
}

// 出片（scene/capture 的 collectCaptureHiddenObjects）认这个旗标：编辑辅助物一律不进成片
export function tagEditorOnly(object: THREE.Object3D): void {
  object.userData[DIRECTOR_EDITOR_ONLY_KEY] = true
}

export function isEditorOnly(object: THREE.Object3D): boolean {
  return object.userData[DIRECTOR_EDITOR_ONLY_KEY] === true
}

/** three 不会自动把父组的 visible 写入子对象；拾取与标签须沿真实父链判断。 */
export function isWorldVisible(object: THREE.Object3D): boolean {
  for (let current: THREE.Object3D | null = object; current; current = current.parent) if (!current.visible) return false
  return true
}

/** Portal 辅助层不在实体父链内，按 store 的同一可见性链响应父组/场景开关。 */
export function isDirectorObjectVisible(scene: DirectorScene, objectId: string): boolean {
  if (!scene.visible) return false
  const seen = new Set<string>()
  let id: string | undefined = objectId
  while (id) {
    if (seen.has(id)) return false
    seen.add(id)
    const object = scene.objects.find((item) => item.id === id)
    if (!object?.visible) return false
    id = object.parentId
  }
  return true
}

// 从被射线命中的子网格向上找最近的实体根（带 id 标记），返回 id 与类型
export function findEntityFromObject(object: THREE.Object3D | null): { id: string; kind: DirectorEntityKind } | null {
  let current: THREE.Object3D | null = object
  while (current) {
    const id = current.userData[DIRECTOR_ENTITY_ID_KEY]
    if (typeof id === 'string') {
      return { id, kind: (current.userData[DIRECTOR_ENTITY_KIND_KEY] as DirectorEntityKind) ?? 'object' }
    }
    current = current.parent
  }
  return null
}

// 路标小球的 userData 标记：{ entityId, waypointId, clipId?, time }，拾取层据此把点击变成「选路标 + 播放头跳过去」
// 拾取专用 three 图层：角色的胶囊碰撞体放这层——主相机 / 描边 / 截图都不渲染它，只有射线拾取开这层
export const DIRECTOR_PICK_LAYER = 1
// IK 把手的 userData 标记：{ entityId, key }，拾取层据此把点击变成「选中该角色 + 该把手」
export const DIRECTOR_IK_HANDLE_KEY = 'directorIkHandle'
export type IkHandleTag = { entityId: string; key: string }
/** 3D 骨骼球（FK 点选）的 userData 标记：命中即选该角色的这根语义骨 */
export const DIRECTOR_BONE_KEY = 'directorBone'
export type BoneTag = { entityId: string; bone: string }
export const DIRECTOR_WAYPOINT_KEY = 'directorWaypoint'
export type WaypointTag = { entityId: string; waypointId: string; clipId?: string; time: number }
