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
  /**
   * Host IPC accepts three things this union used to hide: the reducer
   * mutations, a tool decision, and the two live turn controls. `turn.steer`
   * and `turn.interrupt` have been handled in main since the coordinator
   * landed; the renderer simply had no name for them, so the "继续" and real
   * "中断" affordances had nothing to call.
   */
  type: ProjectAgentMutationType | 'tool.decision' | 'turn.steer' | 'turn.interrupt'
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
