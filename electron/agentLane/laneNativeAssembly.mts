// Assemble upstream tools; pi owns tool activation and its durable addedToolNames transitions.
import { createLaneModelRead, laneModelReadSpec } from './laneModelRead.mjs';
import type { AgentModelEntry } from '../shared/agentCapabilities/availableModels.js';
import type { AgentLane, AgentHarnessTool } from '@earendil-works/pi-agent-core';
import { BACKGROUND_CONTEXT } from '@earendil-works/pi-agent-core/harness/context';
import type { Context } from '@earendil-works/pi-agent-core/harness/context';
import type { LaneToolEffect } from '../shared/agentLane/laneToolContract.js';
import {
  createLaneCodingTools, LANE_CODING_TOOL_EFFECTS, LANE_CODING_TOOL_NAMES,
  loadPiCodingToolFactories, codingToolPromptSections,
  type LaneCodingToolsInput, type PiAgentTool,
} from './laneCodingTools.mjs';
import { createLaneNativeApprovalResolver } from './laneNativeApproval.js';
import {
  laneToolMenu, laneRequestToolDefinition, LANE_TOOL_REQUEST_TOOL_NAME, LANE_CODING_TOOL_GROUP,
} from './laneToolGroups.mjs';

export interface LaneDeferredGroup {
  readonly name: string;
  readonly toolNames: readonly string[];
}

/**
 * pi 那一侧「这条 lane 现在亮着哪些工具」的公开读写面（`AgentLane` 就长这样）。
 *
 * 装配层拿不到 lane——lane 是 harness 建出来的，而 harness 要先吃到装配好的工具表。
 * 所以由宿主在 `harness.lane()` 之后回头把它交进来。**不复制一份本地激活状态**：
 * 唯一真相仍然是 pi 的快照，这里只是一支笔。
 */
export type LaneActiveToolsController = Pick<AgentLane, 'findEntries' | 'appendCustomEntry'>;

export const LANE_CODING_ACCESS_NOTE = 'nomi.coding-access';

export async function createLaneNativeAssembly(input: Omit<LaneCodingToolsInput, 'factories'> & {
  factories?: LaneCodingToolsInput['factories'];
  deferredGroups?: readonly LaneDeferredGroup[];
  availableModels?: () => readonly AgentModelEntry[];
}) {
  let activeTools: LaneActiveToolsController | undefined;
  const canReadProject = async () => {
    if (!activeTools) return false;
    return (await activeTools.findEntries({ type: 'custom', customType: LANE_CODING_ACCESS_NOTE, limit: 1 }, BACKGROUND_CONTEXT)).length > 0;
  };
  const toolAccessDenial = async (toolName: string): Promise<string | undefined> => {
    // read owns a separate trusted-Skill path check; all other coding tools need project access.
    if (toolName !== 'read' && LANE_CODING_TOOL_NAMES.some(name => name === toolName) && !(await canReadProject())) {
      return 'Request coding before accessing project files.';
    }
    return undefined;
  };
  const coding = (await createLaneCodingTools({ ...input,
    factories: input.factories ?? await loadPiCodingToolFactories(), canReadProject,
  })).map(tool => tool.name === 'read' ? tool : ({ ...tool,
    execute: async (...args: Parameters<typeof tool.execute>) => {
      const denial = await toolAccessDenial(tool.name);
      if (denial) throw new Error(denial);
      return tool.execute(...args);
    },
  }));
  // `models` 组从注册表里那条声明派生（`internalGroup`），不再手写名字。
  const modelReadSpec = laneModelReadSpec();
  const groups: readonly LaneDeferredGroup[] = [
    { name: 'coding', toolNames: LANE_CODING_TOOL_NAMES.filter(name => name !== 'read') },
    ...(input.deferredGroups ?? []).filter(group => !group.toolNames.includes(modelReadSpec.name)),
  ];
  const alwaysOn = laneToolMenu().activeToolNames;
  const names = new Set(alwaysOn);
  const byGroup = new Set<string>();
  for (const group of groups) {
    if (!/^[a-z][a-z0-9-]*$/.test(group.name) || byGroup.has(group.name) || !group.toolNames.length) {
      throw new Error(`Invalid or duplicate deferred tool group: ${group.name}`);
    }
    for (const name of group.toolNames) {
      if (!name || names.has(name)) throw new Error(`Duplicate deferred tool name: ${name}`);
      names.add(name);
    }
    byGroup.add(group.name);
  }
  const unlockCoding = async (context: Context) => {
    if (!activeTools) throw new Error('Lane tool controller is not bound.');
    if (!(await activeTools.findEntries({ type: 'custom', customType: LANE_CODING_ACCESS_NOTE, limit: 1 }, context)).length) {
      await activeTools.appendCustomEntry(LANE_CODING_ACCESS_NOTE, { version: 1 }, context);
    }
  };
  const request: AgentHarnessTool<undefined> & { promptSnippet: string } = {
    ...laneRequestToolDefinition(groups),
    execute: async (_id, args, _onUpdate, _toolContext, _invocation, context) => {
      const requested = (args as { group?: unknown }).group;
      // Validate before producing a result. No model value creates a group or a tool.
      if (typeof requested !== 'string' || !byGroup.has(requested)) {
        throw new Error(`Request exactly one registered group: ${[...byGroup].join(', ')}.`);
      }
      if (requested === LANE_CODING_TOOL_GROUP) await unlockCoding(context);
      return {
        content: [{ type: 'text', text: `Selected ${requested}. All tool groups remain available; existing approval and file permissions still apply.` }],
        details: { groups: [requested] },
      };
    },
  };
  const effects: Readonly<Record<string, LaneToolEffect>> = Object.freeze({
    ...LANE_CODING_TOOL_EFFECTS,
    [modelReadSpec.name]: modelReadSpec.effect,
    [LANE_TOOL_REQUEST_TOOL_NAME]: 'read',
  });
  const promptSources = [...coding, request] as unknown as PiAgentTool[];
  // `nomi_read` 的系统提示词条目直接用注册表那份说明书（全文 + 示例 + 纪律），与领域工具同一条路。
  const promptTools = [
    ...promptSources.flatMap((tool) => tool.promptSnippet ? [{
      name: tool.name,
      promptSnippet: tool.promptSnippet,
      description: tool.description,
      ...(tool.promptGuidelines ? { promptGuidelines: tool.promptGuidelines } : {}),
    }] : []),
    modelReadSpec,
  ];
  return {
    // 模型目录已由 laneHost 的 canonical `createLaneTools(options.tools)` 提供；native
    // 只补 coding 与请求工具，避免同一 schema 在 harness 中注册两次。
    tools: [...coding, request],
    promptTools,
    groups,
    effects,
    // Creation default only. Never overwrite lane.getActiveTools() on reopen or before_request:
    // pi commits newly unlocked names with each tool result (tool-placement.js:137–156).
    activeToolNames: () => laneToolMenu({ groups }).activeToolNames,
    unlockCoding,
    toolAccessDenial,
    bindActiveTools: (controller: LaneActiveToolsController) => { activeTools = controller; },
    resolveApprovalSubject: createLaneNativeApprovalResolver({
      projectDir: input.projectDir, sandboxActive: input.sandbox.active, effects,
    }),
    promptSections: codingToolPromptSections([...promptSources, modelReadSpec as unknown as PiAgentTool]),
  };
}
