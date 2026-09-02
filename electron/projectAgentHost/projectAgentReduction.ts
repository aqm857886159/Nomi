import type {
  ProjectAgentAppliedCommand,
  ProjectAgentCompactCommandReceipt,
  ProjectAgentHostState,
  ProjectAgentPatch,
} from "../shared/projectAgentContracts";

export type ProjectAgentFullReduction = Readonly<{
  state: ProjectAgentHostState;
  patch: ProjectAgentPatch;
  receipt: ProjectAgentAppliedCommand;
  replayed: boolean;
  snapshotRequired: false;
}>;

export type ProjectAgentCompactReplay = Readonly<{
  state: ProjectAgentHostState;
  patch: null;
  receipt: ProjectAgentCompactCommandReceipt;
  replayed: true;
  snapshotRequired: true;
}>;

export type ProjectAgentReduction = ProjectAgentFullReduction | ProjectAgentCompactReplay;
