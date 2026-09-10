/**
 * [INPUT]: 无依赖（叶子模块）
 * [OUTPUT]: 对外提供 createDirectorId 与按前缀的工厂：createSceneId / createObjectId / createCameraId / createLightId /
 *           createWaypointId / createClipId / createKeyframeId / createOutputId
 * [POS]: director/model 的 id 单一真相（与 V1 scene3dBindingIds 同规则、不同前缀，避免跨版本撞 id）；
 *        工厂/store/剪贴板/录制都从这里取 id，时间戳 + 随机后缀保证同工程内唯一。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

export function createDirectorId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

export const createSceneId = (): string => createDirectorId('dscene')
export const createObjectId = (): string => createDirectorId('dobj')
export const createCameraId = (): string => createDirectorId('dcam')
export const createLightId = (): string => createDirectorId('dlight')
export const createWaypointId = (): string => createDirectorId('dwp')
export const createClipId = (kind: 'traj' | 'action' | 'closeup' | 'lookat'): string => createDirectorId(`d${kind}`)
export const createKeyframeId = (): string => createDirectorId('dbkf')
export const createOutputId = (): string => createDirectorId('dout')
