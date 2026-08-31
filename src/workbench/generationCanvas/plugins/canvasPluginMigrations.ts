import type { CanvasPluginNodeState } from './canvasPluginTypes'

export type PluginMigration = {
  pluginId: string
  typeId: string
  fromVersion: number
  toVersion: number
  migrate: (state: Record<string, unknown>) => Record<string, unknown>
}
export type PluginMigrationResult =
  | { ok: true; state: CanvasPluginNodeState }
  | { ok: false; state: CanvasPluginNodeState; reason: string }

/** Runs only adjacent, deterministic migrations. A failed migration never partially writes state. */
export function migrateCanvasPluginNodeState(
  original: CanvasPluginNodeState,
  targetVersion: number,
  migrations: readonly PluginMigration[],
): PluginMigrationResult {
  if (original.schemaVersion > targetVersion) return { ok: false, state: original, reason: 'state is newer than this plugin' }
  let state = { ...original.state }
  let version = original.schemaVersion
  try {
    while (version < targetVersion) {
      const migration = migrations.find((candidate) => candidate.pluginId === original.pluginId && candidate.typeId === original.typeId && candidate.fromVersion === version)
      if (!migration || migration.toVersion <= version) throw new Error(`missing migration ${version} -> ${targetVersion}`)
      state = migration.migrate({ ...state })
      version = migration.toVersion
    }
  } catch (error) {
    return { ok: false, state: original, reason: error instanceof Error ? error.message : 'plugin migration failed' }
  }
  return { ok: true, state: { ...original, schemaVersion: version, state } }
}
