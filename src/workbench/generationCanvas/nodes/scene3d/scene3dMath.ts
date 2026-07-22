import * as THREE from 'three'
import { createScene3DCameraId, createScene3DObjectId } from './scene3dSerializer'
import {
  SCENE3D_ASPECT_RATIOS,
  type Scene3DAspectRatio,
  type Scene3DCamera,
  type Scene3DCaptureResult,
  type Scene3DGeometry,
  type Scene3DObject,
  type Scene3DState,
  type Scene3DVector3,
} from './scene3dTypes'
import {
  CAMERA_DEFAULT_TARGET,
  SCENE3D_EDITOR_ONLY_FLAG,
  CAMERA_LENS_DEPTH_MAX_FACTOR,
  CLIPBOARD_PASTE_OFFSET,
  CROWD_MAX_AXIS,
  FOLLOW_ORBIT_MAX_POLAR_ANGLE,
  FOLLOW_ORBIT_MIN_POLAR_ANGLE,
  MANNEQUIN_DEFAULT_POSE,
  MANNEQUIN_DEFAULT_SCALE,
  MANNEQUIN_REST_ROTATION_KEY,
  MOVEMENT_CODES,
  ROLE_COLOR_SEQUENCE,
  SCENE3D_GRID_FLAG,
  SCENE3D_RUNTIME_ID_KEY,
  type CrowdAddOptions,
  type Scene3DMovementCode,
} from './scene3dConstants'

export type PointerCaptureTarget = {
  setPointerCapture?: (pointerId: number) => void
  releasePointerCapture?: (pointerId: number) => void
}

export function isEditableKeyboardTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return Boolean(target.closest('input, textarea, select, [contenteditable="true"]'))
}

export function pointerCaptureTarget(target: unknown): PointerCaptureTarget | null {
  return target && typeof target === 'object' ? target as PointerCaptureTarget : null
}

// 按 runtime id 在 scene 里找对象的**唯一**正确做法。运行期 id 标在 `object.userData[SCENE3D_RUNTIME_ID_KEY]`，
// 而 three 的 `getObjectByProperty(name, value)` 查的是 `object[name]`（顶层属性，非 userData）→ 永远找不到。
// 误用 getObjectByProperty 会静默返回 null（直驱失效、采样为空）——所有按 runtime id 查 scene 对象的代码
// 必须走这个助手，别再碰 getObjectByProperty(SCENE3D_RUNTIME_ID_KEY, ...)。
export function findSceneObjectByRuntimeId(
  root: THREE.Object3D | null | undefined,
  runtimeId: string | null | undefined,
): THREE.Object3D | null {
  if (!root || !runtimeId) return null
  let found: THREE.Object3D | null = null
  root.traverse((object) => {
    if (!found && object.userData?.[SCENE3D_RUNTIME_ID_KEY] === runtimeId) found = object
  })
  return found
}

export function normalizeMannequinBoneName(boneName: string): string {
  return boneName.replace(/^mixamorig:/, 'mixamorig')
}

export function mannequinBoneNameVariants(boneName: string): string[] {
  const normalizedName = normalizeMannequinBoneName(boneName)
  const colonName = normalizedName.replace(/^mixamorig/, 'mixamorig:')
  return Array.from(new Set([boneName, normalizedName, colonName]))
}

export function mannequinPoseOffsetForBone(
  pose: Record<string, Scene3DVector3> | undefined,
  boneName: string,
): Scene3DVector3 | undefined {
  if (!pose) return undefined
  for (const candidate of mannequinBoneNameVariants(boneName)) {
    const rotation = pose[candidate]
    if (rotation) return rotation
  }
  return undefined
}

export function vectorFromArray(value: Scene3DVector3): THREE.Vector3 {
  return new THREE.Vector3(value[0], value[1], value[2])
}

export function vectorToArray(value: THREE.Vector3): Scene3DVector3 {
  return [
    Number(value.x.toFixed(4)),
    Number(value.y.toFixed(4)),
    Number(value.z.toFixed(4)),
  ]
}

export function cameraLookAtRotation(position: Scene3DVector3, target: Scene3DVector3): Scene3DVector3 {
  const cameraObject = new THREE.Object3D()
  cameraObject.position.fromArray(position)
  cameraObject.lookAt(vectorFromArray(target))
  return eulerToArray(cameraObject.rotation)
}

export function levelEditorCameraRotation(position: Scene3DVector3, target: Scene3DVector3): Scene3DVector3 {
  const direction = vectorFromArray(target).sub(vectorFromArray(position))
  if (direction.lengthSq() < 0.000001) return [0, 0, 0]
  direction.normalize()
  const pitch = Math.asin(THREE.MathUtils.clamp(direction.y, -1, 1))
  const yaw = Math.atan2(-direction.x, -direction.z)
  return [
    Number(pitch.toFixed(4)),
    Number(yaw.toFixed(4)),
    0,
  ]
}

export function applyEditorCameraPose(
  camera: THREE.Camera,
  editorCamera: Pick<Scene3DState['editorCamera'], 'position' | 'target'>,
): void {
  const rotation = levelEditorCameraRotation(editorCamera.position, editorCamera.target)
  camera.up.set(0, 1, 0)
  camera.position.fromArray(editorCamera.position)
  camera.rotation.set(rotation[0], rotation[1], rotation[2], 'YXZ')
  camera.updateMatrixWorld(true)
}

export function cameraViewPosition(cameraData: Scene3DCamera): THREE.Vector3 {
  const position = vectorFromArray(cameraData.position)
  const target = vectorFromArray(cameraData.target || CAMERA_DEFAULT_TARGET)
  const direction = target.clone().sub(position)
  const distance = direction.length()
  if (distance < 0.001) return position

  const depth = THREE.MathUtils.clamp(cameraData.lensDepth ?? 0, -100, 100) / 100
  if (Math.abs(depth) < 0.001) return position

  direction.normalize()
  const rawOffset = distance * CAMERA_LENS_DEPTH_MAX_FACTOR * depth
  const safeForwardOffset = Math.max(0, distance - Math.max(cameraData.near ?? 0.1, 0.1) - 0.2)
  const offset = depth > 0 ? Math.min(rawOffset, safeForwardOffset) : rawOffset
  return position.addScaledVector(direction, offset)
}

export function applySceneCameraPose(camera: THREE.Camera, cameraData: Scene3DCamera): void {
  if (camera instanceof THREE.PerspectiveCamera) {
    camera.fov = cameraData.fov
    camera.aspect = SCENE3D_ASPECT_RATIOS[cameraData.aspectRatio]
    camera.near = cameraData.near
    camera.far = cameraData.far
    camera.updateProjectionMatrix()
  }
  camera.position.copy(cameraViewPosition(cameraData))
  camera.lookAt(vectorFromArray(cameraData.target || CAMERA_DEFAULT_TARGET))
  camera.updateMatrixWorld(true)
}

export function editorCameraFromSceneCamera(cameraData: Scene3DCamera): Scene3DState['editorCamera'] {
  const target = cameraData.target || CAMERA_DEFAULT_TARGET
  return {
    position: [...cameraData.position],
    target: [...target],
    rotation: levelEditorCameraRotation(cameraData.position, target),
    mode: 'fly',
  }
}

export function cameraAimSpherical(camera: Scene3DCamera): THREE.Spherical {
  const direction = vectorFromArray(camera.target).sub(vectorFromArray(camera.position))
  if (direction.lengthSq() < 0.0001) direction.set(0, -0.2, 1)
  return new THREE.Spherical().setFromVector3(direction)
}

export function eulerToArray(value: THREE.Euler): Scene3DVector3 {
  return [
    Number(value.x.toFixed(4)),
    Number(value.y.toFixed(4)),
    Number(value.z.toFixed(4)),
  ]
}

export function vectorAlmostEqual(a: Scene3DVector3, b: Scene3DVector3, epsilon = 0.002): boolean {
  return (
    Math.abs(a[0] - b[0]) <= epsilon &&
    Math.abs(a[1] - b[1]) <= epsilon &&
    Math.abs(a[2] - b[2]) <= epsilon
  )
}

export function radiansToDegrees(value: number): number {
  return Number(THREE.MathUtils.radToDeg(value).toFixed(1))
}

export function degreesToRadians(value: number): number {
  return Number(THREE.MathUtils.degToRad(value).toFixed(4))
}

export function crowdRows(object: Scene3DObject): number {
  return Math.min(CROWD_MAX_AXIS, Math.max(1, Math.round(object.crowdRows || 1)))
}

export function crowdColumns(object: Scene3DObject): number {
  return Math.min(CROWD_MAX_AXIS, Math.max(1, Math.round(object.crowdColumns || 1)))
}

export function crowdSpacing(object: Scene3DObject): number {
  return Math.min(10, Math.max(0.2, object.crowdSpacing || 1.2))
}

export function crowdCount(object: Scene3DObject): number {
  return object.type === 'mannequinCrowd' ? crowdRows(object) * crowdColumns(object) : 1
}

export type CameraPoseSample = {
  px: number
  py: number
  pz: number
  rx: number
  ry: number
  rz: number
  tx: number
  ty: number
  tz: number
}

const CAMERA_POSE_EPSILON = 0.0001

export function cameraPoseSampleChanged(
  prev: CameraPoseSample | null,
  next: CameraPoseSample,
  epsilon = CAMERA_POSE_EPSILON,
): boolean {
  if (!prev) return true
  return (
    Math.abs(prev.px - next.px) > epsilon ||
    Math.abs(prev.py - next.py) > epsilon ||
    Math.abs(prev.pz - next.pz) > epsilon ||
    Math.abs(prev.rx - next.rx) > epsilon ||
    Math.abs(prev.ry - next.ry) > epsilon ||
    Math.abs(prev.rz - next.rz) > epsilon ||
    Math.abs(prev.tx - next.tx) > epsilon ||
    Math.abs(prev.ty - next.ty) > epsilon ||
    Math.abs(prev.tz - next.tz) > epsilon
  )
}

export function clonePoseValue(pose?: Record<string, Scene3DVector3>): Record<string, Scene3DVector3> | undefined {
  if (!pose) return undefined
  return Object.fromEntries(
    Object.entries(pose).map(([boneName, rotation]) => [boneName, [...rotation] as Scene3DVector3]),
  )
}

export function poseMatchesPreset(
  pose: Record<string, Scene3DVector3> | undefined,
  preset: { pose?: Record<string, Scene3DVector3> },
): boolean {
  if (!preset.pose) return !pose || Object.keys(pose).length === 0
  if (!pose) return false
  const presetEntries = Object.entries(preset.pose)
  if (presetEntries.length !== Object.keys(pose).length) return false
  return presetEntries.every(([boneName, rotation]) => {
    const currentRotation = pose[boneName]
    return currentRotation ? vectorAlmostEqual(currentRotation, rotation) : false
  })
}

export function rememberMannequinRestPose(root: THREE.Object3D): void {
  root.traverse((object) => {
    if (!(object instanceof THREE.Bone)) return
    object.userData[MANNEQUIN_REST_ROTATION_KEY] = [
      object.rotation.x,
      object.rotation.y,
      object.rotation.z,
    ] satisfies Scene3DVector3
  })
}

// 把所有骨复位到 bind rest（仅清旋转，不叠加任何 pose offset）。
// 离屏从静态动作（如蹲）切回 locomotion 时调一次：mixer 的 walk clip 只驱动它 track 覆盖的骨，
// squat 残留在「walk 不动的骨」（脊/头/部分腿链终端）上会让导出停在蹲姿。先 reset 清掉残留，
// 再让 mixer 在干净 rest 上叠加迈腿，确保「蹲→走」真的站起来走（治 #4 离屏侧根因）。
export function resetMannequinSkeletonToRest(root: THREE.Object3D): void {
  root.traverse((object) => {
    if (!(object instanceof THREE.Bone)) return
    const restRotation = object.userData[MANNEQUIN_REST_ROTATION_KEY] as Scene3DVector3 | undefined
    if (!restRotation) return
    object.rotation.set(restRotation[0], restRotation[1], restRotation[2])
  })
  root.updateMatrixWorld(true)
}

export function applyMannequinSkeletonPose(root: THREE.Object3D, pose?: Record<string, Scene3DVector3>): void {
  root.traverse((object) => {
    if (!(object instanceof THREE.Bone)) return
    const restRotation = object.userData[MANNEQUIN_REST_ROTATION_KEY] as Scene3DVector3 | undefined
    if (!restRotation) return
    object.rotation.set(restRotation[0], restRotation[1], restRotation[2])
  })
  root.traverse((object) => {
    if (!(object instanceof THREE.Bone)) return
    const defaultOffset = MANNEQUIN_DEFAULT_POSE[normalizeMannequinBoneName(object.name)]
    const savedOffset = mannequinPoseOffsetForBone(pose, object.name)
    if (!defaultOffset && !savedOffset) return
    object.rotation.x += (defaultOffset?.[0] || 0) + (savedOffset?.[0] || 0)
    object.rotation.y += (defaultOffset?.[1] || 0) + (savedOffset?.[1] || 0)
    object.rotation.z += (defaultOffset?.[2] || 0) + (savedOffset?.[2] || 0)
  })
  root.updateMatrixWorld(true)
}

// #2 A-hybrid：locomotion 动画态下手臂另走静态「手臂下垂」姿势（腿/髋/脊由 retarget clip 驱动）。
// 只对手臂链骨（肩/大臂/前臂/手）先复位到 bind rest 再叠加 MANNEQUIN_DEFAULT_POSE 里手臂那组 offset
// （= 「站立」预设的手臂下垂基准，单一真相源，不另造），不碰腿/髋/脊（那些此刻被 mixer 写着，碰了会打架）。
// 每帧 mixer.update 后调一次（手臂 offset 是常量，重复叠加幂等：先复位 rest 再加 offset）。
const ARM_DOWN_BONE_PATTERN = /(Shoulder|Arm|ForeArm|Hand)/
function isArmDownBoneName(boneName: string): boolean {
  if (!/(Left|Right)/.test(boneName)) return false
  return ARM_DOWN_BONE_PATTERN.test(boneName)
}

export function applyMannequinArmDownPose(root: THREE.Object3D): void {
  root.traverse((object) => {
    if (!(object instanceof THREE.Bone)) return
    if (!isArmDownBoneName(object.name)) return
    const restRotation = object.userData[MANNEQUIN_REST_ROTATION_KEY] as Scene3DVector3 | undefined
    if (restRotation) object.rotation.set(restRotation[0], restRotation[1], restRotation[2])
    const offset = MANNEQUIN_DEFAULT_POSE[normalizeMannequinBoneName(object.name)]
    if (!offset) return
    object.rotation.x += offset[0]
    object.rotation.y += offset[1]
    object.rotation.z += offset[2]
  })
  root.updateMatrixWorld(true)
}

const MANNEQUIN_GROUND_REF_KEY = 'scene3dGroundRefY'
const MANNEQUIN_GROUND_BASE_KEY = 'scene3dGroundBaseY'

const _groundVertex = new THREE.Vector3()

// 落地参考用「蒙皮后网格的真实最低点」（不是骨骼关节点）。
// 关节点法的坑：脚踝/脚尖关节到鞋底网格的偏移随脚的勾绷（dorsi/plantar-flex）变化，
// 坐/蹲/跪这类脚姿大变的预设会按关节落地 → 鞋底网格悬空或陷地 0.7~0.9 单位（实测）。
// 改用 applyBoneTransform 取每个顶点蒙皮后的世界坐标求最低 Y，任何姿势鞋底/膝盖都精确贴地。
// 仅在姿势变化时跑一次（非每帧），单网格 x-bot 全顶点遍历开销可忽略。
function lowestMannequinLocalY(root: THREE.Object3D): number | null {
  let minY: number | null = null
  root.updateMatrixWorld(true)
  root.traverse((object) => {
    if (!(object instanceof THREE.SkinnedMesh)) return
    const position = object.geometry.getAttribute('position')
    if (!position) return
    for (let i = 0; i < position.count; i += 1) {
      _groundVertex.fromBufferAttribute(position, i)
      object.applyBoneTransform(i, _groundVertex) // 顶点 → 蒙皮变形后（含当前骨骼姿势）的 mesh-local
      object.localToWorld(_groundVertex) // mesh-local → world
      root.worldToLocal(_groundVertex) // world → root-local
      if (minY === null || _groundVertex.y < minY) minY = _groundVertex.y
    }
  })
  if (minY !== null) return minY
  // 兜底：无蒙皮网格（理论不该发生）时退回骨骼关节点。
  const point = new THREE.Vector3()
  root.traverse((object) => {
    if (!(object instanceof THREE.Bone)) return
    object.getWorldPosition(point)
    root.worldToLocal(point)
    if (minY === null || point.y < minY) minY = point.y
  })
  return minY
}

export function captureMannequinGroundReference(root: THREE.Group): void {
  applyMannequinSkeletonPose(root, undefined)
  const inner = root.children[0]
  if (!inner) return
  if (inner.userData[MANNEQUIN_GROUND_BASE_KEY] === undefined) {
    inner.userData[MANNEQUIN_GROUND_BASE_KEY] = inner.position.y
  }
  root.updateMatrixWorld(true)
  const minY = lowestMannequinLocalY(root)
  if (minY !== null) root.userData[MANNEQUIN_GROUND_REF_KEY] = minY
}

export function groundMannequinModel(root: THREE.Group): void {
  const inner = root.children[0]
  const refY = root.userData[MANNEQUIN_GROUND_REF_KEY] as number | undefined
  if (!inner || refY === undefined) return
  const baseY = (inner.userData[MANNEQUIN_GROUND_BASE_KEY] as number | undefined) ?? inner.position.y
  inner.position.y = baseY
  root.updateMatrixWorld(true)
  const minY = lowestMannequinLocalY(root)
  if (minY === null) return
  inner.position.y = baseY + (refY - minY)
  root.updateMatrixWorld(true)
}

export function normalizeMannequinModel(root: THREE.Object3D): THREE.Group {
  root.updateMatrixWorld(true)
  const box = new THREE.Box3().setFromObject(root)
  const size = box.getSize(new THREE.Vector3())
  const center = box.getCenter(new THREE.Vector3())
  const normalized = new THREE.Group()
  const height = Math.max(0.001, size.y)

  root.position.sub(center)
  normalized.scale.setScalar(1 / height)
  normalized.add(root)
  normalized.updateMatrixWorld(true)
  return normalized
}

// ── 焦段 mm ↔ 竖直 FOV（35mm 全幅等效，片高 24mm；three.js 的 fov 就是竖直向）──
// mm 是给摄影师心智的**派生视图**，fov 才是唯一真相（存储/序列化只有 fov）。
// 200mm 长焦 ↔ fov≈6.9°，故相机 fov 域下限为 6（serializer/inspector 同步）。
export const FOCAL_MM_MIN = 12
export const FOCAL_MM_MAX = 200

export function fovToFocalMm(fov: number): number {
  const mm = 12 / Math.tan(THREE.MathUtils.degToRad(fov / 2))
  return Math.round(Math.min(FOCAL_MM_MAX, Math.max(FOCAL_MM_MIN, mm)))
}

export function focalMmToFov(mm: number): number {
  const clamped = Math.min(FOCAL_MM_MAX, Math.max(FOCAL_MM_MIN, mm))
  // 保留 2 位：长焦端 1° 内差好几档 mm，1 位小数会让 mm↔fov 往返漂档（135→134）。
  return Number(THREE.MathUtils.radToDeg(2 * Math.atan(12 / clamped)).toFixed(2))
}

export function aspectDimensions(aspectRatio: Scene3DAspectRatio): { width: number; height: number } {
  const ratio = SCENE3D_ASPECT_RATIOS[aspectRatio]
  const width = 1920
  return {
    width,
    height: Math.max(1, Math.round(width / ratio)),
  }
}

// 运镜参考视频专用：Seedance video_urls 要求参考视频 480P–720P。把全分辨率(1920×1080)按比例缩到
// 720p 上限(长边不超 1280,短边不超 720,16:9 即 1280×720),既满足 Seedance 又让上传体积更小。
// 仅运镜捕获路径调用——不动 aspectDimensions(站位定妆图要全分辨率)。
export function capCameraMoveDimensions(dimensions: { width: number; height: number }): { width: number; height: number } {
  const MAX_LONG = 1280
  const MAX_SHORT = 720
  const { width, height } = dimensions
  if (width <= 0 || height <= 0) return dimensions
  const longSide = Math.max(width, height)
  const shortSide = Math.min(width, height)
  const scale = Math.min(1, MAX_LONG / longSide, MAX_SHORT / shortSide)
  if (scale >= 1) return dimensions
  return {
    width: Math.max(2, Math.round((width * scale) / 2) * 2),
    height: Math.max(2, Math.round((height * scale) / 2) * 2),
  }
}

// 采集本次捕获需要隐藏的 editor-only 对象：带 SCENE3D_EDITOR_ONLY_FLAG 的（gizmo/辅助线/名牌/脚环/轨迹点），
// 及 hideGrid 时的网格。抽成纯函数配单测——「导出产物零 editor-only 元素」是结构保证，不靠逐控件特判
// （2026-07-22 审计 P0：首尾帧把 TransformControls 烧进成片，根因就是该控件没进隐藏集）。
export function collectCaptureHiddenObjects(scene: THREE.Object3D, hideGrid: boolean): THREE.Object3D[] {
  const hidden: THREE.Object3D[] = []
  scene.traverse((object) => {
    if (object.userData?.[SCENE3D_EDITOR_ONLY_FLAG] === true || (hideGrid && object.userData?.[SCENE3D_GRID_FLAG] === true)) {
      hidden.push(object)
    }
  })
  return hidden
}

// 把整棵子树打成 editor-only。TransformControls 这类第三方控件的内部网格由库私有构造，
// 没法在 JSX 上逐个挂 userData——挂载处拿到根后整树打标，captureScene 一律隐藏。
export function tagEditorOnlySubtree(root: THREE.Object3D): void {
  root.traverse((object) => {
    object.userData[SCENE3D_EDITOR_ONLY_FLAG] = true
  })
}

// 捕获尺寸单源：参考视频受 Seedance 720p 上限（capCameraMoveDimensions），静帧（首尾帧）
// 用全分辨率——首尾帧与 MP4 同源采样后，只差分辨率、构图必须一致。
export function captureDimensions(
  aspectRatio: Scene3DAspectRatio,
  sizeMode: 'reference-video' | 'still-frame',
): { width: number; height: number } {
  const dimensions = aspectDimensions(aspectRatio)
  return sizeMode === 'still-frame' ? dimensions : capCameraMoveDimensions(dimensions)
}

export function captureScene(
  gl: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  width: number,
  height: number,
  title: string,
  source: Scene3DCaptureResult['source'],
  hideGrid = false,
): Scene3DCaptureResult | null {
  const helpers = collectCaptureHiddenObjects(scene, hideGrid).map((object) => {
    const entry = { object, visible: object.visible }
    object.visible = false
    return entry
  })

  const previousRenderTarget = gl.getRenderTarget()
  const renderTarget = new THREE.WebGLRenderTarget(width, height, {
    format: THREE.RGBAFormat,
    type: THREE.UnsignedByteType,
  })
  renderTarget.texture.colorSpace = THREE.SRGBColorSpace

  try {
    gl.setRenderTarget(renderTarget)
    gl.clear()
    gl.render(scene, camera)

    const buffer = new Uint8Array(width * height * 4)
    gl.readRenderTargetPixels(renderTarget, 0, 0, width, height, buffer)

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) return null
    const imageData = context.createImageData(width, height)
    for (let y = 0; y < height; y += 1) {
      const sourceRow = (height - y - 1) * width * 4
      const targetRow = y * width * 4
      imageData.data.set(buffer.subarray(sourceRow, sourceRow + width * 4), targetRow)
    }
    context.putImageData(imageData, 0, 0)
    return {
      dataUrl: canvas.toDataURL('image/png'),
      width,
      height,
      title,
      source,
    }
  } finally {
    gl.setRenderTarget(previousRenderTarget)
    helpers.forEach((entry) => {
      entry.object.visible = entry.visible
    })
    renderTarget.dispose()
  }
}

export function roleColorForIndex(index: number): string {
  return ROLE_COLOR_SEQUENCE[index % ROLE_COLOR_SEQUENCE.length]
}

export function mannequinRoleLabel(index: number): string {
  if (index < 26) return `角色${String.fromCharCode(65 + index)}`
  return `角色A${index - 25}`
}

export function clampCrowdOptions(options: CrowdAddOptions): CrowdAddOptions {
  return {
    rows: Math.min(CROWD_MAX_AXIS, Math.max(1, Math.round(options.rows))),
    columns: Math.min(CROWD_MAX_AXIS, Math.max(1, Math.round(options.columns))),
    spacing: Math.min(10, Math.max(0.2, Number(options.spacing.toFixed(2)))),
  }
}

export function makeObject(kind: Scene3DGeometry | 'mannequin' | 'light', roleIndex = 0): Scene3DObject {
  const id = createScene3DObjectId()
  if (kind === 'mannequin') {
    return {
      id,
      name: '假人',
      type: 'mannequin',
      visible: true,
      position: [0, MANNEQUIN_DEFAULT_SCALE[1] * 0.5, 0],
      rotation: [0, 0, 0],
      scale: [...MANNEQUIN_DEFAULT_SCALE],
      color: roleColorForIndex(roleIndex),
    }
  }
  if (kind === 'light') {
    return {
      id,
      name: '点光源',
      type: 'light',
      visible: true,
      position: [2.5, 3.5, 2.5],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      lightType: 'point',
      lightColor: '#ffffff',
      lightIntensity: 2.4,
    }
  }
  const labels: Record<Scene3DGeometry, string> = {
    box: '立方体',
    sphere: '球体',
    cylinder: '圆柱体',
    plane: '平面',
  }
  return {
    id,
    name: labels[kind],
    type: 'mesh',
    visible: true,
    position: kind === 'plane' ? [0, 0, 0] : [0, 0.5, 0],
    rotation: kind === 'plane' ? [-Math.PI / 2, 0, 0] : [0, 0, 0],
    scale: kind === 'plane' ? [4, 4, 4] : [1, 1, 1],
    color: kind === 'plane' ? '#4b5563' : '#7c8ea0',
    geometry: kind,
  }
}

export function makeCrowdObject(options: CrowdAddOptions): Scene3DObject {
  const id = createScene3DObjectId()
  const crowd = clampCrowdOptions(options)
  return {
    id,
    name: `群众(${crowd.rows}x${crowd.columns})`,
    type: 'mannequinCrowd',
    visible: true,
    position: [0, MANNEQUIN_DEFAULT_SCALE[1] * 0.5, 0],
    rotation: [0, 0, 0],
    scale: [...MANNEQUIN_DEFAULT_SCALE],
    crowdRows: crowd.rows,
    crowdColumns: crowd.columns,
    crowdSpacing: crowd.spacing,
  }
}

export function makeCamera(index: number): Scene3DCamera {
  const position: Scene3DVector3 = [4, 2.4, 5]
  const target: Scene3DVector3 = [...CAMERA_DEFAULT_TARGET]
  return {
    id: createScene3DCameraId(),
    name: `相机${index + 1}`,
    visible: true,
    position,
    rotation: cameraLookAtRotation(position, target),
    target,
    fov: 45,
    aspectRatio: '16:9',
    lensDepth: 0,
    near: 0.1,
    far: 200,
  }
}

export function offsetScene3DVector(value: Scene3DVector3, count: number): Scene3DVector3 {
  return [
    Number((value[0] + CLIPBOARD_PASTE_OFFSET[0] * count).toFixed(4)),
    Number((value[1] + CLIPBOARD_PASTE_OFFSET[1] * count).toFixed(4)),
    Number((value[2] + CLIPBOARD_PASTE_OFFSET[2] * count).toFixed(4)),
  ]
}

export function cloneObjectForClipboard(object: Scene3DObject): Scene3DObject {
  return {
    ...object,
    position: [...object.position],
    rotation: [...object.rotation],
    scale: [...object.scale],
    pose: clonePoseValue(object.pose),
    children: object.children ? [...object.children] : undefined,
  }
}

export function cloneCameraForClipboard(camera: Scene3DCamera): Scene3DCamera {
  return {
    ...camera,
    position: [...camera.position],
    rotation: [...camera.rotation],
    target: [...camera.target],
  }
}

export function makePastedObject(object: Scene3DObject, pasteCount: number): Scene3DObject {
  return {
    ...cloneObjectForClipboard(object),
    id: createScene3DObjectId(),
    name: `${object.name} 副本`,
    position: offsetScene3DVector(object.position, pasteCount),
    parentId: undefined,
    children: undefined,
  }
}

export function makePastedCamera(camera: Scene3DCamera, pasteCount: number): Scene3DCamera {
  const position = offsetScene3DVector(camera.position, pasteCount)
  const target = offsetScene3DVector(camera.target, pasteCount)
  return {
    ...cloneCameraForClipboard(camera),
    id: createScene3DCameraId(),
    name: `${camera.name} 副本`,
    position,
    target,
    rotation: cameraLookAtRotation(position, target),
  }
}

export function updateVectorValue(value: Scene3DVector3, index: number, nextValue: number): Scene3DVector3 {
  const next: Scene3DVector3 = [...value]
  next[index] = Number.isFinite(nextValue) ? nextValue : value[index]
  return next
}

export function numberInputValue(value: number): string {
  return Number.isFinite(value) ? String(Number(value.toFixed(3))) : '0'
}

export function isMovementCode(code: string): code is Scene3DMovementCode {
  return MOVEMENT_CODES.has(code)
}

// #3 续：解析 OrbitControls 在「是否跟随角色」下该用的俯仰角(polar angle)上下界。
// 跟随态(操控/录制绕拍角色) → 返回电影构图带 [min,max]，夹住竖向两极（横向方位角不夹=绕圈手感不变），
// 主体猛拖竖向也留在画面内。非跟随态 → 返回 [0, π] = OrbitControls 默认无约束（退出即恢复自由 orbit，零回归）。
// 纯函数（无副作用、可测）：following 由调用方按 !freeLook && followObjectId 判定。
export function followOrbitPolarBounds(following: boolean): { min: number; max: number } {
  if (!following) return { min: 0, max: Math.PI }
  return { min: FOLLOW_ORBIT_MIN_POLAR_ANGLE, max: FOLLOW_ORBIT_MAX_POLAR_ANGLE }
}

export function clearMovementKeyState(keys: Record<Scene3DMovementCode, boolean>): void {
  keys.KeyW = false
  keys.KeyA = false
  keys.KeyS = false
  keys.KeyD = false
  keys.ArrowUp = false
  keys.ArrowDown = false
  keys.ArrowLeft = false
  keys.ArrowRight = false
  keys.Space = false
  keys.ShiftLeft = false
  keys.ShiftRight = false
}

export function hasActiveMovementKey(keys: Record<Scene3DMovementCode, boolean>): boolean {
  return (
    keys.KeyW ||
    keys.KeyA ||
    keys.KeyS ||
    keys.KeyD ||
    keys.ArrowUp ||
    keys.ArrowDown ||
    keys.ArrowLeft ||
    keys.ArrowRight ||
    keys.Space ||
    keys.ShiftLeft ||
    keys.ShiftRight
  )
}
