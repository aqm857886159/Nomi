// Feature keys are attribution only, never a durable conversation binding: a
// thread's persistent context is minted by the Host from the project's immutable
// identity (`electron/shared/contracts/projectAgentContextBinding.ts`).
export function sessionKeyFor(spec: { feature: string; area?: string; projectId?: string | null }): string {
  const pid = spec.projectId?.trim() || 'local'
  const base = `nomi:${spec.feature}:${pid}`
  return spec.area ? `${base}:${spec.area}` : base
}

export function directionSessionKey(projectId?: string): string {
  return sessionKeyFor({ feature: 'production-directions', projectId })
}
export function shotVerifySessionKey(projectId?: string): string {
  return sessionKeyFor({ feature: 'shot-verify', projectId })
}
export function productionScriptSessionKey(projectId?: string): string {
  return sessionKeyFor({ feature: 'production-script', projectId })
}
