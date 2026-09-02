import type {
  ProjectAgentAssistantItem,
  ProjectAgentChange,
  ProjectAgentHostState,
  ProjectAgentMutation,
} from "../shared/projectAgentContracts";
import { PROJECT_AGENT_ASSISTANT_DELTA_MAX_CHARS } from "../shared/projectAgentContracts";
import {
  assertCanonicalMutationTimestamp,
  assertExactMutationKeys,
  isCanonicalProjectAgentId,
} from "./projectAgentMutationValidation";
import { ProjectAgentReducerError } from "./projectAgentReducerContract";
import { freezeProjectAgentIncremental } from "./projectAgentSnapshot";

type AssistantAppendMutation = Extract<ProjectAgentMutation, { type: "assistant.append" }>;

type AssistantAppendReduction = Readonly<{
  items: ProjectAgentHostState["items"];
  changes: readonly ProjectAgentChange[];
}>;

function fail(code: "invalid_mutation" | "record_not_found"): never {
  throw new ProjectAgentReducerError(code);
}

function stale(): never {
  throw new ProjectAgentReducerError("async_result_stale");
}

export function reduceProjectAgentAssistantAppend(
  current: ProjectAgentHostState,
  mutation: AssistantAppendMutation,
): AssistantAppendReduction {
  assertExactMutationKeys(mutation.payload, [
    "turnId",
    "itemId",
    "executionToken",
    "expectedTextRevision",
    "delta",
    "occurredAt",
  ]);
  const { turnId, itemId, executionToken, expectedTextRevision, delta, occurredAt } = mutation.payload;
  assertCanonicalMutationTimestamp(occurredAt);
  if (
    (mutation.sender.kind !== "embedded-agent" && mutation.sender.kind !== "internal") ||
    !isCanonicalProjectAgentId(turnId) ||
    !isCanonicalProjectAgentId(itemId) ||
    !isCanonicalProjectAgentId(executionToken) ||
    !Number.isSafeInteger(expectedTextRevision) ||
    expectedTextRevision < 0 ||
    typeof delta !== "string" ||
    delta.length === 0 ||
    delta.length > PROJECT_AGENT_ASSISTANT_DELTA_MAX_CHARS
  ) {
    fail("invalid_mutation");
  }
  const turn = current.turns.find((candidate) => candidate.turnId === turnId);
  const queueItem = current.queue.find((candidate) => candidate.turnId === turnId);
  const assistant = current.items.find((candidate) => candidate.itemId === itemId);
  if (!turn || !queueItem || !assistant) fail("record_not_found");
  if (
    turn.status !== "running" ||
    queueItem.status !== "running" ||
    turn.executionToken !== executionToken ||
    assistant.kind !== "assistant" ||
    assistant.status !== "running" ||
    assistant.threadId !== turn.threadId ||
    assistant.turnId !== turn.turnId ||
    assistant.textRevision !== expectedTextRevision ||
    new Date(occurredAt).getTime() < new Date(assistant.updatedAt).getTime() ||
    new Date(occurredAt).getTime() < new Date(turn.updatedAt).getTime()
  ) {
    stale();
  }
  const updated = freezeProjectAgentIncremental({
    ...assistant,
    text: assistant.text + delta,
    textRevision: assistant.textRevision + 1,
    updatedAt: occurredAt,
  }) as ProjectAgentAssistantItem;
  return {
    items: current.items.map((candidate) => (candidate.itemId === updated.itemId ? updated : candidate)),
    changes: [{ kind: "item-upserted", item: updated }],
  };
}
