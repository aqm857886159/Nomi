import path from 'node:path'
import { readJsonFile, writeJsonFileAtomic } from '../jsonFile'
import { getSettingsRoot } from './settingsRoot'
import { DEFAULT_CANVAS_MENU_PREFERENCE_SETTINGS, normalizeCanvasMenuPreferenceSettings, type CanvasMenuPreferenceSettings } from '../shared/contracts/canvasMenuPreference'
const FILE = 'canvas-menu-preference.json'
export function canvasMenuPreferenceSettingsPath(): string { return path.join(getSettingsRoot(), FILE) }
export function readCanvasMenuPreferenceSettings(): CanvasMenuPreferenceSettings { try { return normalizeCanvasMenuPreferenceSettings(readJsonFile(canvasMenuPreferenceSettingsPath())) } catch { return DEFAULT_CANVAS_MENU_PREFERENCE_SETTINGS } }
export function writeCanvasMenuPreferenceSettings(value: unknown): CanvasMenuPreferenceSettings { const next = normalizeCanvasMenuPreferenceSettings(value); writeJsonFileAtomic(canvasMenuPreferenceSettingsPath(), next); return next }
