import { describe, expect, it } from 'vitest'
import { migrateCanvasPluginNodeState } from './canvasPluginMigrations'

const original = {
  pluginId: 'nomi.workflow',
  pluginVersion: '1.0.0',
  typeId: 'nomi.workflow/checkpoint',
  schemaVersion: 1,
  state: { checked: false },
}

describe('canvas plugin state migration', () => {
  it('runs adjacent migrations deterministically', () => {
    const result = migrateCanvasPluginNodeState(original, 3, [
      { pluginId: original.pluginId, typeId: original.typeId, fromVersion: 1, toVersion: 2, migrate: (state) => ({ ...state, note: '' }) },
      { pluginId: original.pluginId, typeId: original.typeId, fromVersion: 2, toVersion: 3, migrate: (state) => ({ ...state, reviewedBy: 'user' }) },
    ])
    expect(result).toEqual({ ok: true, state: { ...original, schemaVersion: 3, state: { checked: false, note: '', reviewedBy: 'user' } } })
  })

  it('returns the original envelope when a migration is missing or throws', () => {
    expect(migrateCanvasPluginNodeState(original, 2, [])).toEqual({ ok: false, state: original, reason: 'missing migration 1 -> 2' })
    const result = migrateCanvasPluginNodeState(original, 2, [{
      pluginId: original.pluginId, typeId: original.typeId, fromVersion: 1, toVersion: 2,
      migrate: () => { throw new Error('bad state') },
    }])
    expect(result).toEqual({ ok: false, state: original, reason: 'bad state' })
  })
})
