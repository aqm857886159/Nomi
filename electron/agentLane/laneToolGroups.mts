// B1c: all registered schemas are resident under the unchanged 10k ceiling.
// Groups describe task intent; requesting them never retires another group.
// Execution approval and coding file access remain separate from schema visibility.
import { LANE_MODEL_TOOL_CATALOG, LANE_TOOL_BUDGET } from './laneToolCatalog.js';
import { LANE_CODING_TOOL_NAMES } from './laneCodingTools.mjs';
import { LANE_CODING_TOOL_GROUP } from '../shared/agentLane/laneToolGroupNames.js';

/** 一个可按需点亮的领域组。`coding` 由装配层注册，其余来自 `LANE_DEFERRED_TOOL_GROUPS`。 */
export interface LaneToolGroupDefinition {
  readonly name: string;
  readonly toolNames: readonly string[];
}

/** 组名住中立层 `laneToolGroupNames.ts`（叶子模块）；这里只是再导出，避免与 `laneToolCatalog.ts` 成环。 */
export { LANE_CODING_TOOL_GROUP, LANE_MODELS_TOOL_GROUP, LANE_NATIVE_TOOL_GROUPS } from '../shared/agentLane/laneToolGroupNames.js';

/** 找工具的那个工具。**唯一一个 always-on 的解锁入口**，schema 极小。 */
export const LANE_TOOL_REQUEST_TOOL_NAME = 'nomi_request_tools';

/**
 * The assembly and budget gate consume the exact same model-visible definition.
 *
 * One group selection records task intent; schemas remain resident.
 */
export function laneRequestToolDefinition(groups: readonly { name: string }[]) {
  return {
    name: LANE_TOOL_REQUEST_TOOL_NAME,
    label: 'Tools',
    description: 'Select a tool group for this task without removing other tools or approving actions.',
    promptSnippet: `Select a group: ${groups.map((group) => group.name).join(', ')}. All tool schemas stay resident. Request coding before accessing project files; installed Skills remain readable. This does not approve actions.`,
    parameters: {
      type: 'object' as const,
      properties: {
        group: {
          type: 'string' as const,
          enum: groups.map((group) => group.name),
        },
      },
      required: ['group'] as const,
      additionalProperties: false as const,
    },
    replay: 'safe' as const,
  };
}

/** 解锁 coding 组的三个条件。任一满足即亮。 */
export type LaneCodingUnlockReason =
  | 'skill-requires-scripts'
  | 'user-supplied-code'
  | 'model-requested';

export interface LaneToolMenuInput {
  readonly groups?: readonly LaneToolGroupDefinition[];
  readonly activeGroup?: string | null;
}

export interface LaneToolMenu {
  readonly activeToolNames: readonly string[];
  readonly activeGroup: string | null;
  readonly codingUnlocked: boolean;
}

/** Stable catalog order; task selection never changes registered schema residency. */
export function laneToolMenu(input: LaneToolMenuInput = {}): LaneToolMenu {
  const alwaysOn = [...LANE_MODEL_TOOL_CATALOG.map((tool) => tool.name), LANE_TOOL_REQUEST_TOOL_NAME, 'read'];
  const requested = input.activeGroup ?? null;
  const groups = input.groups ?? (requested ? [{ name: LANE_CODING_TOOL_GROUP, toolNames: LANE_CODING_TOOL_NAMES }] : []);
  const group = groups.find((candidate) => candidate.name === requested);
  if (requested !== null && !group) throw new Error(`Unknown lane tool group: ${requested}. Registered: ${groups.map((one) => one.name).join(', ')}.`);
  return {
    activeToolNames: [...new Set([...alwaysOn, ...groups.flatMap((g) => g.toolNames)])],
    activeGroup: requested,
    codingUnlocked: requested === LANE_CODING_TOOL_GROUP,
  };
}

export const LANE_TOOL_SCHEMA_TOKEN_CEILING = 10_000;

export interface LaneToolCombination {
  readonly label: string;
  readonly toolNames: readonly string[];
  readonly estimatedTokens: number;
}

export function evaluateLaneToolBudget(input: {
  alwaysOnCount: number;
  combinations: readonly LaneToolCombination[];
}): string[] {
  const failures: string[] = [];
  if (input.alwaysOnCount > LANE_TOOL_BUDGET) {
    failures.push(
      `always-on 组 ${input.alwaysOnCount} 个 > ${LANE_TOOL_BUDGET}。`
      + '合并语义相近的工具，或把新工具放进一个按需解锁的组——不要抬预算。',
    );
  }
  for (const combination of input.combinations) {
    if (combination.estimatedTokens > LANE_TOOL_SCHEMA_TOKEN_CEILING) {
      failures.push(
        `组合「${combination.label}」的 schema 约 ${combination.estimatedTokens} token > ${LANE_TOOL_SCHEMA_TOKEN_CEILING}。`
        + '处置是把这个组按 read / write 拆成两个子组分别解锁（coding 组即 read/grep/find/ls 与 edit/write/bash），'
        + '**不是**抬这个上限。',
      );
    }
  }
  return failures;
}
