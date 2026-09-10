/**
 * [INPUT]: 依赖 ./directorTypes 的 DirectorLight / DirectorLightType / Vec3
 * [OUTPUT]: 对外提供 LIGHT_DEFAULTS、createLight、LIGHT_TEMPERATURE_PRESETS、LIGHT_QUICK_ORIENTATIONS
 * [POS]: director/model 的灯光单一真相（清单 §4.3 灯光检查器 + §2.2 创建栏灯光）：三种灯的默认位姿/强度、
 *        7 个影视色温预设、4 个快捷照射朝向，
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { DirectorLight, DirectorLightType, Vec3 } from './directorTypes'

type LightDefault = { position: Vec3; yaw: number; pitch: number; intensity: number }

export const LIGHT_DEFAULTS: Record<DirectorLightType, LightDefault> = {
  directional: { position: { x: 4, y: 7, z: 4 }, yaw: 45, pitch: -45, intensity: 1 },
  point: { position: { x: 0, y: 3, z: 0 }, yaw: 0, pitch: 0, intensity: 1.5 },
  spot: { position: { x: 3, y: 5.5, z: 3 }, yaw: 45, pitch: -45, intensity: 2 },
}

export const LIGHT_TEMPERATURE_PRESETS = [
  { id: 'kelvin_3200', color: '#ffb469', kelvin: 3200 },
  { id: 'kelvin_4500', color: '#ffe4ce', kelvin: 4500 },
  { id: 'kelvin_5600', color: '#ffffff', kelvin: 5600 },
  { id: 'kelvin_6500', color: '#dbe7ff', kelvin: 6500 },
  { id: 'moonlight', color: '#7cb5ec' },
  { id: 'cyber_pink', color: '#ff4b91' },
  { id: 'amber_orange', color: '#ff8c00' },
] as const
export type LightTemperaturePresetId = (typeof LIGHT_TEMPERATURE_PRESETS)[number]['id']

// 快捷照射朝向（yaw/pitch，度）：斜下 45° 主光 / 垂直顶光 / 正前平射 / 侧逆轮廓光
export const LIGHT_QUICK_ORIENTATIONS = [
  { id: 'key_45', yaw: 45, pitch: -45 },
  { id: 'top_90', yaw: 0, pitch: -90 },
  { id: 'front_flat', yaw: 0, pitch: 0 },
  { id: 'rim_side', yaw: 135, pitch: -30 },
] as const
export type LightQuickOrientationId = (typeof LIGHT_QUICK_ORIENTATIONS)[number]['id']

export function createLight(type: DirectorLightType, id: string, name: string, overrides: Partial<DirectorLight> = {}): DirectorLight {
  const base = LIGHT_DEFAULTS[type]
  return {
    id,
    name,
    type,
    color: '#ffffff',
    intensity: base.intensity,
    position: { ...base.position },
    yaw: base.yaw,
    pitch: base.pitch,
    enabled: true,
    visible: true,
    locked: false,
    castShadow: true,
    spotAngle: type === 'spot' ? 45 : undefined,
    spotPenumbra: type === 'spot' ? 0.3 : undefined,
    distance: 0,
    decay: 2,
    ...overrides,
  }
}
