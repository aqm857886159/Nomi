type CertificationModelIntent = {
  modelKey: string
  kind: string
}

export type CertificationIntent = {
  action: 'start' | 'retry'
  vendorKey?: string
  runId?: string
  modelKey?: string
  models?: readonly CertificationModelIntent[]
}

function identity(intent: CertificationIntent): string {
  return JSON.stringify({
    action: intent.action,
    vendorKey: String(intent.vendorKey || '').trim(),
    runId: String(intent.runId || '').trim(),
    modelKey: String(intent.modelKey || '').trim(),
    models: [...(intent.models || [])]
      .map((model) => ({ modelKey: model.modelKey.trim(), kind: model.kind }))
      .filter((model) => model.modelKey)
      .sort((left, right) => left.modelKey.localeCompare(right.modelKey) || left.kind.localeCompare(right.kind)),
  })
}

/**
 * One instance represents one mounted confirmation surface. A retransmission
 * of the same immutable contract reuses its key; changing the contract rotates
 * it. Call rotate only after the UI has received a definite terminal answer
 * and the user explicitly asks for a new operation.
 */
export class CertificationIntentKey {
  private currentIdentity = ''
  private currentKey = ''

  constructor(private readonly mint: () => string = () => globalThis.crypto.randomUUID()) {}

  for(intent: CertificationIntent): string {
    const nextIdentity = identity(intent)
    if (!this.currentKey || this.currentIdentity !== nextIdentity) {
      this.currentIdentity = nextIdentity
      this.currentKey = this.mint()
    }
    return this.currentKey
  }

  rotate(): void {
    this.currentIdentity = ''
    this.currentKey = ''
  }
}
