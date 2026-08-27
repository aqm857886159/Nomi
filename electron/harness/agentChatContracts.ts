import type { AgentContextScope } from './context/contextBinding';
import type { LegacyAgentBubble } from './context/legacyBubbles';
import type { RuntimeActivityEvent, RuntimeFinishReason, RuntimeToolCallRecord, RuntimeToolDecision, RuntimeUsage } from './runtime/runtimePort';

/** One SDK-free wire contract shared by main, preload and renderer. */
export const AGENT_CHAT_CAPABILITIES = [
  'creation-editor', 'creation-chat', 'canvas-agent', 'canvas-chat', 'canvas-refine', 'storyboard', 'single-shot',
] as const;
export type AgentChatCapability = typeof AGENT_CHAT_CAPABILITIES[number];
export type AgentChatHistory = AgentContextScope;
export type AgentChatToolDecision = RuntimeToolDecision;
export type AgentChatUsage = RuntimeUsage;
export type AgentChatStatus = 'finished' | 'cancelled' | 'error';
export type AgentChatErrorCode = 'text_model_credential_locked';
export interface AgentChatAttachment { url: string; contentType: string; fileName: string; kind: 'image' | 'file' }

export interface AgentChatRequest {
  prompt: string;
  capability: AgentChatCapability;
  history: AgentChatHistory;
  displayPrompt?: string;
  /** Attribution only. A feature key never becomes a persistent conversation key. */
  featureKey?: string;
  vendor?: string;
  projectId?: string;
  canvasProjectId?: string;
  canvasFlowId?: string;
  selectedNodeIds?: readonly string[];
  systemPrompt?: string;
  skillKey?: string;
  skillName?: string;
  chatContext?: unknown;
  mode?: string;
  temperature?: number;
  agentModelKey?: string;
  agentVendorKey?: string;
  attachments?: AgentChatAttachment[];
}

export interface AgentChatResponse {
  id: string;
  text: string;
  status: AgentChatStatus;
  raw?: { cancelled: true };
  toolCalls: RuntimeToolCallRecord[];
  artifacts: unknown[];
  usage: AgentChatUsage;
  finishReason: RuntimeFinishReason;
}

export type AgentChatActivity = RuntimeActivityEvent | { type: 'error'; message: string; code?: AgentChatErrorCode };
export type AgentChatWireEvent = AgentChatActivity
  | { type: 'tool-call-pending'; toolCallId: string; toolName: string; args: unknown }
  | { type: 'result'; result: AgentChatResponse }
  | { type: 'done'; reason: AgentChatStatus };
export interface AgentChatStartRequest { requestId: string; request: AgentChatRequest }
export interface AgentChatHistoryRequest { history: AgentChatHistory; messages?: readonly LegacyAgentBubble[] }
