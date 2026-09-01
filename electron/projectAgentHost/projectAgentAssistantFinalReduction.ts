import type {
  ProjectAgentAssistantItem,
  ProjectAgentAsyncResultEnvelope,
  ProjectAgentChange,
  ProjectAgentItem,
  ProjectAgentStatus,
} from "../shared/projectAgentContracts";
import { assertExactMutationKeys, isCanonicalProjectAgentId } from "./projectAgentMutationValidation";
import { ProjectAgentReducerError } from "./projectAgentReducerContract";
import { isProjectAgentStatusTransition } from "./projectAgentReducerContract";
import { freezeProjectAgentIncremental } from "./projectAgentSnapshot";

type AssistantFinalReduction = Readonly<{
  items: readonly ProjectAgentItem[];
  changes: readonly ProjectAgentChange[];
}>;

function stale(): never {
  throw new ProjectAgentReducerError("async_result_stale");
}

function isRunningAssistant(item: ProjectAgentItem): item is ProjectAgentAssistantItem {
  return item.kind === "assistant" && item.status === "running";
}

export function reduceProjectAgentAssistantFinal(
  items: readonly ProjectAgentItem[],
  result: ProjectAgentAsyncResultEnvelope,
): AssistantFinalReduction {
  if (result.turnStatus === "running") {
    if (result.assistantFinal !== undefined) stale();
    return { items, changes: [] };
  }
  const assistant = items.find(
    (item): item is ProjectAgentAssistantItem => isRunningAssistant(item) && item.turnId === result.turnId,
  );
  if (!assistant || result.assistantFinal === undefined) stale();
  const final = result.assistantFinal;
  assertExactMutationKeys(final, ["itemId", "executionToken", "expectedTextRevision", "text"]);
  if (
    !isCanonicalProjectAgentId(final.itemId) ||
    !isCanonicalProjectAgentId(final.executionToken) ||
    !Number.isSafeInteger(final.expectedTextRevision) ||
    final.expectedTextRevision < 0 ||
    typeof final.text !== "string"
  ) {
    throw new ProjectAgentReducerError("invalid_mutation");
  }
  if (
    final.itemId !== assistant.itemId ||
    final.executionToken !== result.asyncToken ||
    final.expectedTextRevision !== assistant.textRevision ||
    new Date(result.receivedAt).getTime() < new Date(assistant.updatedAt).getTime()
  ) {
    stale();
  }
  const status = result.turnStatus === "declined" ? "stopped" : result.turnStatus;
  if (!isProjectAgentStatusTransition(assistant.status, status)) stale();
  const textChanged = final.text !== assistant.text;
  const updated = freezeProjectAgentIncremental({
    ...assistant,
    text: final.text,
    textRevision: assistant.textRevision + (textChanged ? 1 : 0),
    status,
    updatedAt: result.receivedAt,
  }) as ProjectAgentAssistantItem;
  return {
    items: items.map((item) => (item.itemId === updated.itemId ? updated : item)),
    changes: [{ kind: "item-upserted", item: updated }],
  };
}

export function reduceProjectAgentAssistantTerminal(
  items: readonly ProjectAgentItem[],
  turnId: string,
  status: ProjectAgentStatus,
  updatedAt: string,
): AssistantFinalReduction {
  const assistant = items.find(
    (item): item is ProjectAgentAssistantItem => isRunningAssistant(item) && item.turnId === turnId,
  );
  if (!assistant) return { items, changes: [] };
  const assistantStatus = status === "declined" ? "stopped" : status;
  if (
    !isProjectAgentStatusTransition(assistant.status, assistantStatus) ||
    new Date(updatedAt).getTime() < new Date(assistant.updatedAt).getTime()
  ) {
    throw new ProjectAgentReducerError("status_transition_invalid");
  }
  const updated = freezeProjectAgentIncremental({
    ...assistant,
    status: assistantStatus,
    updatedAt,
  }) as ProjectAgentAssistantItem;
  return {
    items: items.map((item) => (item.itemId === updated.itemId ? updated : item)),
    changes: [{ kind: "item-upserted", item: updated }],
  };
}
