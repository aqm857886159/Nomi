import type { ProjectAgentExecutionEvent, ProjectAgentHostState, ProjectAgentMutationType, ProjectAgentPatch, ProjectBinding } from '../../electron/shared/projectAgentContracts'
import type {
  ProjectAgentProposalReceiptClear,
  ProjectAgentProposalReceiptTransition,
  ProjectAgentProposalReceiptView,
  ProjectAgentProposalReceiptWrite,
} from '../../electron/shared/projectAgentProposalReceipt'

export type ProjectAgentCommandWire = {
  subscriptionId: string
  clientCommandId: string
  knownRevision: number
  type: ProjectAgentMutationType | 'tool.decision'
  payload: unknown
}

export type ProjectAgentBridge = {
  open: (binding: ProjectBinding) => Promise<{
    subscriptionId: string
    subscriptionEpoch: number
    snapshot: ProjectAgentHostState
    proposalReceipt: ProjectAgentProposalReceiptView | null
  }>
  snapshot: (subscriptionId: string) => Promise<ProjectAgentHostState>
  command: (command: Omit<ProjectAgentCommandWire, 'subscriptionId'> & { subscriptionId: string }) => Promise<{
    state: ProjectAgentHostState
    patch: ProjectAgentPatch | null
    replayed: boolean
    snapshotRequired?: boolean
  }>
  /** single-shot（判官/方向规划）：跑同一套运行时，但不产生 Host 回合，也不写用户会话。 */
  runEphemeral: (
    subscriptionId: string,
    request: unknown,
    attachmentClaims: readonly unknown[],
  ) => Promise<{ text: string; usage?: unknown }>
  release: (subscriptionId: string) => Promise<{ released: true }>
  readProposalReceipt: (subscriptionId: string) => Promise<ProjectAgentProposalReceiptView | null>
  writeProposalReceipt: (
    subscriptionId: string,
    input: ProjectAgentProposalReceiptWrite,
  ) => Promise<ProjectAgentProposalReceiptView>
  transitionProposalReceipt: (
    subscriptionId: string,
    input: ProjectAgentProposalReceiptTransition,
  ) => Promise<ProjectAgentProposalReceiptView>
  clearProposalReceipt: (
    subscriptionId: string,
    input: ProjectAgentProposalReceiptClear,
  ) => Promise<{ cleared: true; receipt: ProjectAgentProposalReceiptView }>
  onPatch?: (handler: (patch: ProjectAgentPatch) => void) => () => void
  onEvent?: (handler: (event: ProjectAgentExecutionEvent) => void) => () => void
}
