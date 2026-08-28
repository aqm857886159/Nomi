import type {
  ProjectAgentCompactCommandReceipt,
  ProjectAgentHostState,
  ProjectAgentMutation,
} from "../shared/projectAgentContracts";
import {
  assertExactMutationKeys,
  assertProjectAgentMutationEnvelope,
  hashProjectAgentMutation,
  isCanonicalProjectAgentId,
} from "./projectAgentMutationValidation";
import type { ProjectAgentReduction } from "./projectAgentReduction";
import { ProjectAgentReducerError } from "./projectAgentReducerContract";
import {
  freezeProjectAgentSnapshot,
  sameProjectAgentBinding,
  snapshotProjectAgentHostState,
} from "./projectAgentState";

function fail(code: "invalid_mutation" | "project_binding_mismatch" | "command_id_conflict"): never {
  throw new ProjectAgentReducerError(code);
}

export function replayProjectAgentCompactCommand(
  inputState: ProjectAgentHostState,
  inputMutation: ProjectAgentMutation,
  inputReceipt: ProjectAgentCompactCommandReceipt,
): ProjectAgentReduction {
  const state = snapshotProjectAgentHostState(inputState);
  let mutation: ProjectAgentMutation;
  let receipt: ProjectAgentCompactCommandReceipt;
  try {
    mutation = freezeProjectAgentSnapshot(inputMutation);
    receipt = freezeProjectAgentSnapshot(inputReceipt);
  } catch {
    fail("invalid_mutation");
  }
  assertProjectAgentMutationEnvelope(mutation);
  assertExactMutationKeys(receipt, ["commandId", "mutationHash", "appliedRevision"]);
  if (!sameProjectAgentBinding(state.binding, mutation.binding)) fail("project_binding_mismatch");
  if (
    !isCanonicalProjectAgentId(receipt.commandId) ||
    typeof receipt.mutationHash !== "string" ||
    !/^[a-f0-9]{64}$/.test(receipt.mutationHash) ||
    !Number.isSafeInteger(receipt.appliedRevision) ||
    receipt.appliedRevision < 1 ||
    receipt.appliedRevision > state.commandLedgerHighWater
  ) {
    fail("invalid_mutation");
  }
  if (receipt.commandId !== mutation.commandId || receipt.mutationHash !== hashProjectAgentMutation(mutation)) {
    fail("command_id_conflict");
  }
  const firstRecentRevision = state.hostRevision - state.recentAppliedCommands.length + 1;
  if (receipt.appliedRevision >= firstRecentRevision) fail("invalid_mutation");
  return Object.freeze({
    state,
    patch: null,
    receipt,
    replayed: true,
    snapshotRequired: true,
  });
}
