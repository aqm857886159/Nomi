import type { ProjectAgentChange, ProjectAgentHostState, ProjectAgentMutation } from "../shared/projectAgentContracts";
import {
  assertCanonicalMutationTimestamp,
  assertExactMutationKeys,
  isCanonicalProjectAgentId,
} from "./projectAgentMutationValidation";
import { ProjectAgentReducerError } from "./projectAgentReducerContract";

type ThreadActivateMutation = Extract<ProjectAgentMutation, { type: "thread.activate" }>;

export function reduceProjectAgentThreadActivation(
  current: ProjectAgentHostState,
  mutation: ThreadActivateMutation,
): Readonly<{ activeThreadId: string; changes: readonly ProjectAgentChange[] }> {
  assertExactMutationKeys(mutation.payload, ["threadId", "occurredAt"]);
  const { threadId, occurredAt } = mutation.payload;
  assertCanonicalMutationTimestamp(occurredAt);
  if (!isCanonicalProjectAgentId(threadId)) throw new ProjectAgentReducerError("invalid_mutation");
  const thread = current.threads.find((candidate) => candidate.threadId === threadId);
  if (!thread) throw new ProjectAgentReducerError("record_not_found");
  if (current.activeThreadId === threadId || new Date(occurredAt).getTime() < new Date(thread.updatedAt).getTime()) {
    throw new ProjectAgentReducerError("invalid_mutation");
  }
  return {
    activeThreadId: threadId,
    changes: [{ kind: "active-thread-changed", activeThreadId: threadId }],
  };
}
