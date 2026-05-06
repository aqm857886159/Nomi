import type { CollabAgentManagerLike } from "../collab/public.js";
import { CANVAS_AGENT, TIMELINE_AGENT, CREATION_AGENT } from "./workspace-agents.js";

type WorkspaceContext = {
  projectId: string;
  flowId?: string;
};

type AgentResult = {
  agentType: string;
  agentId: string;
  result?: string;
  error?: string;
};

function detectNeededAgents(task: string): string[] {
  const lower = task.toLowerCase();
  const needed: string[] = [];

  const canvasKeywords = ["canvas", "node", "generate", "image", "video", "keyframe", "character", "connect", "wire"];
  const timelineKeywords = ["timeline", "clip", "frame", "sequence", "edit", "cut", "duration"];
  const creationKeywords = ["script", "write", "shot", "scene", "narrative", "story", "creation", "镜头", "剧本", "文案"];

  if (canvasKeywords.some((k) => lower.includes(k))) needed.push(CANVAS_AGENT.name);
  if (timelineKeywords.some((k) => lower.includes(k))) needed.push(TIMELINE_AGENT.name);
  if (creationKeywords.some((k) => lower.includes(k))) needed.push(CREATION_AGENT.name);

  // Default to all agents if nothing matched
  if (needed.length === 0) needed.push(CANVAS_AGENT.name, TIMELINE_AGENT.name, CREATION_AGENT.name);

  return needed;
}

function buildAgentPrompt(agentName: string, task: string, context: WorkspaceContext): string {
  return `Project ID: ${context.projectId}${context.flowId ? `\nFlow ID: ${context.flowId}` : ""}\n\nTask: ${task}`;
}

function getSystemForAgent(agentName: string): string {
  if (agentName === CANVAS_AGENT.name) return CANVAS_AGENT.prompt;
  if (agentName === TIMELINE_AGENT.name) return TIMELINE_AGENT.prompt;
  return CREATION_AGENT.prompt;
}

function waitForAgent(
  mgr: CollabAgentManagerLike,
  agentId: string,
  intervalMs = 500,
  timeoutMs = 120_000,
): Promise<AgentResult & { agentId: string }> {
  return new Promise((resolve) => {
    const start = Date.now();
    const check = () => {
      const s = mgr.status(agentId);
      if (s.status === "completed" || s.status === "failed" || s.status === "closed") {
        resolve({ agentType: s.agent_type, agentId, result: s.result_preview, error: s.error });
        return;
      }
      if (Date.now() - start > timeoutMs) {
        resolve({ agentType: s.agent_type, agentId, error: "timeout" });
        return;
      }
      setTimeout(check, intervalMs);
    };
    check();
  });
}

export async function orchestrateWorkspaceTask(
  mgr: CollabAgentManagerLike,
  task: string,
  context: WorkspaceContext,
  parentAgentId?: string,
): Promise<AgentResult[]> {
  const agentNames = detectNeededAgents(task);

  const spawned = agentNames.map((name) => {
    const { agentId } = mgr.spawn({
      description: `${name} agent for: ${task.slice(0, 60)}`,
      prompt: buildAgentPrompt(name, task, context),
      agentType: name,
      systemOverride: getSystemForAgent(name),
      depth: 1,
      parentAgentId,
    });
    return { name, agentId };
  });

  const results = await Promise.all(
    spawned.map(({ agentId }) => waitForAgent(mgr, agentId)),
  );

  return results;
}
