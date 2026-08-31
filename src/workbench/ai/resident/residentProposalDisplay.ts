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

function inferProposalFieldKind(field: ResidentApprovalDetail): ResidentProposalFieldKind {
  if (field.kind) return field.kind
  const label = field.label.toLocaleLowerCase()
  if (label.includes('提示词') || label.includes('prompt') || label.includes('内容') || label.includes('content')) return 'prompt'
  if (label.includes('预计费用') || label.includes('estimated cost') || label.includes('cost') || label.includes('费用')) return 'estimate'
  if (label === '模型' || label === 'model' || label.includes('模型') || label.includes('model')) return 'model'
  if (label.includes('参数') || label.includes('setting') || label.includes('parameter')) return 'parameters'
  if (label.includes('作用对象') || label.includes('target') || label.includes('scope') || label.includes('对象')) return 'target'
  if (label.includes('引用') || label.includes('reference')) return 'references'
  if (label.includes('执行边界') || label.includes('execution boundary') || label.includes('boundary')) return 'boundary'
  return 'technical'
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
