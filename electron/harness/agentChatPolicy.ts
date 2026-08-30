import {
  AGENT_CHAT_CAPABILITIES,
  AGENT_TOOL_PROFILES,
  type AgentChatRequest,
  type AgentChatHistory,
  type AgentToolProfile,
} from "./agentChatContracts";
import { assertAgentContextBinding } from "./context/contextBinding";
import { projectIdFromSessionKey } from "../events/eventLogRepository";
import {
  agentToolCatalog,
  agentToolNames,
  agentToolProjection,
  productionCapabilityContracts,
} from "./tools/agentToolCatalog";
import type { RuntimeToolCall, RuntimeToolDescriptor } from "./runtime/runtimePort";
import { capabilityAliasesFor, capabilityOperationAliasesFor } from "../shared/agentCapabilities/registry";
import { restrictToolsToSkillCapabilities } from "../skills/skillCapability";

export function captureAgentHistory(history: AgentChatHistory): AgentChatHistory {
  if (!history || typeof history !== "object") throw new Error("Explicit Agent history scope is required");
  if (history.kind === "ephemeral") return { kind: "ephemeral" };
  if (history.kind !== "persistent") throw new Error("Invalid Agent history scope");
  assertAgentContextBinding(history.binding);
  return { kind: "persistent", binding: { ...history.binding } };
}

/** Validate and capture before any asynchronous catalog, context or attachment preparation. */
export function captureAgentChatRequest(input: AgentChatRequest): AgentChatRequest {
  if (!input || !AGENT_CHAT_CAPABILITIES.includes(input.capability))
    throw new Error("Explicit valid Agent capability is required");
  if (typeof input.prompt !== "string") throw new Error("Agent prompt must be text");
  if (input.toolProfile !== undefined && !AGENT_TOOL_PROFILES.includes(input.toolProfile))
    throw new Error("Invalid Agent tool profile");
  const history = captureAgentHistory(input.history);
  if (input.capability === "single-shot" && history.kind !== "ephemeral")
    throw new Error("Single-shot requires ephemeral history");
  const knownProjects = [input.projectId, input.canvasProjectId].filter((id): id is string => id !== undefined);
  if (knownProjects.some((id) => typeof id !== "string" || !id.trim() || id !== id.trim()))
    throw new Error("Invalid explicit Agent project");
  if (
    agentToolsForCapability(input.capability).some((tool) => CANVAS_TOOL_NAMES.has(tool.name)) &&
    knownProjects.length === 0
  ) {
    throw new Error("Explicit Agent project is required for canvas tools");
  }
  if (knownProjects.some((id) => id !== knownProjects[0])) throw new Error("Agent project bindings disagree");
  if (
    history.kind === "persistent" &&
    knownProjects.some((id) => id !== projectIdFromSessionKey(history.binding.sessionKey))
  ) {
    throw new Error("Agent project does not match its persistent history binding");
  }
  if (
    input.selectedNodeIds !== undefined &&
    (!Array.isArray(input.selectedNodeIds) || input.selectedNodeIds.some((id) => typeof id !== "string" || !id))
  ) {
    throw new Error("Agent selectedNodeIds must be explicit node identifiers");
  }
  return {
    ...input,
    history,
    selectedNodeIds: [...(input.selectedNodeIds ?? [])],
    attachments: input.attachments?.map((attachment) => ({ ...attachment })),
  };
}

export function agentToolsForCapability(capability: AgentChatRequest["capability"]): RuntimeToolDescriptor[] {
  const descriptors: readonly RuntimeToolDescriptor[] =
    capability === "creation-editor"
      ? agentToolProjection.documentAll
      : capability === "creation-chat"
        ? agentToolProjection.documentRead.concat(agentToolProjection.documentAll.find(({ name }) => name === "author_skill")
          ? [agentToolProjection.documentAll.find(({ name }) => name === "author_skill")!]
          : [])
        : capability === "canvas-agent"
          ? [...agentToolProjection.canvasAll, ...agentToolProjection.timelineAll]
          : capability === "canvas-refine"
            ? agentToolProjection.canvasCore.filter(({ name }) => name === "set_node_prompt")
            : capability === "storyboard"
              ? agentToolProjection.canvasCore.filter(({ name }) => name === "read_canvas_state")
                .concat(agentToolProjection.canvasAll.filter(({ name }) => name === "propose_storyboard_plan"))
              : [];
  return descriptors.map(({ name, description, schema }) => ({ name, description, schema }));
}

export function agentToolsForCapabilityAndSkill(
  capability: AgentChatRequest["capability"],
  requestedCapabilities: readonly string[] | undefined,
): RuntimeToolDescriptor[] {
  return restrictToolsToSkillCapabilities(agentToolsForCapability(capability), requestedCapabilities);
}

const CANVAS_CORE_TOOL_NAMES = new Set(agentToolProjection.canvasCore.map(({ name }) => name));
const CANVAS_TOOL_NAMES = new Set(agentToolNames.canvas);
const CANVAS_DESTRUCTIVE_TOOL_NAMES = new Set(["delete_canvas_nodes", "tidy_canvas"]);
const STORYBOARD_TOOL_NAMES = new Set([
  "propose_storyboard_plan",
  "arrange_storyboard_to_timeline",
  "create_staging_reference",
  "create_camera_move",
]);
const MEDIA_READ_TOOL_NAMES = new Set([
  "get_media",
  "inspect_media",
  "search_media",
  "inspect_source_range",
  "read_waveform",
]);
const TIMELINE_TOOL_NAMES = new Set([
  "inspect_export_job",
  "verify_render",
  "export_timeline",
  "cancel_export_job",
  "read_timeline",
  "inspect_timeline_range",
  "propose_edit_plan",
  "apply_edit_plan",
  "undo_timeline_edit",
]);
const PRODUCTION_TOOL_NAMES = new Set<string>(agentToolNames.production);

const DESTRUCTIVE_INTENT = /删除|移除|清理|整理|delete|remove|tidy|clean\s+up/i;
const STORYBOARD_INTENT = /分镜|镜头卡|镜头设计|站位|姿势|运镜|storyboard|shot\s*card|blocking|camera\s*move/i;
const TIMELINE_INTENT = /时间线|时间轴|剪辑|裁剪|片段|轨道|重排|导出|预览|timeline|trim|split|track|export|preview/i;
const PRODUCTION_INTENT = /\d+\s*(?:分钟|分|min(?:ute)?s?)|成片|短片|广告片|制作|剧本|长任务|production|feature\s*video/i;
const MEDIA_INSPECTION_INTENT = /素材|媒体|音频|波形|时长|编码|查找|搜索|media|asset|waveform|duration|codec|search/i;

/**
 * Select a small, stable tool profile from the user's goal before the model sees a turn.
 * This is routing only: canonical aliases, Host authorization and domain owners remain unchanged.
 */
export function resolveAgentToolProfile(input: Readonly<{
  capability: AgentChatRequest["capability"];
  prompt: string;
  toolProfile?: AgentToolProfile;
}>): AgentToolProfile {
  if (input.toolProfile) return input.toolProfile;
  if (input.capability === "creation-editor" || input.capability === "creation-chat") return "creation";
  if (input.capability !== "canvas-agent") return "generation";
  if (PRODUCTION_INTENT.test(input.prompt)) return "production";
  if (TIMELINE_INTENT.test(input.prompt)) return "timeline";
  if (STORYBOARD_INTENT.test(input.prompt)) return "storyboard";
  return "generation";
}

/**
 * Merge a newly requested profile into the Thread's sticky projection. A
 * profile never shrinks: once a conversation needs storyboard or timeline
 * tools, later turns retain that schema set so model context and KV cache stay
 * stable. The production profile is the safe union for crossing both groups.
 */
export function mergeAgentToolProfiles(
  existing: AgentToolProfile | undefined,
  requested: AgentToolProfile,
): AgentToolProfile {
  if (!existing || existing === requested) return requested;
  if (existing === "production" || requested === "production") return "production";
  if (existing === "creation") return requested;
  if (requested === "creation") return existing;
  if (existing === "generation") return requested;
  if (requested === "generation") return existing;
  return "production";
}

/**
 * Project the full capability ceiling into the smallest useful per-goal set. A prompt that
 * explicitly asks for inspection or destructive cleanup gets the corresponding atomic group;
 * unrelated timeline/export schemas stay out of the initial context.
 */
export function agentToolsForRequest(
  request: AgentChatRequest,
  requestedCapabilities?: readonly string[],
): RuntimeToolDescriptor[] {
  const tools = agentToolsForCapabilityAndSkill(request.capability, requestedCapabilities);
  if (request.capability !== "canvas-agent") return tools;
  const productionTools = agentToolCatalog.production
    .filter((descriptor) => requestedCapabilities === undefined || productionCapabilityContracts.some((contract) =>
      requestedCapabilities.includes(contract.id)
      && [...capabilityAliasesFor(contract.id, "pi"), ...capabilityOperationAliasesFor(contract.id, "pi")].includes(descriptor.name),
    ))
    .map(({ name, description, parameters }) => ({ name, description, schema: parameters }));
  const allTools = [...tools, ...productionTools];
  const profile = resolveAgentToolProfile(request);
  const names = new Set<string>(CANVAS_CORE_TOOL_NAMES);
  if (profile === "generation" || profile === "storyboard" || profile === "production") {
    if (MEDIA_INSPECTION_INTENT.test(request.prompt)) for (const name of MEDIA_READ_TOOL_NAMES) names.add(name);
    if (DESTRUCTIVE_INTENT.test(request.prompt)) for (const name of CANVAS_DESTRUCTIVE_TOOL_NAMES) names.add(name);
  }
  if (profile === "storyboard" || profile === "production") {
    for (const name of STORYBOARD_TOOL_NAMES) names.add(name);
  }
  if (profile === "timeline" || profile === "production") {
    for (const name of MEDIA_READ_TOOL_NAMES) names.add(name);
    for (const name of TIMELINE_TOOL_NAMES) names.add(name);
  }
  if (profile === "production") {
    for (const name of PRODUCTION_TOOL_NAMES) names.add(name);
  }
  return allTools.filter((tool) => names.has(tool.name));
}

export function agentToolIsInScope(
  request: AgentChatRequest,
  call: RuntimeToolCall,
  requestedCapabilities?: readonly string[],
): boolean {
  if (!agentToolsForRequest(request, requestedCapabilities)
    .some((tool) => tool.name === call.toolName)) return false;
  if (request.capability !== "canvas-refine") return true;
  const nodeId = call.args && typeof call.args === "object" ? (call.args as Record<string, unknown>).nodeId : undefined;
  return typeof nodeId === "string" && Boolean(request.selectedNodeIds?.includes(nodeId));
}
