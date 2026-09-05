import crypto from "node:crypto";
import { appendEvents, readEvents } from "../events/eventLogRepository";
import type {
  ActiveExecution,
  ProjectAgentExecutionCoordinatorDeps,
  ProjectAgentTurnCompletedInput,
} from "../projectAgentHost/projectAgentExecutionCoordinatorTypes";
import type { AgentChatResponse } from "../harness/agentChatContracts";
import type { ProjectAgentHostState, ProjectBinding } from "../shared/projectAgentContracts";
import { getExperienceRepository } from "./experienceRepository";
import type { ExperienceTrajectory } from "./experienceTypes";

const EVENT_LIMIT = 256;
const TEXT_HEAD = 2000;

function head(value: unknown, max = TEXT_HEAD): string {
  const text = typeof value === "string" ? value : value == null ? "" : JSON.stringify(value);
  return text.trim().replace(/\s+/g, " ").slice(0, max);
}

function trajectoryEvents(projectId: string, lastSeq: number): ExperienceTrajectory["events"] {
  const fromSeq = Math.max(0, lastSeq - EVENT_LIMIT);
  return readEvents(projectId, { fromSeq })
    .slice(-EVENT_LIMIT)
    .map((event) => ({
      type: event.type,
      seq: event.seq,
      payload: event.payload,
    }));
}

/**
 * Canonical Host completion seam for the verified-experience loop.
 *
 * The caller must invoke this only after the Host has committed a terminal
 * turn. It writes a bounded EventLog receipt first, then runs extraction as a
 * local asynchronous side effect. A model response is still ignored unless it
 * contains the explicit learning envelope and source event references.
 */
export async function completeProjectAgentExperience(input: ProjectAgentTurnCompletedInput): Promise<void> {
  const turn = input.state.turns.find((candidate) => candidate.turnId === input.turnId);
  if (!turn || turn.status !== "done") return;

  const written = appendEvents(input.binding.projectId, [{
    id: `evt_agent_turn_finished_${crypto.randomUUID().slice(0, 12)}`,
    source: "agent",
    type: "agent.turn.finished",
    payload: {
      sessionId: turn.contextRef.binding.sessionKey,
      threadId: turn.threadId,
      turnId: input.turnId,
      executionToken: input.executionToken,
      status: "ok",
      hostStatus: turn.status,
      finalTextHead: head(input.response.text),
      finishReason: input.response.finishReason ?? null,
      usage: input.response.usage ?? null,
    },
  }]);
  const lastSeq = written.at(-1)?.seq ?? 0;
  const trajectory: ExperienceTrajectory = {
    trajectoryId: `traj_${input.executionToken}`,
    projectId: input.binding.projectId,
    sessionId: turn.contextRef.binding.sessionKey,
    threadId: turn.threadId,
    prompt: input.request.prompt,
    response: input.response.text,
    events: trajectoryEvents(input.binding.projectId, lastSeq),
    completedAt: input.completedAt,
  };
  await getExperienceRepository().complete(trajectory);
}

/** Keep completion failure isolation out of the already-large turn executor. */
export function notifyProjectAgentCompletion(
  handler: NonNullable<ProjectAgentExecutionCoordinatorDeps["onTurnCompleted"]>,
  binding: ProjectBinding,
  execution: ActiveExecution,
  response: AgentChatResponse,
  state: ProjectAgentHostState,
  fallbackCompletedAt: string,
): void {
  const completedAt = state.turns.find((turn) => turn.turnId === execution.turn.turnId)?.updatedAt ?? fallbackCompletedAt;
  try {
    void Promise.resolve(handler({
      binding,
      turnId: execution.turn.turnId,
      executionToken: execution.turn.executionToken,
      request: execution.request,
      response,
      state,
      completedAt,
    })).catch((error: unknown) => {
      console.warn(`[nomi:project-agent] completion side effect failed for ${execution.turn.turnId}`, error);
    });
  } catch (error) {
    console.warn(`[nomi:project-agent] completion side effect failed for ${execution.turn.turnId}`, error);
  }
}
