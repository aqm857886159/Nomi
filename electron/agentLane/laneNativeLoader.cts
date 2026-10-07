import type { MigrateLaneLegacy } from '../shared/agentLane/laneLegacyMigrationContract';
import type { SkillToolAuthorityPlacement } from '../shared/agentLane/skillPromptPlacement';
import type { OpenDesktopLaneWorkspace, RunLaneSingleShot } from './laneRuntimePort';
import type { TrajectoryTurnInput } from '../shared/agentLane/laneTrajectory';
import type { SkillRecord } from '../skills/skillStore';

// 这里每一个 `await import('./X.mjs')` 都要在 laneNativeLoader.entries.json 登记阶段（open = 打开项目路径上就装、
// 不许拖进 pi-coding-agent 入口；use = 用到时才装）。不登记 tests/agent-runtime/lane-open-graph.test.mts 当场红。

/**
 * 技能目录（pi 的 `loadSourcedSkills` 在岛上）。CJS 侧的 `skillStore.readSkillRecords()` 就是经这里拿的；
 * 返回类型刻意写成中立于岛的 `SkillRecord[]`——岛里的投影哪天不再结构兼容，编译在这里当场红。
 */
export const readSkillRecords = async (): Promise<SkillRecord[]> =>
  (await import('./laneSkillCatalog.mjs')).readSkillRecords();

/** 选中技能 → 提示词（pi 的 `formatSkillInvocation`）。CJS 侧的两个调用点（singleShot / configure）经这里拿。 */
export const renderSelectedSkillPrompt = async (
  skill: Pick<SkillRecord, 'name' | 'description' | 'filePath' | 'content'>,
  placement?: SkillToolAuthorityPlacement,
): Promise<string> => (await import('./laneSkillPrompt.mjs')).renderSelectedSkillPrompt(skill, placement);

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

/**
 * 轨迹取料口。**返回类型刻意写成中立契约层的 `TrajectoryTurnInput[]` 而不是岛里的 `LaneTraceTurn[]`**
 * —— 这一行就是两处形状的漂移守卫：岛里那个类型哪天不再结构兼容，编译在这里当场红
 * （`electron/shared/agentLane/laneTrajectory.ts` 的注释里写了这条依赖）。
 */
export const readLaneTraceTurns = async (projectDir: string, laneName: string): Promise<TrajectoryTurnInput[]> =>
  (await import('./laneSession.mjs')).readLaneTraceTurns(projectDir, laneName);
