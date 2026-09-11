import { getDesktopBridge } from '../../desktop/bridge'
import {
  DEFAULT_MODEL_BOX_PREFERENCE_SETTINGS,
  MODEL_BOX_PREFERENCE_SCHEMA_VERSION,
  normalizeModelBoxPreferenceSettings,
  type ModelBoxPreferenceSettings,
} from '../../../electron/shared/contracts/modelBoxPreference'

export async function getModelBoxPreference(): Promise<ModelBoxPreferenceSettings> {
  try { return normalizeModelBoxPreferenceSettings(await getDesktopBridge()?.settings?.modelBoxPreference?.get()) } catch { return DEFAULT_MODEL_BOX_PREFERENCE_SETTINGS }
}

/** 没有桌面桥时（浏览器里的设计实验室）返回归一化后的值本身——写不进去，但屏上行为仍是真的。 */
export async function setModelBoxPreference(next: Partial<ModelBoxPreferenceSettings>): Promise<ModelBoxPreferenceSettings> {
  const value = normalizeModelBoxPreferenceSettings({ ...next, schemaVersion: MODEL_BOX_PREFERENCE_SCHEMA_VERSION })
  const bridge = getDesktopBridge()?.settings?.modelBoxPreference
  if (!bridge) return value
  return normalizeModelBoxPreferenceSettings(await bridge.set(value))
}
