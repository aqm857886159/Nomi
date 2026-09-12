// `nomi_read`（模型目录读）的**执行那一半**。说明书那一半住 `verbs/generationVerbs.ts`（注册表里
// `internalGroup:"models"`），这里只把它绑到 `availableModels` 解析器上——PR A 之前它是注册表外
// 唯一一个手写 TypeBox 定义的模型可见工具（审计 C5 / 设计 T9）。
import type { AgentModelEntry } from '../shared/agentCapabilities/availableModels.js';
import { modelFacingToolSpecs } from '../shared/agentCapabilities/modelFacingToolRegistry.js';
import { laneToolModelDescription, type LaneToolSpec } from '../shared/agentLane/laneToolContract.js';
import { toModelVisibleSchema } from './laneToolSchema.mjs';

export const LANE_MODEL_READ_TOOL_NAME = 'nomi_read';

/** 注册表里那份声明。找不到 = 有人把它从 `verbDeclarations.ts` 删了而没删这里——当场抛。 */
export function laneModelReadSpec(): LaneToolSpec {
  const spec = modelFacingToolSpecs('internal').find((candidate) => candidate.name === LANE_MODEL_READ_TOOL_NAME);
  if (!spec) throw new Error(`${LANE_MODEL_READ_TOOL_NAME} is not declared in the model-facing tool registry`);
  return spec;
}

/** pi 工具形状（描述取首句进 schema，全文进系统提示词——与 `laneTools.mts` 同一条纪律）。 */
export const laneModelReadDefinition = (() => {
  const spec = laneModelReadSpec();
  return {
    name: spec.name, label: 'Models',
    description: laneToolModelDescription(spec),
    promptSnippet: spec.promptSnippet,
    parameters: toModelVisibleSchema(spec.schema, { toolName: spec.name }),
    replay: 'safe' as const,
  };
})();

export function createLaneModelRead(resolve: () => readonly AgentModelEntry[]) {
  return { ...laneModelReadDefinition, execute: async (_id: string, args: { target: string; modelKey?: string }) => {
    if (args.target !== 'models') throw new Error('Use target=models.');
    const entries = resolve().filter(entry => args.modelKey === undefined || entry.modelKey === args.modelKey);
    return { content: [{ type: 'text' as const, text: JSON.stringify({ models: entries }) }],
      details: { models: entries } };
  } };
}
