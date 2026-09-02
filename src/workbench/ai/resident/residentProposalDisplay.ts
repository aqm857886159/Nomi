/**
 * Presentation-only proposal field metadata.  The domain payload remains
 * owned by the Host; these hints only decide what is safe to show at a glance
 * and what belongs in the evidence disclosure.
 */
export type ResidentProposalFieldKind = 'prompt' | 'model' | 'parameters' | 'estimate' | 'target' | 'references' | 'boundary' | 'technical'
export type ResidentApprovalDetail = Readonly<{ label: string; value: string; kind?: ResidentProposalFieldKind }>
export type ResidentProposalData = Readonly<{ fields: readonly ResidentApprovalDetail[] }>

export type ResidentProposalFieldGroups = Readonly<{
  /** Fields suitable for the compact parameter bar. */
  compact: readonly ResidentApprovalDetail[]
  /** Prompt/content fields shown only after disclosure. */
  prompt: readonly ResidentApprovalDetail[]
  /** Full proposal fields, in their original order, for the evidence layer. */
  details: readonly ResidentApprovalDetail[]
  /** The estimate is promoted into the card header. */
  estimate?: ResidentApprovalDetail
}>

// Classification is a producer duty: every field carries its machine `kind`
// at construction (see residentToolDisplay). Text labels are presentation
// only — never parsed back, so locale changes cannot reroute a field.
function inferProposalFieldKind(field: ResidentApprovalDetail): ResidentProposalFieldKind {
  return field.kind ?? 'technical'
}

/**
 * Partition proposal fields once at the presentation boundary. Unknown fields
 * default to the evidence layer so a newly-added field can never make the
 * compact card unexpectedly tall or expose an implementation detail.
 */
export function partitionResidentProposalFields(fields: readonly ResidentApprovalDetail[]): ResidentProposalFieldGroups {
  const compact: ResidentApprovalDetail[] = []
  const prompt: ResidentApprovalDetail[] = []
  let estimate: ResidentApprovalDetail | undefined
  for (const field of fields) {
    switch (inferProposalFieldKind(field)) {
      case 'prompt':
        prompt.push(field)
        break
      case 'estimate':
        estimate ??= field
        break
      case 'model':
      case 'parameters':
      case 'target':
      case 'references':
        compact.push(field)
        break
      case 'boundary':
      case 'technical':
        break
    }
  }
  return { compact, prompt, details: fields, ...(estimate ? { estimate } : {}) }
}

export function residentProposalFieldKind(field: ResidentApprovalDetail): ResidentProposalFieldKind {
  return inferProposalFieldKind(field)
}
