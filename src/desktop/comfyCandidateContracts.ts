export type ComfyCandidateTestPayload = {
  vendor: string
  candidate: { revisionId: string; modelKey: string; taskKind: string }
  request: { kind: string; prompt: string; extras: Record<string, unknown> }
}

export type ComfyCandidateTestResult =
  | { ok: true; revisionId: string; active: { vendorKey: string; modelKey: string } }
  | { ok: false; revisionId: string; reasonCode: string; params: Record<string, string | number | boolean> }

export type ComfyWorkflowMutationResult =
  | { ok: true; modelKey: string; kind: string; taskKind: string; vendorKey: string; revisionId: string }
  | { ok: false; error: string }
