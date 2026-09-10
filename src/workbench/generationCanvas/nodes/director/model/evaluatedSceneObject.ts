/**
 * [INPUT]: directorTypes、sceneObjectGraph 的共享父链组合、trajectoryEval 的局部位姿求值。
 * [OUTPUT]: evaluateSceneObjectPose：对象与每级祖先在 t 时刻的场景局部位置、完整 frame 与前向水平角。
 * [POS]: 实时机位、特写烘焙、角色视线共用的目标求值边界；sceneConfig 全局变换由渲染消费层统一添加。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md。
 */
import type { DirectorObject, Vec3 } from './directorTypes'
import { objectWorldFrame, type SceneFrame } from './sceneObjectGraph'
import { evaluateEntityTransform, type EvaluatedTransform } from './trajectoryEval'
import { RAD_TO_DEG } from './vec3'

export type EvaluatedSceneObject = { frame: SceneFrame; position: Vec3; yaw: number }

export function evaluateSceneObjectPose(objects: readonly DirectorObject[], objectId: string, time: number, localPoses?: ReadonlyMap<string, EvaluatedTransform>): EvaluatedSceneObject | null {
  if (!objects.some((object) => object.id === objectId)) return null
  const frame = objectWorldFrame(objects, objectId, (object) => {
    const local = localPoses?.get(object.id) ?? evaluateEntityTransform(object, time)
    return { position: local.position, rotation: local.rotation, scale: object.scale }
  })
  // 用完整前向向量取水平角；XYZ 欧拉分解在 >90° 时折叠的 y 不是主体的真实朝向。
  return { frame, position: frame.position, yaw: Math.atan2(frame.basis[2], frame.basis[8]) * RAD_TO_DEG }
}
