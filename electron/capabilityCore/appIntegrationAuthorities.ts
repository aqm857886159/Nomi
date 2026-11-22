import type { RpcServerOptions } from './rpcServer'
import { createGenerationGateAnswers, type ClientGateAnswer } from './runOwnedGenerationGateAuthority'
import { currentProjectRevision, getApprovalReceiptAuthority } from './approvalReceiptRuntime'
import type { DispatchContext } from './dispatcher'
import { requestRendererDecision, rendererTargetIdentity } from './rendererBridge'
import { createProductionProjectSessionRuntime } from './projectSessionRuntime'
import { canvasReadSurfaceRuntime } from './canvasReadSurfaceRuntime'
import { logError } from '../logging/logger'

/**
 * Build the process-owned authorities used by the capability-core RPC server.
 * Keeping this receipt/session wiring outside appIntegration keeps startup
 * orchestration focused on lifecycle and provider assembly.
 */
export function createDefaultAuthorities(hooks: {
  /**
   * P4 S4 试拍首镜: called when a multi-shot confirmation card resolves
   * trialFirst. Narrows the plan to shot 1 and re-seals it durably.
   */
  onTrialFirst?: (input: { projectId: string; operationId: string }) => void | Promise<void>
} = {}): Pick<
  DispatchContext,
  'approvalReceiptAuthority' | 'projectRevisionResolver' | 'confirmGenerationInNomi'
> & Pick<RpcServerOptions, 'projectSessionAuthority' | 'verifyClientGenerationGateInMain'> {
  const projectSession = createProductionProjectSessionRuntime({
    getOpenProjectSelection: canvasReadSurfaceRuntime.getCommittedProjectSelection,
    // Existing non-current projects are not implicitly authorized merely
    // because they exist. A future allowlist must be an explicit policy.
    isServerAllowlisted: () => false,
  })
  // 进程内唯一的人证权威（制作 Run 服务拿的是同一个实例，见 approvalReceiptRuntime.ts）。
  const receiptAuthority = getApprovalReceiptAuthority()
  // 两种问人的地方（Nomi 里的卡、外部客户端的确认框）都交给生成门主人判、由它签；这里只接线。
  const answers = createGenerationGateAnswers({
    receipts: receiptAuthority,
    requestRendererDecision,
    rendererTargetIdentity,
    onTrialFirst: hooks.onTrialFirst,
    onTrialFirstError: (error) => logError('capability', 'trial-first-narrow-failed', error),
  })
  const confirmGenerationInNomi = (input: { challengeToken: string }, options?: { signal?: AbortSignal }) =>
    answers.confirmInNomi(input, options)
  const verifyClientGenerationGateInMain = async (input: { challengeToken: string; authenticatedClient: string; answer?: ClientGateAnswer }) =>
    answers.answerFromClient({ challengeToken: input.challengeToken, client: input.authenticatedClient, answer: input.answer })
  return {
    projectSessionAuthority: projectSession.authority,
    approvalReceiptAuthority: receiptAuthority,
    confirmGenerationInNomi,
    verifyClientGenerationGateInMain,
    projectRevisionResolver: currentProjectRevision,
  }
}
