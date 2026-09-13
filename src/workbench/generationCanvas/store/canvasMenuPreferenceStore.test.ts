import { describe, expect, it, vi } from 'vitest'
import { useCanvasMenuPreferenceStore } from './canvasMenuPreferenceStore'
import { canvasFullAddSections, canvasResidentAddIntents, moveCanvasIntentUp } from '../components/canvasToolbarModel'
import { DEFAULT_CANVAS_MENU_PREFERENCE_SETTINGS, normalizeCanvasMenuPreferenceSettings } from '../../../../electron/shared/contracts/canvasMenuPreference'
const bridge = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn() }))
vi.mock('../../../desktop/bridge', () => ({ getDesktopBridge: () => ({ settings: { canvasMenuPreference: bridge } }) }))

describe('canvas add menu preferences', () => {
  it('saves hidden/order through the settings bridge, reloads, and restores every default item', async () => {
    const store = useCanvasMenuPreferenceStore.getState()
    const preference = moveCanvasIntentUp({ schemaVersion: 1, orderedIntentIds: [], hiddenIntentIds: ['audio'] }, 'video')
    bridge.set.mockResolvedValue(preference)
    await store.save(preference)
    expect(bridge.set).toHaveBeenCalledWith(preference)
    expect(canvasResidentAddIntents(preference).map((item) => item.id)).toEqual(['video', 'image', 'text', 'clip', 'import-file'])
    bridge.get.mockResolvedValue(preference)
    useCanvasMenuPreferenceStore.setState({ preference: DEFAULT_CANVAS_MENU_PREFERENCE_SETTINGS })
    await store.load()
    expect(useCanvasMenuPreferenceStore.getState().preference).toEqual(preference)
    expect(canvasFullAddSections(preference).flatMap((section) => section.intents).some((item) => item.id === 'audio')).toBe(false)
    await store.save(DEFAULT_CANVAS_MENU_PREFERENCE_SETTINGS)
    expect(canvasResidentAddIntents(useCanvasMenuPreferenceStore.getState().preference)).toHaveLength(6)
  })
  it('normalizes malformed and duplicate persisted values', () => {
    expect(normalizeCanvasMenuPreferenceSettings({ hiddenIntentIds: ['image', 'image', null], orderedIntentIds: false })).toEqual({ schemaVersion: 1, hiddenIntentIds: ['image'], orderedIntentIds: [] })
  })
})
