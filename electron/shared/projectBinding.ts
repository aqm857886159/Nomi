export type ProjectBinding = Readonly<{
  projectId: string;
  immutableProjectUuid: string;
  projectGeneration: number;
}>;

const IMMUTABLE_PROJECT_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const PROJECT_BINDING_KEYS = new Set(["projectId", "immutableProjectUuid", "projectGeneration"]);

export class ProjectBindingValidationError extends Error {
  constructor() {
    super("invalid_project_binding");
    this.name = "ProjectBindingValidationError";
  }
}

export function assertProjectAgentBinding(binding: ProjectBinding): void {
  if (
    !binding ||
    typeof binding !== "object" ||
    Array.isArray(binding) ||
    Object.keys(binding).some((key) => !PROJECT_BINDING_KEYS.has(key)) ||
    Object.keys(binding).length !== PROJECT_BINDING_KEYS.size ||
    typeof binding.projectId !== "string" ||
    !binding.projectId.trim() ||
    binding.projectId !== binding.projectId.trim() ||
    typeof binding.immutableProjectUuid !== "string" ||
    !IMMUTABLE_PROJECT_UUID.test(binding.immutableProjectUuid) ||
    !Number.isSafeInteger(binding.projectGeneration) ||
    binding.projectGeneration < 1
  ) {
    throw new ProjectBindingValidationError();
  }
}
