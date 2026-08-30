import type { TaskKind } from '../../workbench/api/taskApi'

export type ComfyCandidateUiState = { vendorKey: string; modelKey: string; revisionId: string; taskKind: TaskKind }

type MutationResult =
  | { ok: true; kind: string; taskKind: string; vendorKey: string; modelKey: string; revisionId: string }
  | { ok: false; error: string }

type Settlement =
  | { ok: true; revisionId: string; active: { vendorKey: string; modelKey: string } }
  | { ok: false; revisionId: string; reasonCode: string; params: Record<string, string | number | boolean> }

export function candidateFromWorkflowMutation(result: MutationResult): ComfyCandidateUiState | null {
  return result.ok ? {
    vendorKey: result.vendorKey,
    modelKey: result.modelKey,
    revisionId: result.revisionId,
    taskKind: result.taskKind as TaskKind,
  } : null
}

export function settleCandidateUiRun(current: ComfyCandidateUiState | null, result: Settlement): {
  applied: boolean
  candidate: ComfyCandidateUiState | null
  active?: { vendorKey: string; modelKey: string }
} {
  if (!current || current.revisionId !== result.revisionId) return { applied: false, candidate: current }
  return result.ok
    ? { applied: true, candidate: null, active: result.active }
    : { applied: true, candidate: null }
}

export function candidateFailureText(result: Extract<Settlement, { ok: false }>): string {
  const details = Object.entries(result.params).map(([key, value]) => `${key}=${String(value)}`).join(', ')
  return details ? `${result.reasonCode} (${details})` : result.reasonCode
}
