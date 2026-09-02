// 3D 场景对象/相机的**显示名**——派生,不落盘。
//
// 为什么不是「创建时写个默认名存进去」(2026-09-02 改掉的就是那个):
//   `name` 是**用户可改、且会写进项目文件**的字段(inspector 里有输入框,serializer 原样存取)。
//   创建时写死 '假人'/'相机1' 有两个后果:① 英文界面照样显示中文;
//   ② 就算改成创建时按当前语言翻译,也会把**作者那一刻的语言烤进项目文件**——
//      英文环境建的项目,中文用户打开永远看到 "Mannequin 1"。持久化数据不该带语言。
//
// 正确形状:**空名 = 用户没起过名**,显示时按「类型 + 序号」现算一个本地化默认名;
// 用户一旦改名,那串就是他的数据,原样存、原样显示、不翻译。
// 空串是语言中立的哨兵,不是文案——所以不需要迁移:老项目里存着 '假人' 的对象非空,
// 走「用户已命名」分支原样显示,打开体验与改动前完全一致。
//
// 假人的默认名直接复用 mannequinRoleLabel(角色A/B/…):它本来就是 3D 视口里那个角色徽标用的
// 本地化标签,场景树与视口从此同名,也顺带治掉「两个假人都叫『假人』」的重名。
// (P1:不另造一套并行的角色命名。)

import i18n from '../../../../i18n'
import {
  crowdCount,
} from './scene3dConstants'
import type { Scene3DCamera, Scene3DObject, Scene3DTrajectory, Scene3DTrajectoryGroup } from './scene3dTypes'

/** 用户起过名吗。空/纯空白 = 没起过,显示时现算默认名。 */
export function hasUserGivenName(name: string | undefined): boolean {
  return Boolean(name?.trim())
}

/**
 * 对象在同类里的序号(0 基)。假人与群众共用一条「角色号」序列——
 * 与 scene3dInspector 的场景树、scene3dSceneContent 的视口徽标同一套算法,
 * 保证树里写「角色B」时视口上浮的也是「角色B」。
 */
function roleIndexOf(object: Scene3DObject, objects: readonly Scene3DObject[]): number {
  let roleIndex = 0
  for (const candidate of objects) {
    if (candidate.id === object.id) return roleIndex
    if (candidate.type === 'mannequin') roleIndex += 1
    else if (candidate.type === 'mannequinCrowd') roleIndex += crowdCount(candidate)
  }
  return roleIndex
}

/** 同类对象里的第几个(1 基),给灯光/网格这类按序号命名的用。 */
function ordinalOfType(object: Scene3DObject, objects: readonly Scene3DObject[]): number {
  let ordinal = 0
  for (const candidate of objects) {
    if (candidate.type === object.type) ordinal += 1
    if (candidate.id === object.id) return ordinal
  }
  return ordinal || 1
}

/** 场景对象的显示名:用户起过名就用他的,否则按类型现算一个本地化默认名。 */
export function scene3dObjectDisplayName(object: Scene3DObject, objects: readonly Scene3DObject[]): string {
  if (hasUserGivenName(object.name)) return object.name
  if (object.type === 'mannequin') return mannequinRoleLabel(roleIndexOf(object, objects))
  if (object.type === 'mannequinCrowd') {
    return i18n.t('scene3d.objectName.crowd', {
      rows: object.crowdRows ?? 1,
      columns: object.crowdColumns ?? 1,
    })
  }
  if (object.type === 'light') return i18n.t('scene3d.objectName.light', { index: ordinalOfType(object, objects) })
  return i18n.t('scene3d.objectName.fallback', { index: ordinalOfType(object, objects) })
}

/** 相机的显示名:同上,默认「相机N」按它在相机列表里的位置现算。 */
export function scene3dCameraDisplayName(camera: Scene3DCamera, cameras: readonly Scene3DCamera[]): string {
  if (hasUserGivenName(camera.name)) return camera.name
  const index = cameras.findIndex((candidate) => candidate.id === camera.id)
  return i18n.t('scene3d.objectName.camera', { index: (index < 0 ? cameras.length : index) + 1 })
}

/**
 * 复制出来的那份叫什么。
 * 源没起过名 → 副本也不起名(它会自己按序号算一个,不会出现「 副本」这种空前缀)。
 * 源起过名 → 承接用户那串加「副本」后缀:这时它已经是用户数据,落盘是对的。
 */
export function scene3dCopiedName(sourceName: string): string {
  if (!hasUserGivenName(sourceName)) return ''
  return i18n.t('scene3d.objectName.copy', { name: sourceName })
}

/** 角色徽标/默认名:角色A、角色B…… 超过 26 个走 A1、A2 溢出式。
 *  3D 视口徽标与场景树默认名共用这一个,别再另造一套。 */
export function mannequinRoleLabel(index: number): string {
  if (index < 26) return i18n.t('scene3d.mannequinName', { letter: String.fromCharCode(65 + index) })
  return i18n.t('scene3d.mannequinNameOverflow', { index: index - 25 })
}

/** 轨迹显示名:和对象/相机同一套——没起名就按它在轨迹列表里的位置现算「轨迹N」。 */
export function scene3dTrajectoryDisplayName(
  trajectory: Scene3DTrajectory,
  trajectories: readonly Scene3DTrajectory[],
): string {
  if (hasUserGivenName(trajectory.name)) return trajectory.name
  const index = trajectories.findIndex((candidate) => candidate.id === trajectory.id)
  return i18n.t('scene3d.objectName.trajectory', { index: (index < 0 ? trajectories.length : index) + 1 })
}

/** 轨迹分组显示名,同上。 */
export function scene3dTrajectoryGroupDisplayName(
  group: Scene3DTrajectoryGroup,
  groups: readonly Scene3DTrajectoryGroup[],
): string {
  if (hasUserGivenName(group.name)) return group.name
  const index = groups.findIndex((candidate) => candidate.id === group.id)
  return i18n.t('scene3d.objectName.group', { index: (index < 0 ? groups.length : index) + 1 })
}

/**
 * 录 take 生成的轨迹名(「角色A 走位」)。
 * 这条**故意在创建时就合成**、与上面几个派生显示名不同:它带的是「属于哪个角色」这层关系,
 * 而轨迹列表/时间线面板拿不到 trajectoryBindings,显示时反查不出来。
 * 代价写在词条注释里:这一条会把创建时的语言写进项目文件。面板能拿到 bindings 后应改为显示时派生。
 */
export function scene3dCharacterMovementName(characterDisplayName: string): string {
  return i18n.t('scene3d.objectName.characterMovement', { name: characterDisplayName })
}
