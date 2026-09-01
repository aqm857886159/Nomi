// Scene3D 轨迹领域纯函数——现仅剩两个「跨钩子共享」的读取/清理函数：
//   · removeTrajectoryBindingsForNode —— useScene3DFullscreenActions 删节点时解绑其轨迹
//   · trajectoryBindTargetsFromState  —— useScene3DTrajectoryEditing 列出可绑定的目标
// 其余轨迹编辑纯函数原本只服务已删除的 useScene3DTrajectoryEditor（死钩子），随之一并移除。
// 注：活钩子 useScene3DTrajectoryEditing 目前内联了自己的等价实现（P1 待收敛：
// 真正根治是让活钩子改用共享纯函数，但那需改动活钩子，超出本次死码清理范围）。
import type { Scene3DState, Scene3DVector3 } from './scene3dTypes'
import { setScene3DObjectRuntimeRefsVisible } from './trajectory/trajectoryRuntimeStore'
import { findObjectTrajectoryBinding, sceneObjectTrajectorySample } from './scene3dPlayback'
import type { TrajectoryBindTarget } from './trajectory/trajectoryRendererShared'
import { scene3dCameraDisplayName, scene3dObjectDisplayName } from './scene3dObjectNames'

export function removeTrajectoryBindingsForNode(state: Scene3DState, objectId: string): Scene3DState {
  let changed = false
  const trajectoryBindings = state.trajectoryBindings.flatMap((binding) => {
    const hadObject = binding.objects.some((object) => object.objectId === objectId)
    if (!hadObject) return [binding]
    changed = true
    setScene3DObjectRuntimeRefsVisible(objectId, true)
    const objects = binding.objects.filter((object) => object.objectId !== objectId)
    return objects.length > 0 ? [{ ...binding, objects }] : []
  })

  if (!changed) return state
  return {
    ...state,
    trajectoryBindings,
  }
}

function translatePoint(position: Scene3DVector3, delta: Scene3DVector3): Scene3DVector3 {
  return [position[0] + delta[0], position[1] + delta[1], position[2] + delta[2]]
}

/**
 * 「松手即对齐」：用户拖完一个**绑了轨迹**的对象后，把它的轨迹整条刚体平移，使
 * `sample@当前播放头 == 松手位置`——直驱层恢复盖章时球就停在手放开的地方，不回跳，
 * 轨迹与机位重新咬合（与「拖轨迹线整条平移」同语义）。
 * 无绑定 / 采样不出 / 位移≈0（如 aim 拖拽只动 target）一律返回**原引用**，
 * setState 直接 bail-out——未绑定的普通拖拽零回归。
 */
export function translateBoundTrajectoryToHeldPosition(
  state: Scene3DState,
  objectId: string,
  playheadSeconds: number,
  heldPosition: Scene3DVector3,
): Scene3DState {
  const binding = findObjectTrajectoryBinding(state, objectId)
  if (!binding) return state
  const sample = sceneObjectTrajectorySample(state, objectId, playheadSeconds)
  if (!sample) return state
  const delta: Scene3DVector3 = [
    heldPosition[0] - sample.position.x,
    heldPosition[1] - sample.position.y,
    heldPosition[2] - sample.position.z,
  ]
  if (Math.hypot(delta[0], delta[1], delta[2]) < 1e-4) return state
  return {
    ...state,
    trajectories: state.trajectories.map((trajectory) => (
      trajectory.id === binding.trajectoryId
        ? {
            ...trajectory,
            points: trajectory.points.map((point) => ({
              ...point,
              position: translatePoint(point.position, delta),
            })),
            curveControls: trajectory.curveControls?.map((control) => ({
              ...control,
              position: translatePoint(control.position, delta),
            })),
          }
        : trajectory
    )),
  }
}

export function trajectoryBindTargetsFromState(state: Scene3DState): TrajectoryBindTarget[] {
  const boundObjectIds = new Set(
    state.trajectoryBindings.flatMap((binding) => binding.objects.map((object) => object.objectId)),
  )
  return [
    ...state.objects
      .filter((object) => (
        (object.type === 'mannequin' || object.type === 'mannequinCrowd') &&
        !boundObjectIds.has(object.id)
      ))
      .map((object) => ({
        id: object.id,
        name: scene3dObjectDisplayName(object, state.objects),
        type: 'mannequin' as const,
      })),
    ...state.cameras
      .filter((camera) => !boundObjectIds.has(camera.id))
      .map((camera) => ({
        id: camera.id,
        name: scene3dCameraDisplayName(camera, state.cameras),
        type: 'camera' as const,
      })),
  ]
}
