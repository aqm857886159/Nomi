import { AGENT_CHAT_CAPABILITIES, type AgentChatRequest, type AgentChatHistory } from './agentChatContracts';
import { assertAgentContextBinding } from './context/contextBinding';
import { projectIdFromSessionKey } from '../events/eventLogRepository';
import { canvasToolDescriptors, canvasToolNames } from './tools/canvasDescriptors';
import { documentToolDescriptors } from './tools/documentDescriptors';
import { timelineToolDescriptors } from './tools/timelineDescriptors';
import type { RuntimeToolCall, RuntimeToolDescriptor } from './runtime/runtimePort';
import { CANVAS_READ_CAPABILITY } from '../shared/agentCapabilities/canvasRead';

const CANVAS_TOOL_NAMES = new Set<string>(canvasToolNames);

export function captureAgentHistory(history: AgentChatHistory): AgentChatHistory {
  if (!history || typeof history !== 'object') throw new Error('Explicit Agent history scope is required');
  if (history.kind === 'ephemeral') return { kind: 'ephemeral' };
  if (history.kind !== 'persistent') throw new Error('Invalid Agent history scope');
  assertAgentContextBinding(history.binding);
  return { kind: 'persistent', binding: { ...history.binding } };
}

/** Validate and capture before any asynchronous catalog, context or attachment preparation. */
export function captureAgentChatRequest(input: AgentChatRequest): AgentChatRequest {
  if (!input || !AGENT_CHAT_CAPABILITIES.includes(input.capability)) throw new Error('Explicit valid Agent capability is required');
  if (typeof input.prompt !== 'string') throw new Error('Agent prompt must be text');
  const history = captureAgentHistory(input.history);
  if (input.capability === 'single-shot' && history.kind !== 'ephemeral') throw new Error('Single-shot requires ephemeral history');
  const knownProjects = [input.projectId, input.canvasProjectId].filter((id): id is string => id !== undefined);
  if (knownProjects.some((id) => typeof id !== 'string' || !id.trim() || id !== id.trim())) throw new Error('Invalid explicit Agent project');
  if (agentToolsForCapability(input.capability).some((tool) => CANVAS_TOOL_NAMES.has(tool.name)) && knownProjects.length === 0) {
    throw new Error('Explicit Agent project is required for canvas tools');
  }
  if (knownProjects.some((id) => id !== knownProjects[0])) throw new Error('Agent project bindings disagree');
  if (history.kind === 'persistent' && knownProjects.some((id) => id !== projectIdFromSessionKey(history.binding.sessionKey))) {
    throw new Error('Agent project does not match its persistent history binding');
  }
  if (input.selectedNodeIds !== undefined && (!Array.isArray(input.selectedNodeIds) || input.selectedNodeIds.some((id) => typeof id !== 'string' || !id))) {
    throw new Error('Agent selectedNodeIds must be explicit node identifiers');
  }
  return { ...input, history, selectedNodeIds: [...input.selectedNodeIds ?? []],
    attachments: input.attachments?.map((attachment) => ({ ...attachment })) };
}

export function agentToolsForCapability(capability: AgentChatRequest['capability']): RuntimeToolDescriptor[] {
  const documents = documentToolDescriptors;
  const canvas = canvasToolDescriptors;
  const descriptors = capability === 'creation-editor' ? Object.values(documents)
    : capability === 'creation-chat' ? [documents.read_full_text, documents.read_selection, documents.author_skill]
      : capability === 'canvas-agent' ? [...Object.values(canvas), ...Object.values(timelineToolDescriptors)]
        : capability === 'canvas-refine' ? [canvas.set_node_prompt]
          : capability === 'storyboard' ? [canvas[CANVAS_READ_CAPABILITY.aliases.pi], canvas.propose_storyboard_plan] : [];
  return descriptors.map(({ name, description, parameters }) => ({ name, description, schema: parameters }));
}

export function agentToolIsInScope(request: AgentChatRequest, call: RuntimeToolCall): boolean {
  if (!agentToolsForCapability(request.capability).some((tool) => tool.name === call.toolName)) return false;
  if (request.capability !== 'canvas-refine') return true;
  const nodeId = call.args && typeof call.args === 'object' ? (call.args as Record<string, unknown>).nodeId : undefined;
  return typeof nodeId === 'string' && Boolean(request.selectedNodeIds?.includes(nodeId));
}
