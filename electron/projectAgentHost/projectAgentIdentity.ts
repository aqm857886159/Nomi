import type { ProjectBinding } from "../shared/projectBinding";
import { assertProjectAgentBinding as assertSharedProjectAgentBinding } from "../shared/projectBinding";
import { ProjectAgentStateError } from "./projectAgentStateError";

export function assertProjectAgentBinding(binding: ProjectBinding): void {
  try {
    assertSharedProjectAgentBinding(binding);
  } catch {
    throw new ProjectAgentStateError("invalid_project_binding");
  }
}

export function sameProjectAgentBinding(left: ProjectBinding, right: ProjectBinding): boolean {
  return (
    left.projectId === right.projectId &&
    left.immutableProjectUuid === right.immutableProjectUuid &&
    left.projectGeneration === right.projectGeneration
  );
}

export function projectAgentPartitionKey(binding: ProjectBinding): string {
  assertProjectAgentBinding(binding);
  return `project-agent.${encodeURIComponent(binding.immutableProjectUuid)}.g${binding.projectGeneration}`;
}
