// These bytes are existing project/area bucket identities. A thread is a
// separate binding field, never a suffix. Callers capture the project explicitly.
export type WorkbenchAgentArea = 'creation' | 'generation'

export function sessionKeyFor(spec: { feature: string; area?: string; projectId?: string | null }): string {
  const pid = spec.projectId?.trim() || 'local'
  const base = `nomi:${spec.feature}:${pid}`
  return spec.area ? `${base}:${spec.area}` : base
}

export function workbenchSessionKey(area: WorkbenchAgentArea, projectId: string | null): string {
  return sessionKeyFor({ feature: 'workbench', area, projectId })
}

// Feature keys are attribution only; single-shot tasks use ephemeral history.
export function directionSessionKey(projectId?: string): string {
  return sessionKeyFor({ feature: 'production-directions', projectId })
}
export function shotVerifySessionKey(projectId?: string): string {
  return sessionKeyFor({ feature: 'shot-verify', projectId })
}
export function productionScriptSessionKey(projectId?: string): string {
  return sessionKeyFor({ feature: 'production-script', projectId })
}
