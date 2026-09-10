/**
 * [INPUT]: 依赖 react、three、@react-three/fiber 的 useThree/useFrame、@react-three/drei 的 OrbitControls、
 *          ../model/vec3、../model/directorTypes、../model/cameraLens（exportAspectRatio / povVerticalFov）、./cameraMath（cameraQuaternion / THREE_CAMERA_FLIP）、
 *          ./ViewportApiContext、./SceneRegistryContext、../DirectorEditorContext
 *          ../useDirectorHotkeys 的共享输入归属、cameraCoordinateSpace / sceneObjectGraph 的世界↔图层机位转换；持续手势合并撤销
 * [OUTPUT]: 对外提供 ViewCamera（常量与 ViewSettings 见 ./viewSettings）：自由漫游相机（OrbitControls + WASD/EQ 飞行 + 方向键转视角 + Shift 加速）
 *           ⇄ 机位 POV（进入时保存自由视角、退出恢复；Orbit 目标 = 机位前方 5m；用户拖拽/飞行时按编辑层写回机位，否则跟随机位的求值位姿；
 *           画幅非 free 时做 FOV 补偿）；视角归位、聚焦选中、当前视角读取/写入、地面拾取；把命令式 API 写进 ViewportApiRef
 * [POS]: director/scene 的主视口相机控制器（清单 §2.1 V1 导航 + §6 C1 进出机位）。键盘飞行只在指针悬浮视口且焦点不在输入框时生效（O4 作用域）。
 *        录制运镜中不写回机位（录制器采样视口相机，停止时一次生成关键帧）。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import React from 'react'
import * as THREE from 'three'
import { useFrame, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
type OrbitControlsImpl = React.ElementRef<typeof OrbitControls>
import { useDirectorStore, useDirectorStoreApi } from '../DirectorEditorContext'
import { exportAspectRatio, povVerticalFov } from '../model/cameraLens'
import { lookAtAngles } from '../model/vec3'
import type { DirectorCamera, Vec3 } from '../model/directorTypes'
import { RAD_TO_DEG, wrapDeg } from '../model/vec3'
import { cameraQuaternion, THREE_CAMERA_FLIP } from './cameraMath'
import { useSceneRegistry } from './SceneRegistryContext'
import { useViewportApi, type ViewPose } from './ViewportApiContext'
import { FREE_CAMERA_HOME, type ViewSettings } from './viewSettings'
import { isDirectorKeyboardBlocked } from '../useDirectorHotkeys'
import { transformCameraPose } from '../model/cameraCoordinateSpace'
import { invertFrame, sceneFrame } from '../model/sceneObjectGraph'

const MOVE_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyE', 'KeyQ', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight'])
const POV_TARGET_DISTANCE = 5
const WRITE_EPSILON = 1e-4

type FreeViewSnapshot = { position: THREE.Vector3; target: THREE.Vector3; fov: number }
type LogicalPose = { position: Vec3; rotation: Vec3; fov: number }

export function ViewCamera({ settings, hoveredRef }: { settings: ViewSettings; hoveredRef: React.MutableRefObject<boolean> }): JSX.Element {
  const { camera, gl, size } = useThree()
  const orbitRef = React.useRef<OrbitControlsImpl | null>(null)
  const keys = React.useRef<Set<string>>(new Set())
  const registry = useSceneRegistry()
  const apiRef = useViewportApi()
  const store = useDirectorStoreApi()
  const gridHeight = useDirectorStore((state) => state.activeScene().sceneConfig.gridHeight)
  const activeCameraId = useDirectorStore((state) => state.activeCameraId)
  const exportRatio = useDirectorStore((state) => state.project.exportRatio)
  const orbitEnabledRef = React.useRef(true)
  const tmpForward = React.useMemo(() => new THREE.Vector3(), [])
  const tmpRight = React.useMemo(() => new THREE.Vector3(), [])
  const tmpUp = React.useMemo(() => new THREE.Vector3(0, 1, 0), [])
  const raycaster = React.useMemo(() => new THREE.Raycaster(), [])
  const groundPlane = React.useMemo(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), [])
  const povRef = React.useRef<string | null>(null)
  const savedFreeRef = React.useRef<FreeViewSnapshot | null>(null)
  const orbitInteractingRef = React.useRef(false)
  const logicalFovRef = React.useRef<number>(FREE_CAMERA_HOME.fov)
  const lastWrittenRef = React.useRef<LogicalPose | null>(null)
  const viewportSizeRef = React.useRef({ width: size.width, height: size.height })
  viewportSizeRef.current = { width: size.width, height: size.height }
  const exportAspectRef = React.useRef(exportAspectRatio(exportRatio))
  exportAspectRef.current = exportAspectRatio(exportRatio)
  // 角色的「双脚吸附地面」处理器：角色实体挂载时登记（需要蒙皮几何，DOM 面板只能经这里调）

  // 键盘飞行：捕获期监听，只在视口悬浮且非文本焦点时吃键
  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey || isDirectorKeyboardBlocked(event) || !hoveredRef.current || !orbitEnabledRef.current) {
        keys.current.clear()
        return
      }
      if (!MOVE_KEYS.has(event.code)) return
      // 骨骼页聚焦时 W / E 归 IK / FK 切换（useDirectorHotkeys），飞行让出
      if ((event.code === 'KeyW' || event.code === 'KeyE') && store.getState().isSkeletonEditing) return
      if (!event.code.startsWith('Shift') && ![...keys.current].some((code) => !code.startsWith('Shift')) && povRef.current && !store.getState().recording) store.getState().saveState()
      keys.current.add(event.code)
      if (event.code.startsWith('Arrow')) event.preventDefault()
    }
    const onKeyUp = (event: KeyboardEvent) => {
      keys.current.delete(event.code)
      if (['Meta', 'Control', 'Alt'].includes(event.key)) keys.current.clear()
    }
    const onBlur = () => keys.current.clear()
    window.addEventListener('keydown', onKeyDown, { capture: true })
    window.addEventListener('keyup', onKeyUp, { capture: true })
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKeyDown, { capture: true })
      window.removeEventListener('keyup', onKeyUp, { capture: true })
      window.removeEventListener('blur', onBlur)
    }
  }, [store, hoveredRef])

  const readPose = React.useCallback((): ViewPose => {
    // 逻辑朝向：yaw 从 +Z 起、pitch 正=俯视（three 相机看 −Z，需翻 180°）
    const flipped = camera.quaternion.clone().multiply(new THREE.Quaternion(0, 1, 0, 0))
    const euler = new THREE.Euler().setFromQuaternion(flipped, 'YXZ')
    const persp = camera as THREE.PerspectiveCamera
    return {
      position: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
      yaw: Number(wrapDeg(euler.y * RAD_TO_DEG).toFixed(2)),
      pitch: Number(Math.max(-90, Math.min(90, euler.x * RAD_TO_DEG)).toFixed(2)),
      roll: Number((euler.z * RAD_TO_DEG).toFixed(2)),
      // POV 下 three 相机的 fov 含画幅补偿，对外报机位自己的逻辑 fov
      fov: povRef.current ? logicalFovRef.current : persp.fov,
    }
  }, [camera])

  // 把机位数据位姿套到 three 相机上（含 FOV 补偿），Orbit 目标放到机位前方 5m
  const applyCameraPose = React.useCallback(
    (pose: LogicalPose) => {
      const persp = camera as THREE.PerspectiveCamera
      camera.position.set(pose.position.x, pose.position.y, pose.position.z)
      camera.quaternion.copy(cameraQuaternion(pose.rotation.x, pose.rotation.y, pose.rotation.z)).multiply(THREE_CAMERA_FLIP)
      logicalFovRef.current = pose.fov
      const compensated = povVerticalFov(pose.fov, exportAspectRef.current, viewportSizeRef.current.width, viewportSizeRef.current.height)
      if (Math.abs(persp.fov - compensated) > 1e-3) {
        persp.fov = compensated
        persp.updateProjectionMatrix()
      }
      const orbit = orbitRef.current
      if (orbit) {
        camera.getWorldDirection(tmpForward)
        orbit.target.copy(camera.position).addScaledVector(tmpForward, POV_TARGET_DISTANCE)
        orbit.update()
      }
      lastWrittenRef.current = pose
    },
    [camera, tmpForward],
  )

  const cameraDataPose = React.useCallback(
    (data: DirectorCamera): LogicalPose => {
      const evaluated = store.getState().evaluatedPoses[data.id]
      const rotation = evaluated?.rotation ?? { x: data.pitch, y: data.yaw, z: data.roll }
      const world = transformCameraPose({ position: evaluated?.position ?? data.position, pitch: rotation.x, yaw: rotation.y, roll: rotation.z, fov: evaluated?.fov ?? data.fov }, sceneFrame(store.getState().activeScene().sceneConfig))
      return {
        position: world.position,
        rotation: { x: world.pitch, y: world.yaw, z: world.roll },
        fov: world.fov,
      }
    },
    [store],
  )

  // 进出 POV：进入时保存自由视角，退出恢复；机位之间切换直接套新机位
  React.useEffect(() => {
    const persp = camera as THREE.PerspectiveCamera
    const orbit = orbitRef.current
    const previous = povRef.current
    if (activeCameraId === 'free') {
      povRef.current = null
      const saved = savedFreeRef.current
      if (previous && saved) {
        camera.position.copy(saved.position)
        persp.fov = saved.fov
        persp.updateProjectionMatrix()
        if (orbit) {
          orbit.target.copy(saved.target)
          orbit.update()
        }
        savedFreeRef.current = null
      }
      logicalFovRef.current = persp.fov
      lastWrittenRef.current = null
      return
    }
    const data = store.getState().findCamera(activeCameraId)
    if (!data) {
      store.getState().exitCameraPOV()
      return
    }
    if (!previous && orbit) {
      savedFreeRef.current = { position: camera.position.clone(), target: orbit.target.clone(), fov: persp.fov }
    }
    povRef.current = activeCameraId
    applyCameraPose(cameraDataPose(data))
  }, [activeCameraId, applyCameraPose, camera, cameraDataPose, store])

  React.useEffect(() => {
    apiRef.current = {
      resetView: () => {
        const orbit = orbitRef.current
        const pov = povRef.current
        if (pov) {
          // 「重置当前视角」在 POV 里：saveState 后把机位搬回自由相机的家（0, 1.7, 10），朝向看向原点
          const state = store.getState()
          if (state.recording) return
          const data = state.findCamera(pov)
          if (!data) return
          const angles = lookAtAngles(FREE_CAMERA_HOME.position, FREE_CAMERA_HOME.target)
          const local = transformCameraPose({ position: { ...FREE_CAMERA_HOME.position }, ...angles, fov: data.fov }, invertFrame(sceneFrame(state.activeScene().sceneConfig)))
          state.saveState()
          state.writeCameraSpatialTransform(pov, { position: local.position, rotation: { x: local.pitch, y: local.yaw, z: local.roll } })
          return
        }
        camera.position.set(FREE_CAMERA_HOME.position.x, FREE_CAMERA_HOME.position.y, FREE_CAMERA_HOME.position.z)
        ;(camera as THREE.PerspectiveCamera).fov = FREE_CAMERA_HOME.fov
        ;(camera as THREE.PerspectiveCamera).updateProjectionMatrix()
        if (orbit) {
          orbit.target.set(FREE_CAMERA_HOME.target.x, FREE_CAMERA_HOME.target.y, FREE_CAMERA_HOME.target.z)
          orbit.update()
        }
      },
      // 聚焦（F）：目标 = 实体世界位；相机沿「相机 − 目标」方向退到 4m（原向量 < 0.1 用 (3,3,5) 方向），POV 里同样生效并写回机位
      focusEntity: (entityId) => {
        const object = registry.get(entityId)
        const orbit = orbitRef.current
        if (!object || !orbit) return
        const center = object.getWorldPosition(new THREE.Vector3())
        const offset = camera.position.clone().sub(center)
        if (offset.length() < 0.1) offset.set(3, 3, 5)
        offset.normalize().multiplyScalar(4)
        orbit.target.copy(center)
        camera.position.copy(center).add(offset)
        camera.lookAt(center)
        orbit.update()
        const pov = povRef.current
        const state = store.getState()
        if (pov && !state.recording) {
          const pose = transformCameraPose(readPose(), invertFrame(sceneFrame(state.activeScene().sceneConfig)))
          const result = state.withHistory(() => state.writeCameraSpatialTransform(pov, { position: pose.position, rotation: { x: pose.pitch, y: pose.yaw, z: pose.roll } }))
          const data = state.findCamera(pov)
          if (!result.applied && data) applyCameraPose(cameraDataPose(data))
        }
      },
      getViewPose: readPose,
      applyViewPose: (pose) => {
        applyCameraPose({ position: pose.position, rotation: { x: pose.pitch, y: pose.yaw, z: pose.roll }, fov: pose.fov })
      },
      setOrbitEnabled: (enabled) => {
        orbitEnabledRef.current = enabled
        if (orbitRef.current) orbitRef.current.enabled = enabled
      },
      groundPointFromClient: (clientX, clientY) => {
        const rect = gl.domElement.getBoundingClientRect()
        const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1)
        raycaster.setFromCamera(ndc, camera)
        groundPlane.constant = -gridHeight
        const hit = new THREE.Vector3()
        if (!raycaster.ray.intersectPlane(groundPlane, hit)) return null
        if (raycaster.ray.origin.distanceTo(hit) > 160) return null
        return { x: hit.x, y: hit.y, z: hit.z }
      },
      snapCharacterFeet: (objectId) => {
        registry.snapFeet(objectId)
      },
      captureFrame: (request) => registry.captureFrame(request),
      getViewportSize: () => ({ width: gl.domElement.clientWidth, height: gl.domElement.clientHeight }),
    }
    return () => {
      apiRef.current = null
    }
  }, [apiRef, applyCameraPose, camera, cameraDataPose, gl.domElement, gridHeight, groundPlane, raycaster, readPose, registry, store])

  // 键盘飞行
  useFrame((_, delta) => {
    const pressed = keys.current
    if (!hoveredRef.current || !orbitEnabledRef.current || isDirectorKeyboardBlocked({ target: document.activeElement, defaultPrevented: false, isComposing: false })) {
      pressed.clear()
      return
    }
    if (pressed.size === 0) return
    const orbit = orbitRef.current
    const boost = pressed.has('ShiftLeft') || pressed.has('ShiftRight') ? 2 : 1
    const step = settings.roamSpeed * boost * Math.min(delta, 0.1)
    camera.getWorldDirection(tmpForward)
    // WASD 沿水平面漫游，俯视不会把前进变成下降；只有 E/Q 改高度。
    tmpForward.y = 0
    tmpForward.normalize()
    tmpRight.crossVectors(tmpForward, tmpUp).normalize()
    const move = new THREE.Vector3()
    if (pressed.has('KeyW')) move.addScaledVector(tmpForward, step)
    if (pressed.has('KeyS')) move.addScaledVector(tmpForward, -step)
    if (pressed.has('KeyD')) move.addScaledVector(tmpRight, step)
    if (pressed.has('KeyA')) move.addScaledVector(tmpRight, -step)
    if (pressed.has('KeyE')) move.y += step
    if (pressed.has('KeyQ')) move.y -= step
    if (move.lengthSq() > 0) {
      camera.position.add(move)
      if (orbit) orbit.target.add(move)
    }
    const turn = settings.roamRotateSpeed * boost * Math.min(delta, 0.1)
    let yawDelta = 0
    let pitchDelta = 0
    if (pressed.has('ArrowLeft')) yawDelta += turn
    if (pressed.has('ArrowRight')) yawDelta -= turn
    if (pressed.has('ArrowUp')) pitchDelta += turn
    if (pressed.has('ArrowDown')) pitchDelta -= turn
    if ((yawDelta !== 0 || pitchDelta !== 0) && orbit) {
      // 方向键与 Orbit 共用目标点和球坐标，相机绕目标转，目标保持不动。
      const spherical = new THREE.Spherical().setFromVector3(camera.position.clone().sub(orbit.target))
      spherical.theta -= yawDelta
      spherical.phi -= pitchDelta
      spherical.makeSafe()
      camera.position.copy(orbit.target).add(new THREE.Vector3().setFromSpherical(spherical))
      camera.lookAt(orbit.target)
    }
    orbit?.update()
  })

  // POV 同步（在求值循环之后、描边渲染之前）：用户在动 → 按编辑层写回；否则跟随机位数据
  useFrame(() => {
    const pov = povRef.current
    if (!pov) return
    const state = store.getState()
    const data = state.findCamera(pov)
    if (!data) return
    const userDriven = orbitInteractingRef.current || keys.current.size > 0
    if (state.recording?.cameraId === pov) {
      // 录制中：视口相机就是真相，采样由录制器做；只保持 fov 补偿
      const persp = camera as THREE.PerspectiveCamera
      const compensated = povVerticalFov(data.fov, exportAspectRef.current, viewportSizeRef.current.width, viewportSizeRef.current.height)
      logicalFovRef.current = data.fov
      if (Math.abs(persp.fov - compensated) > 1e-3) {
        persp.fov = compensated
        persp.updateProjectionMatrix()
      }
      return
    }
    if (userDriven) {
      const pose = readPose()
      const last = lastWrittenRef.current
      const moved =
        !last ||
        Math.abs(last.position.x - pose.position.x) > WRITE_EPSILON ||
        Math.abs(last.position.y - pose.position.y) > WRITE_EPSILON ||
        Math.abs(last.position.z - pose.position.z) > WRITE_EPSILON ||
        Math.abs(last.rotation.y - pose.yaw) > WRITE_EPSILON ||
        Math.abs(last.rotation.x - pose.pitch) > WRITE_EPSILON ||
        Math.abs(last.rotation.z - pose.roll) > WRITE_EPSILON
      if (!moved) return
      const local = transformCameraPose(pose, invertFrame(sceneFrame(state.activeScene().sceneConfig)))
      const result = state.writeCameraSpatialTransform(pov, { position: local.position, rotation: { x: local.pitch, y: local.yaw, z: local.roll } })
      if (result.applied) {
        lastWrittenRef.current = { position: pose.position, rotation: { x: pose.pitch, y: pose.yaw, z: pose.roll }, fov: data.fov }
      } else {
        // 只读层（片段内、不在路标上）：拒绝漂移，弹回求值位姿
        applyCameraPose(cameraDataPose(data))
      }
      return
    }
    const target = cameraDataPose(data)
    const last = lastWrittenRef.current
    const same =
      last &&
      last.fov === target.fov &&
      last.position.x === target.position.x &&
      last.position.y === target.position.y &&
      last.position.z === target.position.z &&
      last.rotation.x === target.rotation.x &&
      last.rotation.y === target.rotation.y &&
      last.rotation.z === target.rotation.z
    if (!same) applyCameraPose(target)
  }, 0.5)

  return (
    <OrbitControls
      ref={orbitRef}
      makeDefault
      enableDamping
      dampingFactor={settings.dampingFactor}
      rotateSpeed={settings.rotateSensitivity}
      panSpeed={settings.panSensitivity}
      zoomSpeed={1}
      target={[FREE_CAMERA_HOME.target.x, FREE_CAMERA_HOME.target.y, FREE_CAMERA_HOME.target.z]}
      mouseButtons={{ LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN }}
      onStart={() => {
        orbitInteractingRef.current = true
        if (povRef.current && !store.getState().recording) store.getState().saveState()
      }}
      onEnd={() => {
        orbitInteractingRef.current = false
      }}
    />
  )
}
