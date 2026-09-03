import path from 'node:path'

import type { RpcServerOptions } from './rpcServer'
import { capabilityCoreDir, ensureCapabilitySigningKey } from './security'
import { getWorkspaceRepositoryDeps } from '../runtimePaths'
import { readWorkspaceProject } from '../workspace/workspaceRepository'
import { createApprovalReceiptAuthority } from './approvalReceipt'
import { createProductionRunLock } from '../productionRun/productionRunLock'
import type { McpGenerationPolicy } from './mcpGenerationPolicy'
import type { DispatchContext } from './dispatcher'
import { requestRenderer, rendererTargetIdentity } from './rendererBridge'
import { createProductionProjectSessionRuntime } from './projectSessionRuntime'
import { canvasReadSurfaceRuntime } from './canvasReadSurfaceRuntime'

/**
 * Build the process-owned authorities used by the capability-core RPC server.
 * Keeping this receipt/session wiring outside appIntegration keeps startup
 * orchestration focused on lifecycle and provider assembly.
 */
export function createDefaultAuthorities(generationPolicy: McpGenerationPolicy, hooks: {
  /**
   * P4 S4 试拍首镜: called when a multi-shot confirmation card resolves
   * trialFirst. Narrows the plan to shot 1 and re-seals it durably.
   */
  onTrialFirst?: (input: { projectId: string; operationId: string }) => void | Promise<void>
} = {}): Pick<
  DispatchContext,
  'approvalReceiptAuthority' | 'projectRevisionResolver' | 'confirmGenerationInNomi'
> & Pick<RpcServerOptions, 'projectSessionAuthority' | 'verifyClientGenerationGateInMain'> {
  const authorityDir = capabilityCoreDir()
  const sharedLock = createProductionRunLock({
    filePath: path.join(authorityDir, 'semantic-authorities.lock'),
    epochPath: path.join(authorityDir, 'semantic-authorities.epoch'),
    ownerId: `capability-core-${process.pid}`,
  })
  const projectSession = createProductionProjectSessionRuntime({
    generationPolicy,
    getOpenProjectSelection: canvasReadSurfaceRuntime.getCommittedProjectSelection,
    // Existing non-current projects are not implicitly authorized merely
    // because they exist. A future allowlist must be an explicit policy.
    isServerAllowlisted: () => false,
  })
  const receiptAuthority = createApprovalReceiptAuthority({
    filePath: path.join(authorityDir, 'approval-receipts.json'),
    macKey: ensureCapabilitySigningKey('approval-receipt'),
    storeMacKey: ensureCapabilitySigningKey('approval-receipt-store'),
    keyId: 'approval-receipt-v1',
    lock: sharedLock,
  })
  const confirmGenerationInNomi = async ({ challengeToken }: { challengeToken: string }) => {
    const challenge = receiptAuthority.verifyChallenge(challengeToken)
    const target = rendererTargetIdentity()
    if (!target || !challenge.display?.model) return { confirmed: false, challengeId: challenge.challengeId }
    const result = await requestRenderer('generation.gate.confirm', {
      challengeId: challenge.challengeId,
      projectName: challenge.display.projectName,
      shotSummary: challenge.display.shotSummary,
      model: challenge.display.model,
      referenceCount: challenge.display.referenceCount,
      maximumCost: challenge.reservationPreview.maximum,
      currency: challenge.reservationPreview.currency,
      expiresAt: challenge.expiresAt,
      ...(challenge.display.shots ? { shots: challenge.display.shots } : {}),
    }, 60_000) as { confirmed?: unknown; trialFirst?: unknown } | null
    if (result?.confirmed !== true) {
      if (result?.trialFirst === true && hooks.onTrialFirst && challenge.runId && challenge.projectId) {
        try {
          await hooks.onTrialFirst({ projectId: challenge.projectId, operationId: challenge.runId })
        } catch (error) {
          console.error('[nomi:capability-core] trial-first narrow failed:', error instanceof Error ? error.message : String(error))
        }
      }
      return {
        confirmed: false,
        challengeId: challenge.challengeId,
        ...(result?.trialFirst === true ? { trialFirst: true } : {}),
      }
    }
    const attestation = receiptAuthority.createMainProcessGestureAttestation(challengeToken, {
      ...target,
      decision: 'accept',
    })
    const receipt = receiptAuthority.mintReceipt(challengeToken, attestation)
    return {
      confirmed: true,
      challengeId: challenge.challengeId,
      receiptId: receipt.receipt.receiptId,
      receiptToken: receipt.token,
    }
  }
  const verifyClientGenerationGateInMain = async ({ challengeToken, authenticatedClient }: { challengeToken: string; authenticatedClient: string }) => {
    const attestation = receiptAuthority.createClientElicitationAttestation(challengeToken, authenticatedClient)
    const receipt = receiptAuthority.mintReceipt(challengeToken, attestation)
    return {
      confirmed: true,
      receiptId: receipt.receipt.receiptId,
      receiptToken: receipt.token,
    }
  }
  return {
    projectSessionAuthority: projectSession.authority,
    approvalReceiptAuthority: receiptAuthority,
    confirmGenerationInNomi,
    verifyClientGenerationGateInMain,
    projectRevisionResolver: (projectId) => readWorkspaceProject(projectId, getWorkspaceRepositoryDeps())?.revision,
  }
}
