// Assemble upstream tools; SessionManager custom entries own durable coding-access state.
import { createLaneModelRead, laneModelReadSpec } from './laneModelRead.mjs';
import { NO_CATALOG_MODEL_AVAILABILITY } from './laneRuntimePort.js';
import type { AgentModelEntry } from '../shared/agentCapabilities/availableModels.js';
import type { ModelAvailabilityFacts } from '../shared/agentCapabilities/modelSpecProjection.js';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import type { JsonValue } from '@earendil-works/pi-ai';
import type { LaneBranchQuery, LaneEntry } from '../shared/agentLane/laneSnapshotTypes.js';
import type { LaneToolEffect } from '../shared/agentLane/laneToolContract.js';
import {
  createLaneCodingTools,
  LANE_CODING_TOOL_EFFECTS,
  laneCodingToolNames,
  loadPiCodingToolFactories,
  codingToolPromptSections,
  type LaneCodingAgentTool,
  type LaneCodingToolsInput,
} from './laneCodingTools.mjs';
import { createLaneNativeApprovalResolver } from './laneNativeApproval.js';
import {
  laneToolMenu,
  laneRequestToolDefinition,
  LANE_TOOL_REQUEST_TOOL_NAME,
  LANE_CODING_TOOL_GROUP,
} from './laneToolGroups.mjs';

export interface LaneDeferredGroup {
  readonly name: string;
  readonly toolNames: readonly string[];
}

export interface LaneActiveToolsController {
  findBranchEntries(query?: LaneBranchQuery): LaneEntry[];
  appendCustomEntry(customType: string, data?: JsonValue): Promise<string>;
}

export const LANE_CODING_ACCESS_NOTE = 'nomi.coding-access';

export async function createLaneNativeAssembly(input: Omit<LaneCodingToolsInput, 'factories'> & {
  factories?: LaneCodingToolsInput['factories'];
  deferredGroups?: readonly LaneDeferredGroup[];
  availableModels?: () => readonly AgentModelEntry[];
  modelAvailability?: (entry: AgentModelEntry) => ModelAvailabilityFacts | undefined;
}) {
  let activeTools: LaneActiveToolsController | undefined;
  const codingNames = laneCodingToolNames(input.platform);
  const canReadProject = async () => {
    if (!activeTools) return false;
    return activeTools.findBranchEntries({ type: 'custom', customType: LANE_CODING_ACCESS_NOTE, limit: 1 }).length > 0;
  };
  const toolAccessDenial = async (toolName: string): Promise<string | undefined> => {
    if (toolName !== 'read' && codingNames.some((name) => name === toolName) && !(await canReadProject())) {
      return 'Request coding before accessing project files.';
    }
    return undefined;
  };
  const coding = (await createLaneCodingTools({
    ...input,
    factories: input.factories ?? await loadPiCodingToolFactories(),
    canReadProject,
  })).map((tool) => tool.name === 'read' ? tool : ({
    ...tool,
    execute: async (...args: Parameters<typeof tool.execute>) => {
      const denial = await toolAccessDenial(tool.name);
      if (denial) throw new Error(denial);
      return tool.execute(...args);
    },
  }));

  const modelReadSpec = laneModelReadSpec();
  const groups: readonly LaneDeferredGroup[] = [
    { name: 'coding', toolNames: codingNames.filter((name) => name !== 'read') },
    ...(input.deferredGroups ?? []),
    { name: modelReadSpec.internalGroup!, toolNames: [modelReadSpec.name] },
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
  const unlockCoding = async (signal?: AbortSignal) => {
    signal?.throwIfAborted();
    if (!activeTools) throw new Error('Lane tool controller is not bound.');
    if (!activeTools.findBranchEntries({ type: 'custom', customType: LANE_CODING_ACCESS_NOTE, limit: 1 }).length) {
      await activeTools.appendCustomEntry(LANE_CODING_ACCESS_NOTE, { version: 1 });
    }
  };
  const request: LaneCodingAgentTool & { promptSnippet: string } = {
    ...laneRequestToolDefinition(groups),
    executionMode: 'parallel',
    execute: async (_id, args, signal) => {
      const requested = (args as { group?: unknown }).group;
      if (typeof requested !== 'string' || !byGroup.has(requested)) {
        throw new Error(`Request exactly one registered group: ${[...byGroup].join(', ')}.`);
      }
      if (requested === LANE_CODING_TOOL_GROUP) await unlockCoding(signal);
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
  const modelRead = createLaneModelRead(
    () => input.availableModels?.() ?? [],
    input.modelAvailability ?? NO_CATALOG_MODEL_AVAILABILITY,
  );
  const promptSources = [...coding, request];
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
    tools: [...coding, modelRead as unknown as AgentTool<object, unknown>, request],
    promptTools,
    groups,
    effects,
    activeToolNames: () => laneToolMenu({ groups }).activeToolNames,
    unlockCoding,
    toolAccessDenial,
    bindActiveTools: (controller: LaneActiveToolsController) => { activeTools = controller; },
    resolveApprovalSubject: createLaneNativeApprovalResolver({
      projectDir: input.projectDir,
      sandboxActive: input.sandbox.active,
      effects,
    }),
    promptSections: codingToolPromptSections([...promptSources, modelRead as unknown as LaneCodingAgentTool]),
  };
}
