import type { MigrateLaneLegacy } from '../shared/agentLane/laneLegacyMigrationContract';
import type { OpenDesktopLaneWorkspace, RunLaneSingleShot } from './laneRuntimePort';

/** Native import survives CommonJS compilation; pi never enters preload or renderer. */
export const openDesktopLaneWorkspace: OpenDesktopLaneWorkspace = async (options) => {
  const { openLaneWorkspace } = await import('./laneWorkspace.mjs');
  return openLaneWorkspace(options);
}

export const runLaneSingleShot: RunLaneSingleShot = async (options) =>
  (await import('./laneSingleShot.mjs')).runLaneSingleShot(options);

export const migrateLaneLegacy: MigrateLaneLegacy = async (options) =>
  (await import('./laneLegacyMigration.mjs')).migrateLaneLegacy(options);

export const openLaneTraceDirectory = async (projectDir: string, laneName?: string): Promise<string> =>
  (await import('./laneSession.mjs')).openLaneTraceDirectory(projectDir, laneName);
