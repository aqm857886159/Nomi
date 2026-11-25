import type { AgentContextScope } from './context/contextBinding';
import type { RuntimeFinishReason, RuntimeToolCallRecord, RuntimeToolDecision, RuntimeUsage } from '../shared/agentCapabilities/transportContracts';
import type { PromptCacheTelemetry } from './context/promptPipe';
import type { ProvenanceProjection } from './context/provenance';
import type { SkillLedgerItem } from './context/promptPipe';
import type { AgentContextSnapshot } from '../shared/agentContextSnapshot';
import type { ProjectAgentWorkMode } from '../shared/agentCapabilities/capabilityApprovalPolicy';
import type { AgentToolProfile } from '../shared/agentCapabilities/transportContracts';
export { AGENT_TOOL_PROFILES, type AgentToolProfile } from '../shared/agentCapabilities/transportContracts';

/** One SDK-free wire contract shared by main, preload and renderer. */
type AgentChatCapability =
  | 'creation-editor'
  | 'creation-chat'
  | 'canvas-agent'
  | 'canvas-chat'
  | 'canvas-refine'
  | 'storyboard'
  | 'single-shot';
/**
 * A bounded projection of the canonical capability catalog. The Host may only
 * move this value forward within a Thread; it is never an authorization input.
 */
type AgentChatHistory = AgentContextScope;
export type AgentChatToolDecision = RuntimeToolDecision;
export type AgentChatUsage = RuntimeUsage;
export type AgentChatStatus = 'finished' | 'cancelled' | 'error';
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
  /** User-facing execution posture; never grants authority or replaces Host policy. */
  workMode?: ProjectAgentWorkMode;
  temperature?: number;
  agentModelKey?: string;
  agentVendorKey?: string;
  attachments?: AgentChatAttachment[];
  /** Immutable resident selection captured at send time; never inferred by the runtime. */
  contextSnapshot?: AgentContextSnapshot;
  /** Host-captured tool projection; renderer input cannot grant capabilities. */
  toolProfile?: AgentToolProfile;
  /** Main-process ledger projection used only to re-read successful Skill bodies. */
  hostPromptLedger?: readonly SkillLedgerItem[];
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
  promptCache?: PromptCacheTelemetry;
  promptBudgetWarning?: string;
  promptWarnings?: readonly string[];
  provenance?: readonly ProvenanceProjection[];
  taintedSourceRefs?: readonly string[];
}

