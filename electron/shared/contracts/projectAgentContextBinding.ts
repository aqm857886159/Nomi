import type { ProjectAgentContextBinding, ProjectBinding } from "../projectAgentContracts";
import { assertProjectAgentBinding } from "../projectBinding";

export class ProjectAgentContextBindingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProjectAgentContextBindingError";
  }
}

function canonicalProject(project: ProjectBinding): ProjectBinding {
  try {
    assertProjectAgentBinding(project);
    const canonical = {
      projectId: project?.projectId,
      immutableProjectUuid: project?.immutableProjectUuid,
      projectGeneration: project?.projectGeneration,
    } as ProjectBinding;
    return Object.freeze(canonical);
  } catch {
    throw new ProjectAgentContextBindingError("Invalid project binding");
  }
}

export function deriveProjectAgentSessionKey(project: ProjectBinding): ProjectAgentContextBinding["sessionKey"] {
  const canonical = canonicalProject(project);
  return `nomi:project-agent:${canonical.immutableProjectUuid}:g${canonical.projectGeneration}`;
}

export function createProjectAgentContextBinding(
  project: ProjectBinding,
  threadId: string,
): ProjectAgentContextBinding {
  const canonical = canonicalProject(project);
  if (typeof threadId !== "string" || !threadId.trim() || threadId !== threadId.trim()) {
    throw new ProjectAgentContextBindingError("Thread id is required");
  }
  return Object.freeze({
    project: canonical,
    threadId,
    sessionKey: deriveProjectAgentSessionKey(canonical),
  });
}

export function assertProjectAgentContextBinding(value: unknown): ProjectAgentContextBinding {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ProjectAgentContextBindingError("Context binding is required");
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  if (keys.join("|") !== "project|sessionKey|threadId") {
    throw new ProjectAgentContextBindingError("Invalid context binding fields");
  }
  const project = canonicalProject(record.project as ProjectBinding);
  if (typeof record.threadId !== "string" || !record.threadId.trim() || record.threadId !== record.threadId.trim()) {
    throw new ProjectAgentContextBindingError("Thread id is required");
  }
  const expectedSessionKey = deriveProjectAgentSessionKey(project);
  if (record.sessionKey !== expectedSessionKey) {
    throw new ProjectAgentContextBindingError("Project Agent session key does not match binding");
  }
  return Object.freeze({
    project,
    threadId: record.threadId,
    sessionKey: expectedSessionKey,
  });
}
