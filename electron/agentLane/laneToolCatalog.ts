// Agent lane · **模型可见工具面的目录**（说明书那一半，无需任何领域 port）。
//
// 一份纯数据的清单，三个用户：
//   ① `scripts/check-model-schema.ts` —— 存量棘轮，直接 import 就能量「模型看到了什么」；
//   ② `lanePromptSections.ts` —— 渲染系统提示词的 `Available tools` / `Guidelines` 两段（G-03）；
//   ③ `tests/agent-runtime/lane-tool-contract.test.mts` —— 逐条把示例喂回自己的 schema。
//
// ③ 不是形式主义：一个**过不了自己 schema 的示例**比没有示例更糟，它主动教模型写错，
// 而且没有任何别的东西会发现——示例是纯文本，编译器、单测、门岗谁都不看它。
//
// **顺序是合同，不是审美**：`verbDeclarations.ts` 已经把「`tools/list` 的确定性顺序」
// 定成 prompt/KV-cache 合同（上游 `splitDeferredTools` 靠稳定前缀保住缓存）。这里同一条纪律：
// 目录按固定顺序拼，别按 `Object.keys` 之类会随实现漂的东西。
import type { LaneToolSpec } from "../shared/agentLane/laneToolContract";
import { modelFacingToolSpecs } from "../shared/agentCapabilities/modelFacingToolRegistry";
import { LANE_NATIVE_TOOL_GROUPS } from "../shared/agentLane/laneToolGroupNames";

/**
 * Core catalog count stays ≤12. B1c explicitly authorizes all domain schemas to
 * remain resident only while the complete catalog fits the unchanged 10k ceiling.
 * If it exceeds that ceiling, split the largest group into read/write subgroups
 * and defer unused groups; never retire a used group or raise the budget.
 */
export const LANE_TOOL_BUDGET = 12;

function buildCatalog(): readonly LaneToolSpec[] {
  // 内部 profile = 共享注册表的一次投影（方案 §3.1）。付费能力与「外部才有」的工具在那里
  // 就已经被声明挡住了，这里不再自己判断一次——判断散出去就是第二个真相源。
  const specs = modelFacingToolSpecs("internal").filter(spec => !spec.internalGroup);
  const names = new Set<string>();
  for (const spec of specs) {
    if (names.has(spec.name)) throw new Error(`Duplicate lane tool name: ${spec.name}`);
    names.add(spec.name);
  }
  if (specs.length > LANE_TOOL_BUDGET) {
    throw new Error(
      `Lane tool budget exceeded: ${specs.length} > ${LANE_TOOL_BUDGET}. `
      + "合并语义相近的工具，或按 G-09 用 addedToolNames 做动态装载——不要直接抬高上限。",
    );
  }
  return Object.freeze(specs);
}

export const LANE_MODEL_TOOL_CATALOG: readonly LaneToolSpec[] = buildCatalog();

/**
 * 延迟目录：按 `internalGroup` 延迟披露、经领域端口（`laneExtendedTools.ts`）执行的那些。
 * 原生装配层自己绑定执行的组（`LANE_NATIVE_TOOL_GROUPS`：coding / models）不在这里——
 * 同一个工具在两处装配就是重复注册（pi 当场抛 duplicate）。
 */
export const LANE_DEFERRED_TOOL_CATALOG = Object.freeze(
  modelFacingToolSpecs("internal").filter(spec => spec.internalGroup && !LANE_NATIVE_TOOL_GROUPS.includes(spec.internalGroup)),
);
/** 注册表里由原生装配层执行的说明书（今天只有 `nomi_read`）。门岗量预算时与延迟目录一起算。 */
export const LANE_NATIVE_TOOL_CATALOG = Object.freeze(
  modelFacingToolSpecs("internal").filter(spec => spec.internalGroup && LANE_NATIVE_TOOL_GROUPS.includes(spec.internalGroup)),
);
export const LANE_DEFERRED_TOOL_GROUPS = Object.freeze(
  [...new Set(LANE_DEFERRED_TOOL_CATALOG.map(spec => spec.internalGroup!))].map(name => Object.freeze({
    name, toolNames: Object.freeze(LANE_DEFERRED_TOOL_CATALOG.filter(spec => spec.internalGroup === name).map(spec => spec.name)),
  })),
);

// Retired lane aliases remain readable in persisted transcripts and fixture
// replies. They are not MCP tools and must be classified as in-app Agent names
// by the reference gate.
export const LANE_RUNTIME_COMPAT_TOOL_NAMES = Object.freeze([
  'nomi_canvas_write', 'nomi_canvas_read', 'nomi_generation_plan', 'nomi_storyboard_write',
]);
