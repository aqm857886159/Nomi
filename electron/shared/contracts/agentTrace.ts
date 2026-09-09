/** Local trace navigation returns status only; renderer never supplies a filesystem path. */
export type AgentTraceOpenResult =
  | { ok: true }
  | { ok: false; reason: 'no-project' | 'invalid-lane' | 'project-changed' | 'open-failed' };
