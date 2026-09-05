import fs from 'node:fs'
import path from 'node:path'

import { normalizeDesktopLocale, type DesktopLocale } from '../desktopLocale'

const PREFERENCES_FILE = 'preferences.json'

function preferenceValue(payload: unknown): unknown {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return undefined
  const record = payload as Record<string, unknown>
  const nested = record.preferences
  if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
    const language = (nested as Record<string, unknown>).language
    if (typeof language === 'string' && language.trim()) return language
  }
  return typeof record.language === 'string' && record.language.trim() ? record.language : undefined
}

export function readPersistedLocale(settingsRoot: string | undefined = process.env.NOMI_SETTINGS_DIR): DesktopLocale | null {
  const root = String(settingsRoot || '').trim()
  if (!root) return null
  try {
    const payload = JSON.parse(fs.readFileSync(path.join(root, PREFERENCES_FILE), 'utf8'))
    const value = preferenceValue(payload)
    return value === undefined ? null : normalizeDesktopLocale(value)
  } catch {
    return null
  }
}

export function writePersistedLocale(settingsRoot: string, locale: DesktopLocale): void {
  const root = String(settingsRoot || '').trim()
  if (!root) return
  fs.mkdirSync(root, { recursive: true })
  const target = path.join(root, PREFERENCES_FILE)
  let existing: Record<string, unknown> = {}
  try {
    const parsed = JSON.parse(fs.readFileSync(target, 'utf8'))
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) existing = parsed as Record<string, unknown>
  } catch {
    // A missing or malformed preferences file is replaced with a minimal valid one.
  }
  const preferences = existing.preferences && typeof existing.preferences === 'object' && !Array.isArray(existing.preferences)
    ? existing.preferences as Record<string, unknown>
    : {}
  fs.writeFileSync(target, `${JSON.stringify({ ...existing, preferences: { ...preferences, language: locale } }, null, 2)}\n`, { mode: 0o600 })
}
