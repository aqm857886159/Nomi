// B1c: all registered schemas are resident under the unchanged 10k ceiling.
// Groups describe task intent; requesting them never retires another group.
// Execution approval and coding file access remain separate from schema visibility.
import { LANE_MODEL_TOOL_CATALOG, LANE_TOOL_BUDGET } from './laneToolCatalog.js';
import { LANE_CODING_TOOL_NAMES } from './laneCodingTools.mjs';
import { Type } from 'typebox';
import { LANE_CODING_TOOL_GROUP } from '../shared/agentLane/laneToolGroupNames.js';

/** 一个可按需点亮的领域组。`coding` 由装配层注册，其余来自 `LANE_DEFERRED_TOOL_GROUPS`。 */
export interface LaneToolGroupDefinition {
  readonly name: string
  readonly toolNames: readonly string[]
}

/** 组名住中立层 `laneToolGroupNames.ts`（叶子模块）；这里只是再导出，避免与 `laneToolCatalog.ts` 成环。 */
export { LANE_CODING_TOOL_GROUP, LANE_MODELS_TOOL_GROUP, LANE_NATIVE_TOOL_GROUPS } from '../shared/agentLane/laneToolGroupNames.js';

/** 找工具的那个工具。**唯一一个 always-on 的解锁入口**，schema 极小（照 pi 的 kimi 示例形状）。 */
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
    promptSnippet: `Select a group: ${groups.map(group => group.name).join(', ')}. All tool schemas stay resident. Request coding before accessing project files; installed Skills remain readable. This does not approve actions.`,
    parameters: Type.Object({
      group: Type.String({ enum: groups.map(group => group.name) }),
    }, { additionalProperties: false }),
    replay: 'safe' as const,
  };
}

/** 解锁 coding 组的三个条件。任一满足即亮。 */
export type LaneCodingUnlockReason =
  /** ① 当前触发/引用的技能声明需要脚本（自带 `scripts/`，或 frontmatter 写了 `tools: coding`）。 */
  | 'skill-requires-scripts'
  /** ② 用户消息附了代码/HTML/脚本类文件，或显式要求写代码。 */
  | 'user-supplied-code'
  /** ③ 模型自己调了 `nomi_request_tools`（kimi 示例的 `tool_search` 形状）。 */
  | 'model-requested';

export interface LaneToolMenuInput {
  /** 宿主实际注册的领域组；不传时只计算核心工具。 */
  readonly groups?: readonly LaneToolGroupDefinition[]
  /** 当前选择的任务组；不改变已注册 schema 的可见性。 */
  readonly activeGroup?: string | null
}

export interface LaneToolMenu {
  /** 这一次请求要亮的工具名，**顺序是合同**（前缀稳定才有缓存，`verbDeclarations.ts` 同一条纪律）。 */
  readonly activeToolNames: readonly string[]
  /** 亮着的那个领域组的名字，没有就是 `null`。 */
  readonly activeGroup: string | null
  /** 选择的是 coding；实际文件授权由 native assembly 的持久化记录判断。 */
  readonly codingUnlocked: boolean
}

/** Stable catalog order; task selection never changes registered schema residency. */
export function laneToolMenu(input: LaneToolMenuInput = {}): LaneToolMenu {
  const alwaysOn = [...LANE_MODEL_TOOL_CATALOG.map((tool) => tool.name), LANE_TOOL_REQUEST_TOOL_NAME, 'read'];
  const requested = input.activeGroup ?? null;
  const groups = input.groups ?? (requested ? [{ name: LANE_CODING_TOOL_GROUP, toolNames: LANE_CODING_TOOL_NAMES }] : []);
  const group = groups.find((candidate) => candidate.name === requested);
  if (requested !== null && !group) throw new Error(`Unknown lane tool group: ${requested}. Registered: ${groups.map((one) => one.name).join(', ')}.`);
  return {
    activeToolNames: [...new Set([...alwaysOn, ...groups.flatMap(group => group.toolNames)])],
    activeGroup: requested,
    codingUnlocked: requested === LANE_CODING_TOOL_GROUP,
  };
}

// ── 预算规则（`check:model-schema` 读这里）─────────────────────────────────

/**
 * 任一「运行时真的会亮出来的组合」的 schema 总量上限。
 *
 * 数字来自 Anthropic 那条门槛（>10k token 才值得上 tool search），不是我们拍的。
 * **超了的处置写死在这里，不许抬**：把超限的那个组按 read / write 拆成两个子组分别解锁
 * （coding 组的拆法是 read/grep/find/ls 与 edit/write/bash）。写在常量旁边，是因为
 * 下一个撞到上限的人会先看到这句话，而不是先看到那个数字。
 */
export const LANE_TOOL_SCHEMA_TOKEN_CEILING = 10_000;

export interface LaneToolCombination {
  readonly label: string
  readonly toolNames: readonly string[]
  /** 这个组合里所有工具的 description + JSON Schema 的 token 估计（用 pi 自己的估法）。 */
  readonly estimatedTokens: number

}

/**
 * 预算判定。两条，各挡各的：
 *   ① `LANE_TOOL_BUDGET` **只管 always-on 组**——它管的是「随手再加一个常驻工具」；
 *   ② token 上限管**每一个真会亮出来的组合**（常驻 + 每一个单组，逐一算）——
 *      它管的是「常驻数没变，但某个 schema 胖了一倍」。
 * 合成一条就会漏掉后者，而后者才是 #547 那族的形状。
 */
export function evaluateLaneToolBudget(input: {
  alwaysOnCount: number
  combinations: readonly LaneToolCombination[]
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
