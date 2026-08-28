import type {
  ProjectAgentAsyncResultEnvelope,
  ProjectAgentHostState,
  ProjectAgentMutation,
  ProjectAgentSender,
  ProjectBinding,
} from "../shared/projectAgentContracts";
import {
  ProjectAgentReducerError,
  reduceProjectAgentMutation,
  replayProjectAgentCompactCommand,
  type ProjectAgentReduction,
} from "./projectAgentReducer";
import type { ProjectAgentRepository } from "./projectAgentRepository";
import {
  createInitialProjectAgentState,
  freezeProjectAgentSnapshot,
  projectAgentPartitionKey,
} from "./projectAgentState";

export type OfflineProjectAgentHostDeps = {
  repository: ProjectAgentRepository;
  reduce?: (
    state: ProjectAgentHostState,
    mutation: ProjectAgentMutation,
  ) => ProjectAgentReduction | Promise<ProjectAgentReduction>;
};

export type ProjectAgentAsyncResultCommit = Readonly<{
  commandId: string;
  sender: ProjectAgentSender;
  envelope: ProjectAgentAsyncResultEnvelope;
}>;

export type OfflineProjectAgentHost = Readonly<{
  dispatch: (mutation: ProjectAgentMutation) => Promise<ProjectAgentReduction>;
  commitAsyncResult: (input: ProjectAgentAsyncResultCommit) => Promise<ProjectAgentReduction>;
  getSnapshot: (binding: ProjectBinding) => ProjectAgentHostState;
}>;

export function createOfflineProjectAgentHost(deps: OfflineProjectAgentHostDeps): OfflineProjectAgentHost {
  const reduce = deps.reduce ?? reduceProjectAgentMutation;
  const partitionTails = new Map<string, Promise<void>>();

  function getSnapshot(binding: ProjectBinding): ProjectAgentHostState {
    const existing = deps.repository.load(binding);
    if (existing) return existing;
    return deps.repository.initialize(createInitialProjectAgentState(binding));
  }

  function dispatch(input: ProjectAgentMutation): Promise<ProjectAgentReduction> {
    let mutation: ProjectAgentMutation;
    let partition: string;
    try {
      mutation = freezeProjectAgentSnapshot(input);
      partition = projectAgentPartitionKey(mutation.binding);
    } catch {
      return Promise.reject(new ProjectAgentReducerError("invalid_mutation"));
    }

    const previous = partitionTails.get(partition) ?? Promise.resolve();
    const operation = previous.then(async () => {
      const current = getSnapshot(mutation.binding);
      const recent = current.recentAppliedCommands.find((receipt) => receipt.commandId === mutation.commandId);
      if (recent) return reduceProjectAgentMutation(current, mutation);
      const committed = deps.repository.lookupCommittedCommand(current, mutation.commandId);
      if (committed) return replayProjectAgentCompactCommand(current, mutation, committed);
      const reduction = await reduce(current, mutation);
      if (!reduction.replayed) {
        deps.repository.commit(mutation.binding, current.hostRevision, reduction.state);
      }
      return reduction;
    });
    const settled = operation.then(
      () => undefined,
      () => undefined,
    );
    partitionTails.set(partition, settled);
    void settled.then(() => {
      if (partitionTails.get(partition) === settled) partitionTails.delete(partition);
    });
    return operation;
  }

  function commitAsyncResult(input: ProjectAgentAsyncResultCommit): Promise<ProjectAgentReduction> {
    return dispatch({
      commandId: input.commandId,
      expectedRevision: input.envelope.expectedRevision,
      binding: input.envelope.binding,
      sender: input.sender,
      type: "async.result",
      payload: input.envelope,
    });
  }

  return Object.freeze({ dispatch, commitAsyncResult, getSnapshot });
}
