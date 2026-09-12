import path from 'node:path'
import { readJsonFile, writeJsonFileAtomic } from '../jsonFile'
import { getSettingsRoot } from './settingsRoot'
import { DEFAULT_MODEL_BOX_PREFERENCE_SETTINGS, normalizeModelBoxPreferenceSettings, type ModelBoxPreferenceSettings } from './modelBoxPreferenceContract'
const FILE = 'model-box-preference.json'
export function modelBoxPreferenceSettingsPath(): string { return path.join(getSettingsRoot(), FILE) }
export function readModelBoxPreferenceSettings(): ModelBoxPreferenceSettings { try { return normalizeModelBoxPreferenceSettings(readJsonFile(modelBoxPreferenceSettingsPath())) } catch { return DEFAULT_MODEL_BOX_PREFERENCE_SETTINGS } }
export function writeModelBoxPreferenceSettings(value: unknown): ModelBoxPreferenceSettings { const next = normalizeModelBoxPreferenceSettings(value); writeJsonFileAtomic(modelBoxPreferenceSettingsPath(), next); return next }
