/**
 * [INPUT]: 依赖 ../model/directorTypes 的 Vec3、./sceneTheme 的 DirectorViewportTheme
 * [OUTPUT]: 对外提供 FREE_CAMERA_HOME、ViewSettings、DEFAULT_VIEW_SETTINGS、VIEW_SETTING_RANGES、
 *           DirectorPreferences、DEFAULT_DIRECTOR_PREFERENCES、readDirectorPreferences / writeDirectorPreferences
 * [POS]: director/scene 的视口常量与偏好（自由相机归位位姿、漫游/灵敏度默认值与取值范围、视口主题）；
 *        偏好只存本机 localStorage（不入工程、不进撤销栈），设置对话框改、ViewCamera / SkyGround 读。
 *        与组件分文件放，保证 Fast Refresh 与 lint 干净。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { Vec3 } from '../model/directorTypes'
import type { DirectorViewportTheme } from './sceneTheme'

export const FREE_CAMERA_HOME: { position: Vec3; target: Vec3; fov: number } = {
  position: { x: 0, y: 1.7, z: 10 },
  target: { x: 0, y: 0, z: 0 },
  fov: 50,
}

export type ViewSettings = {
  roamSpeed: number // m/s
  roamRotateSpeed: number // rad/s
  rotateSensitivity: number
  panSensitivity: number
  dampingFactor: number
}

// 漫游 5 m/s、转向 1 rad/s、旋转 / 平移灵敏度 1、阻尼 0.15
export const DEFAULT_VIEW_SETTINGS: ViewSettings = { roamSpeed: 5, roamRotateSpeed: 1, rotateSensitivity: 1, panSensitivity: 1, dampingFactor: 0.15 }

// 设置对话框的滑条范围单一真相；越界值读回来时夹到范围内
export const VIEW_SETTING_RANGES: Record<keyof ViewSettings, { min: number; max: number; step: number }> = {
  roamSpeed: { min: 0.5, max: 30, step: 0.1 },
  roamRotateSpeed: { min: 0.2, max: 5, step: 0.1 },
  rotateSensitivity: { min: 0.1, max: 3, step: 0.1 },
  panSensitivity: { min: 0.1, max: 3, step: 0.1 },
  dampingFactor: { min: 0.02, max: 0.5, step: 0.01 },
}

export type DirectorPreferences = { view: ViewSettings; theme: DirectorViewportTheme }

export const DEFAULT_DIRECTOR_PREFERENCES: DirectorPreferences = { view: DEFAULT_VIEW_SETTINGS, theme: 'default' }

const PREFERENCES_KEY = 'nomi:director:preferences'

function clampSetting(key: keyof ViewSettings, raw: unknown): number {
  const range = VIEW_SETTING_RANGES[key]
  const value = Number(raw)
  if (!Number.isFinite(value)) return DEFAULT_VIEW_SETTINGS[key]
  return Math.min(range.max, Math.max(range.min, value))
}

export function readDirectorPreferences(): DirectorPreferences {
  try {
    const raw = localStorage.getItem(PREFERENCES_KEY)
    if (!raw) return DEFAULT_DIRECTOR_PREFERENCES
    const parsed = JSON.parse(raw) as { view?: Partial<ViewSettings>; theme?: unknown }
    const view = { ...DEFAULT_VIEW_SETTINGS }
    for (const key of Object.keys(DEFAULT_VIEW_SETTINGS) as Array<keyof ViewSettings>) {
      if (parsed.view && key in parsed.view) view[key] = clampSetting(key, parsed.view[key])
    }
    return { view, theme: parsed.theme === 'neutral-gray' ? 'neutral-gray' : 'default' }
  } catch {
    return DEFAULT_DIRECTOR_PREFERENCES
  }
}

export function writeDirectorPreferences(preferences: DirectorPreferences): void {
  try {
    localStorage.setItem(PREFERENCES_KEY, JSON.stringify(preferences))
  } catch {
    // 无本地存储时偏好只活在本会话
  }
}
