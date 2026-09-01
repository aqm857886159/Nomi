export class ProjectAgentStateError extends Error {
  constructor(readonly code: "invalid_json_snapshot" | "invalid_project_binding" | "invalid_state") {
    super(code);
    this.name = "ProjectAgentStateError";
  }
}
