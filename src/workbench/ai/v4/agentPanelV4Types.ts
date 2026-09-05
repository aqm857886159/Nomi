import type { ProjectAgentApprovalPolicy } from '../../../../electron/shared/projectAgentContracts'

export type V4ToolStatus = 'input-streaming' | 'input-available' | 'approval-requested' | 'approval-responded' | 'output-available' | 'output-denied' | 'output-error'
export type V4AssistantStatus = 'streaming' | 'complete' | 'interrupted'
export type V4TaskStatus = 'queued' | 'running' | 'complete' | 'failed' | 'stopped'
export type V4InterventionKind = 'approval-irreversible' | 'approval-reversible' | 'reject-reason' | 'spend' | 'question' | 'plan' | 'credential' | 'deviation'
export type AgentPanelV4View = 'main' | 'feasible' | 'vocabulary-user' | 'composer' | 'model-popover' | 'skill-popover' | 'permission-step' | 'permission-project' | 'height-growth' | 'height-scroll' | 'process' | 'rendering' | 'sources' | 'flow-creation' | 'flow-generation' | 'flow-preview' | 'collapsed' | 'dark' | 'v4-task-queued' | 'v4-task-failed' | 'v4-task-stopped' | 'v4-intervention-question' | 'v4-intervention-plan' | 'v4-intervention-spend' | 'v4-intervention-credential' | 'v4-intervention-deviation' | 'v4-tool-input-streaming' | 'v4-tool-input-available' | 'v4-tool-approval-requested' | 'v4-tool-approval-responded' | 'v4-tool-output-available' | 'v4-tool-output-denied' | 'v4-tool-output-error'
export type ComposerMode = 'idle' | 'running' | 'reference'
export type PermissionLabel = '每步问' | '自动改' | '全自动'

export type ToolReceipt = Readonly<{ label: string; action: string; status: V4ToolStatus; elapsed?: string; detail?: string; skill?: boolean; attachment?: string; expanded?: boolean }>
export type TaskCardData = Readonly<{ title: string; status: V4TaskStatus; progress?: number; cost?: string; candidates?: readonly string[]; selected?: number; detail?: string }>
export type InterventionData = Readonly<{ kind: V4InterventionKind; title: string; summary: string; options?: readonly string[]; shots?: readonly string[]; cost?: string; reason?: string }>
export type QueueRowData = Readonly<{ title: string; status: 'queued' | 'running' | 'complete'; action?: string }>

export const PERMISSION_POLICIES: Readonly<Record<PermissionLabel, ProjectAgentApprovalPolicy>> = {
  '每步问': { mode: 'step', spend: 'confirm' },
  '自动改': { mode: 'safe-auto', spend: 'confirm' },
  '全自动': { mode: 'project', spend: 'within-budget' },
}
