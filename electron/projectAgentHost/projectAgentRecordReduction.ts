import type { ProjectAgentChange, ProjectAgentItem, ProjectAgentStatus } from "../shared/projectAgentContracts";
import { assertCanonicalMutationTimestamp, assertOptionalMutationBoolean } from "./projectAgentMutationValidation";
import { ProjectAgentReducerError, isProjectAgentStatusTransition } from "./projectAgentReducerContract";
import { freezeProjectAgentIncremental } from "./projectAgentSnapshot";
import { isProjectAgentStatus } from "./projectAgentStateValidationPrimitives";

function fail(code: "record_not_found" | "status_transition_invalid"): never {
  throw new ProjectAgentReducerError(code);
}

export function assertStatusTransition(from: ProjectAgentStatus, to: ProjectAgentStatus): void {
  if (!isProjectAgentStatus(to) || !isProjectAgentStatusTransition(from, to)) {
    fail("status_transition_invalid");
  }
}

export function replaceById<T>(
  values: readonly T[],
  id: string,
  readId: (value: T) => string,
  update: (value: T) => T,
): readonly T[] {
  let found = false;
  const next = values.map((value) => {
    if (readId(value) !== id) return value;
    found = true;
    return update(value);
  });
  if (!found) fail("record_not_found");
  return next;
}

export function transitionRecord<
  T extends {
    status: ProjectAgentStatus;
    retryable: boolean;
    deviated: boolean;
    updatedAt: string;
  },
>(
  value: T,
  payload: {
    status: ProjectAgentStatus;
    retryable?: boolean;
    deviated?: boolean;
    updatedAt: string;
  },
  allowSame = false,
): T {
  assertOptionalMutationBoolean(payload.retryable);
  assertOptionalMutationBoolean(payload.deviated);
  if (value.status !== payload.status) assertStatusTransition(value.status, payload.status);
  else if (!allowSame) fail("status_transition_invalid");
  assertCanonicalMutationTimestamp(payload.updatedAt);
  if (new Date(payload.updatedAt).getTime() < new Date(value.updatedAt).getTime()) {
    fail("status_transition_invalid");
  }
  return freezeProjectAgentIncremental({
    ...value,
    status: payload.status,
    retryable: payload.retryable ?? value.retryable,
    deviated: payload.deviated ?? value.deviated,
    updatedAt: payload.updatedAt,
  }) as T;
}

export function updateProposalItems(
  items: readonly ProjectAgentItem[],
  approvalId: string,
  status: ProjectAgentStatus,
  updatedAt: string,
  retryable?: boolean,
): { items: readonly ProjectAgentItem[]; changes: readonly ProjectAgentChange[] } {
  assertOptionalMutationBoolean(retryable);
  const changes: ProjectAgentChange[] = [];
  const next = items.map((item) => {
    if (
      item.kind !== "proposal" ||
      item.approval?.approvalId !== approvalId ||
      (item.status === status && (retryable === undefined || item.retryable === retryable))
    ) {
      return item;
    }
    if (item.status !== status) assertStatusTransition(item.status, status);
    const updated = freezeProjectAgentIncremental({
      ...item,
      status,
      retryable: retryable ?? item.retryable,
      updatedAt,
    }) as ProjectAgentItem;
    changes.push({ kind: "item-upserted", item: updated });
    return updated;
  });
  return { items: next, changes };
}
