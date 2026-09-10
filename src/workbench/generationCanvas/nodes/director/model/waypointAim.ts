/**
 * [INPUT]: directorTypes、trajectoryEval、sceneObjectGraph 的父空间仿射边界、vec3 朝向数学。
 * [OUTPUT]: waypointAimAngles：按路标时刻采样目标，转换到源父空间后一次烘焙朝向。
 * [POS]: 单点/批量路标看向共用纯求值层；lookAtObjectId 只记下拉选择，不构成动态跟踪。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md。
 */
import { isDirectorCamera, type DirectorObject, type DirectorScene, type TimelineEntity, type Waypoint } from './directorTypes'
import { invertFrame, objectWorldFrame, transformPoint } from './sceneObjectGraph'
import { evaluateEntityTransform } from './trajectoryEval'
import { lookAtAngles, RAD_TO_DEG, sub, wrapDeg } from './vec3'

export function waypointAimAngles(scene: DirectorScene, source: TimelineEntity, point: Waypoint, target: DirectorObject) {
  const evaluated = scene.objects.map(object => ({ ...object, ...evaluateEntityTransform(object, point.time) }))
  const targetPosition = objectWorldFrame(evaluated, target.id).position
  // 路标看向固定取角色上方 1.2m，其他对象取原点。
  const aimPosition = { ...targetPosition, y: targetPosition.y + (target.type === 'character' ? 1.2 : 0) }
  const sourceParent = isDirectorCamera(source) ? undefined : source.parentId
  const parentFrame = objectWorldFrame(evaluated, sourceParent)
  const localTarget = transformPoint(invertFrame(parentFrame), aimPosition)
  const position = { x: point.x, y: point.y, z: point.z }
  if (isDirectorCamera(source)) return lookAtAngles(position, localTarget)
  // 对象根是 XYZ，相机是 YXZ；两者同时有 yaw/pitch 时不能共用欧拉值。
  // XYZ 且 roll=0 的 +Z 为 (sin(yaw), -sin(pitch)cos(yaw), cos(pitch)cos(yaw))。
  const direction = sub(localTarget, position)
  let pitch = Math.atan2(-direction.y, direction.z) * RAD_TO_DEG
  let yaw = Math.atan2(direction.x, Math.hypot(direction.y, direction.z)) * RAD_TO_DEG
  if (pitch > 90) { pitch -= 180; yaw = 180 - yaw }
  if (pitch < -90) { pitch += 180; yaw = 180 - yaw }
  return { yaw: Number(wrapDeg(yaw).toFixed(2)), pitch: Number(pitch.toFixed(2)), roll: 0 }
}
