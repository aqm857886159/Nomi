import type { AgentModelEntry } from "../agentCapabilities/availableModels"
import type { ProjectAgentAttachmentRef } from '../workbenchInput'
import type { ProjectAgentAttachmentClaim } from '../workbenchInput'
import type { ProjectBinding } from '../projectBinding'
import type { ProjectAgentApprovalPolicy } from '../agentCapabilities/capabilityApprovalPolicy';
import type { AgentContextSnapshot } from '../agentContextSnapshot'
import type { PreconditionSet, TargetRef } from '../capabilityTargeting'
import type { LaneCommand, LaneCommandOutcome, LaneProjection } from './laneContracts'
import type { LaneErrorCode } from './laneErrorCodes'
import type { ProjectAgentProposalReceiptWrite, ProjectAgentProposalReceiptTransition, ProjectAgentProposalReceiptClear, ProjectAgentProposalReceiptView } from '../projectAgentProposalReceipt'

/** User input only. Model credentials and capability authority are resolved in main. */
export interface LaneComposerContext {
  model?: { vendorKey: string; modelKey: string }
  approvalPolicy: ProjectAgentApprovalPolicy
  documentId?: string
  target?: TargetRef
  preconditions?: PreconditionSet
  contextSnapshot?: AgentContextSnapshot
  availableModels?: readonly AgentModelEntry[]
  attachments?: readonly ProjectAgentAttachmentClaim[]
  systemPrompt?: string
  displayText?: string
  skillKey?: string
  /** Untrusted selector: main validates the stopped entry on this lane's current branch. */
  continueFromEntryId?: string
}

export type LaneReceiptCommand =
  | { kind: 'receipt-read' }
  | { kind: 'receipt-write'; input: ProjectAgentProposalReceiptWrite }
  | { kind: 'receipt-transition'; input: ProjectAgentProposalReceiptTransition }
  | { kind: 'receipt-clear'; input: ProjectAgentProposalReceiptClear }

export interface LaneSingleShotRequest {
  requestId: string
  projectId?: string
  featureKey: string
  prompt: string
  context: LaneComposerContext
}

export type LaneDesktopCommand = (LaneCommand | LaneReceiptCommand
  | ({ kind: 'single-shot' } & LaneSingleShotRequest)
  | { kind: 'single-shot-abort'; requestId: string }
  | { kind: 'workspace-open'; binding: ProjectBinding; model?: LaneComposerContext['model'] }
  | { kind: 'workspace-close' }
  | { kind: 'workspace-policy'; policy: ProjectAgentApprovalPolicy }
) & { workspaceId?: string; expectedLane?: string; context?: LaneComposerContext }

export interface LaneRestoredDesktopInput {
  text: string
  attachments?: readonly (ProjectAgentAttachmentClaim & Partial<ProjectAgentAttachmentRef>)[]
}

export type LaneDesktopResult =
  | ({ ok: true; workspaceId?: string; receipt?: ProjectAgentProposalReceiptView | null; cleared?: true; singleShot?: LaneProjection } & Omit<LaneCommandOutcome, 'restoredInput'> & { restoredInput?: readonly LaneRestoredDesktopInput[] })
  // 失败只出**码**。第二格刻意不叫 `message`——它不是给人看的话，是给日志/「技术详情」的诊断串
  // （可能是内部不变量断言、第三方栈文本，或一句没翻译的英文）。界面文案由渲染层按
  // `LANE_ERROR_TEXT_KEY[code]` 取；把这一格印到界面上就是 2026-09-11 那次红色英文原文泄漏。
  | { ok: false; code: LaneErrorCode; diagnostic: string }

/** pi's documented custom-message extension: persisted input, never executable authority. */
export interface LaneInputMessage {
  role: 'nomi.input'
  content: string
  timestamp: number
  context: LaneComposerContext
}
