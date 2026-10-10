import { isLocalProcessingProgressPhase } from './localProcessingPhase'

/** Availability derives from the actual task receipt, shared by canvas and task center. */
export function canInterruptGenerationTask(node: { progress?: { phase?: string; taskId?: string } | null } | undefined): boolean {
  return node?.progress?.phase === 'comfyui-node' || node?.progress?.phase === 'comfyui-queued'
    || isLocalProcessingProgressPhase(node?.progress?.phase)
    || !!node?.progress?.taskId?.startsWith('local-')
}
