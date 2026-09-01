import type { ProjectAgentItem, ProjectAgentTurn } from "../shared/projectAgentContracts";
import { ProjectAgentStateError } from "./projectAgentStateError";

function hasExpectedAssistantStatus(turn: ProjectAgentTurn, assistant: ProjectAgentItem | undefined): boolean {
  switch (turn.status) {
    case "queued":
    case "drafting":
      return assistant === undefined;
    case "running":
    case "proposed":
      return assistant?.kind === "assistant" && assistant.status === "running";
    case "done":
      return assistant?.kind === "assistant" && assistant.status === "done";
    case "failed":
      return assistant === undefined || (assistant.kind === "assistant" && assistant.status === "failed");
    case "stopped":
    case "declined":
      return assistant === undefined || (assistant.kind === "assistant" && assistant.status === "stopped");
  }
}

export function assertProjectAgentAssistantLifecycle(
  turns: readonly ProjectAgentTurn[],
  items: readonly ProjectAgentItem[],
  selectedTurnIds?: ReadonlySet<string>,
): void {
  for (const turn of turns) {
    if (selectedTurnIds && !selectedTurnIds.has(turn.turnId)) continue;
    const assistants = items.filter((item) => item.kind === "assistant" && item.turnId === turn.turnId);
    if (assistants.length > 1 || !hasExpectedAssistantStatus(turn, assistants[0])) {
      throw new ProjectAgentStateError("invalid_state");
    }
  }
}
