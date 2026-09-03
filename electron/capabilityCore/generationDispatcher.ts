import { hasGenerationBinding } from './generationBindingGuard'
import {
  createMcpGenerationPolicy,
  type McpGenerationCapability,
  type McpGenerationPolicy,
} from './mcpGenerationPolicy'
import type { HumanApprovalReceiptV1 } from './approvalReceipt'
import type { ProjectLeaseV2 } from './projectLease'
import type { DispatchContext } from './dispatcher'
import { RpcError, type RpcPolicyErrorCode, type RpcPolicyErrorDetails } from './rpcError'

const SEMANTIC_GENERATION_ROUTES: Readonly<Record<string, Readonly<{
  capability: McpGenerationCapability
  contextRead?: boolean
  requiresLease?: boolean
  requiresReceipt?: boolean
}>>> = Object.freeze({
  nomi_get_generation_context: { capability: 'context', contextRead: true },
  nomi_operation_create: { capability: 'create' },
  nomi_submit_generation_plan: { capability: 'plan' },
  nomi_preview_execution: { capability: 'preview' },
  nomi_request_generation_gate: { capability: 'gate_request' },
  nomi_decide_generation_gate: { capability: 'gate_decide', requiresReceipt: true },
  nomi_start_generation: { capability: 'start' },
  nomi_operation_read: { capability: 'read' },
  nomi_subscribe_run: { capability: 'events' },
  nomi_cancel_generation: { capability: 'cancel' },
  nomi_reconcile_generation: { capability: 'reconcile' },
  nomi_steer_generation: { capability: 'steer' },
  nomi_get_artifact: { capability: 'read' },
  nomi_propose_adopt_artifact: { capability: 'create' },
})

const LEGACY_ROUTE_CAPABILITY: Readonly<Record<string, McpGenerationCapability>> = Object.freeze({
  generate: 'create',
  nomi_generate: 'create',
  'production.start': 'create',
  'production.get': 'read',
  'production.events': 'events',
  'production.artifact': 'read',
  'production.artifact.read': 'read',
  'production.artifact.revise': 'plan',
  'production.artifact.review': 'plan',
  'production.storyboard.materialize': 'create',
  'production.control': 'cancel',
  'production.decide-gate': 'gate_decide',
  nomi_start_playbook: 'create',
})

function policyError(
  details: RpcPolicyErrorDetails,
  message = `generation.single-shot ${details.code}`,
): RpcError {
  return new RpcError(message, 403, details)
}

function unavailableSemanticRoute(policy: McpGenerationPolicy, capability: McpGenerationCapability): RpcError {
  const snapshot = policy.snapshot()
  return policyError({
    code: 'not_ready',
    nextAction: snapshot.nextAction,
    phase: snapshot.phase,
    capability,
  }, `generation.single-shot ${capability} is not ready`)
}

export function guardLegacyGenerationRoute(policy: McpGenerationPolicy, route: string, params: Record<string, unknown>): void {
  if (!hasGenerationBinding(params)) return
  const snapshot = policy.snapshot()
  const capability = LEGACY_ROUTE_CAPABILITY[route] ?? 'create'
  throw policyError({
    code: 'legacy_path_forbidden',
    nextAction: snapshot.nextAction,
    phase: snapshot.phase,
    capability,
  }, `Legacy route ${route} cannot carry generation.single-shot bindings`)
}

function leaseFailureCode(error: unknown): Extract<RpcPolicyErrorCode, 'lease_invalid' | 'project_scope_changed' | 'project_binding_stale' | 'lease_expired' | 'lease_revoked'> {
  const code = error && typeof error === 'object' && 'code' in error
    ? (error as { code?: unknown }).code
    : undefined
  const message = error instanceof Error ? error.message : ''
  if (code === 'project_binding_stale') return code
  if (code === 'project_scope_changed'
    && (/does not match (?:the )?current scope|scope is insufficient/i.test(message))) return code
  if (code === 'lease_expired' || code === 'lease_revoked') return code
  return 'lease_invalid'
}

function leaseScopeForCapability(capability: McpGenerationCapability): string {
  switch (capability) {
    case 'context': return 'context:read'
    case 'read': return 'generation:read'
    case 'events': return 'generation:events'
    case 'create': return 'generation:create'
    case 'plan': return 'generation:plan'
    case 'preview': return 'generation:preview'
    case 'gate_request':
    case 'gate_decide': return 'generation:gate'
    case 'start': return 'generation:submit'
    case 'cancel':
    case 'steer': return 'generation:control'
    case 'reconcile': return 'generation:reconcile'
  }
}

function policyDetails(policy: McpGenerationPolicy, capability: McpGenerationCapability, code: RpcPolicyErrorCode, nextAction = policy.snapshot().nextAction): RpcPolicyErrorDetails {
  const snapshot = policy.snapshot()
  return { code, nextAction, phase: snapshot.phase, capability }
}

async function requireProjectLease(
  params: Record<string, unknown>,
  capability: McpGenerationCapability,
  ctx: DispatchContext,
  policy: McpGenerationPolicy,
): Promise<{ params: Record<string, unknown>; lease: ProjectLeaseV2 }> {
  const token = typeof params.leaseHandle === 'string' ? params.leaseHandle.trim() : ''
  if (!token) throw policyError(policyDetails(policy, capability, 'lease_required'), 'A verified project lease is required')
  if (!ctx.projectSession) throw policyError(policyDetails(policy, capability, 'lease_required'), 'Project session authority is unavailable')
  const expectedProjectId = typeof params.projectId === 'string' && params.projectId.trim()
    ? params.projectId.trim()
    : undefined
  try {
    const lease = await ctx.projectSession.authority.verifyLease(token, {
      connection: ctx.projectSession.connection,
      projectHint: expectedProjectId,
      scope: leaseScopeForCapability(capability),
    })
    return { params: { ...params, projectId: lease.projectId }, lease }
  } catch (error) {
    const code = leaseFailureCode(error)
    throw policyError(policyDetails(policy, capability, code), error instanceof Error ? error.message : 'Project lease is invalid')
  }
}

function requireApprovalReceipt(
  params: Record<string, unknown>,
  lease: ProjectLeaseV2,
  capability: McpGenerationCapability,
  ctx: DispatchContext,
  policy: McpGenerationPolicy,
): HumanApprovalReceiptV1 {
  const reject = (code: Extract<RpcPolicyErrorCode, 'human_approval_required' | 'receipt_invalid' | 'receipt_expired'>, message: string): never => {
    throw policyError(policyDetails(policy, capability, code), message)
  }
  const authority = ctx.approvalReceiptAuthority
  if (!authority) {
    throw policyError(
      policyDetails(policy, capability, 'human_approval_required'),
      'A main-process human approval receipt is required',
    )
  }
  if (params.approved !== undefined || params.confirm !== undefined || params.spendConfirmed !== undefined) {
    reject('human_approval_required', 'Approval booleans cannot replace a Nomi human approval receipt')
  }
  const receiptId = typeof params.receiptId === 'string' ? params.receiptId.trim() : ''
  const suppliedToken = typeof params.receiptToken === 'string' ? params.receiptToken.trim() : ''
  if (!receiptId && !suppliedToken) reject('human_approval_required', 'A verified generation gate receipt is required')
  try {
    const token = suppliedToken || authority.resolveReceiptToken(receiptId)
    const receipt = authority.verifyReceipt(token)
    const currentProjectRevision = ctx.projectRevisionResolver?.(lease.projectId)
    if (!Number.isInteger(currentProjectRevision)) reject('receipt_invalid', 'Current project revision is unavailable')
    if (params.projectRevision !== undefined && Number(params.projectRevision) !== currentProjectRevision) {
      reject('receipt_invalid', 'Generation approval receipt project revision does not match the current project')
    }
    const bodyBinding: Array<[keyof HumanApprovalReceiptV1, unknown]> = [
      ['projectId', lease.projectId],
      ['immutableProjectUuid', lease.immutableProjectUuid],
      ['projectGeneration', lease.projectGeneration],
      ['runId', params.runId],
      ['gateId', params.gateId],
      ['contractHash', params.contractHash],
      ['targetHash', params.targetHash],
      ['projectRevision', currentProjectRevision],
      ['costScope', params.costScope],
      ['pricingSnapshotHash', params.pricingSnapshotHash],
    ]
    for (const [key, expected] of bodyBinding) {
      if (expected !== undefined && expected !== null && String(receipt[key]) !== String(expected)) {
        reject('receipt_invalid', 'Generation approval receipt ' + String(key) + ' does not match the current scope')
      }
    }
    if (receiptId && receipt.receiptId !== receiptId) reject('receipt_invalid', 'Generation approval receipt id is invalid')
    return receipt
  } catch (caught) {
    if (caught instanceof RpcError) throw caught
    const code = caught && typeof caught === 'object' && 'code' in caught
      ? (caught as { code?: unknown }).code
      : undefined
    if (code === 'receipt_expired') reject('receipt_expired', caught instanceof Error ? caught.message : 'Approval receipt expired')
    return reject('receipt_invalid', caught instanceof Error ? caught.message : 'Approval receipt is invalid')
  }
}

async function dispatchSemanticStub(
  route: Readonly<{ capability: McpGenerationCapability; contextRead?: boolean; requiresLease?: boolean; requiresReceipt?: boolean }>,
  params: Record<string, unknown>,
  ctx: DispatchContext,
  policy: McpGenerationPolicy,
): Promise<unknown> {
  const decision = policy.decide(route.capability)
  if (decision.kind === 'blocked') {
    throw policyError({
      code: decision.code,
      nextAction: decision.nextAction,
      phase: decision.phase,
      capability: decision.capability,
    })
  }
  if (route.contextRead && typeof ctx.generationContext !== 'function' && typeof ctx.generationPlanning !== 'function') {
    throw unavailableSemanticRoute(policy, route.capability)
  }
  const leased = route.requiresLease === false
    ? { params, lease: undefined }
    : await requireProjectLease(params, route.capability, ctx, policy)
  if (route.capability === 'gate_request') {
    if (!leased.lease) throw policyError({
      code: 'lease_required',
      nextAction: policy.snapshot().nextAction,
      phase: policy.snapshot().phase,
      capability: route.capability,
    })
    if (typeof ctx.requestGenerationGate === 'function') {
      return ctx.requestGenerationGate({ params: leased.params, lease: leased.lease })
    }
    if (typeof ctx.generationPlanning === 'function') {
      const planned = await ctx.generationPlanning({ capability: route.capability, params: leased.params, lease: leased.lease, origin: ctx.origin })
      const value = planned && typeof planned === 'object' && !Array.isArray(planned)
        ? planned as Record<string, unknown>
        : null
      const authority = ctx.approvalReceiptAuthority
      const contractHash = typeof value?.contractHash === 'string' ? value.contractHash.trim() : ''
      const projectRevision = ctx.projectRevisionResolver?.(leased.lease.projectId)
      if (!authority || !contractHash || !Number.isInteger(projectRevision)) {
        return planned
      }
      const verifiedProjectRevision = projectRevision as number
      const model = typeof value?.model === 'string' ? value.model : '当前模型'
      const maximumCost = typeof value?.maximumCost === 'number' && Number.isFinite(value.maximumCost) ? value.maximumCost : 0
      const challenge = authority.requestChallenge({
        challengeKey: `generation.single-shot:${leased.lease.projectId}:${String(value?.operationId || '')}:${contractHash}`,
        immutableProjectUuid: leased.lease.immutableProjectUuid,
        projectGeneration: leased.lease.projectGeneration,
        projectId: leased.lease.projectId,
        runId: typeof value?.operationId === 'string' ? value.operationId : String(leased.params.operationId || ''),
        gateId: `generation-gate:${String(value?.operationId || leased.params.operationId || '')}`,
        contractHash,
        targetHash: contractHash,
        projectRevision: verifiedProjectRevision,
        revocationEpoch: leased.lease.revocationEpoch,
        costScope: typeof value?.costScope === 'string' ? value.costScope : 'generation.single-shot',
        pricingSnapshotHash: contractHash,
        reservationPreview: {
          currency: typeof value?.currency === 'string' ? value.currency : 'CNY',
          maximum: maximumCost,
        },
        display: {
          model,
          shotSummary: typeof value?.shotSummary === 'string' ? value.shotSummary : undefined,
          referenceCount: typeof value?.referenceCount === 'number' ? value.referenceCount : undefined,
          // P4 S4: thread the multi-shot projection into the MAC-signed challenge so the per-shot rows the
          // user sees are tamper-proof. Present only for a multi-shot gate_request; single-shot omits it.
          ...(value?.shots && typeof value.shots === 'object' && !Array.isArray(value.shots) ? { shots: value.shots as never } : {}),
        },
      })
      return {
        ...value,
        challengeId: challenge.challenge.challengeId,
        nonce: challenge.challenge.nonce,
        expiresAt: challenge.challenge.expiresAt,
        model,
        costScope: challenge.challenge.costScope,
        maximumCost: challenge.challenge.reservationPreview.maximum,
        currency: challenge.challenge.reservationPreview.currency,
        handoff: { challengeToken: challenge.token, clientAttestation: true, contractHash, operationId: value?.operationId },
      }
    }
  }
  if (route.requiresReceipt) {
    if (!leased.lease) throw policyError({
      code: 'lease_required',
      nextAction: policy.snapshot().nextAction,
      phase: policy.snapshot().phase,
      capability: route.capability,
    })
    const receipt = requireApprovalReceipt(leased.params, leased.lease, route.capability, ctx, policy)
    if (ctx.authorizeGeneration) {
      const leaseToken = typeof leased.params.leaseHandle === 'string' ? leased.params.leaseHandle : ''
      if (!leaseToken || !ctx.projectSession) throw policyError({
        code: 'lease_required',
        nextAction: policy.snapshot().nextAction,
        phase: policy.snapshot().phase,
        capability: route.capability,
      })
      const upgraded = await ctx.projectSession.authority.authorizeGenerationSubmit(
        leaseToken,
        ctx.projectSession.connection,
      )
      const result = await ctx.authorizeGeneration({
        params: { ...leased.params, leaseHandle: upgraded.token },
        lease: upgraded.lease,
        receipt,
      })
      const receiptToken = typeof leased.params.receiptToken === 'string' && leased.params.receiptToken.trim()
        ? leased.params.receiptToken.trim()
        : ctx.approvalReceiptAuthority?.resolveReceiptToken(receipt.receiptId)
      if (receiptToken) ctx.approvalReceiptAuthority?.consumeReceipt(receiptToken)
      return result && typeof result === 'object' && !Array.isArray(result)
        ? { ...(result as Record<string, unknown>), leaseHandle: upgraded.token }
        : { result, leaseHandle: upgraded.token }
    }
    if (typeof ctx.generationPlanning === 'function' && route.capability === 'gate_decide') {
      const leaseToken = typeof leased.params.leaseHandle === 'string' ? leased.params.leaseHandle : ''
      if (!leaseToken || !ctx.projectSession) {
        throw policyError(policyDetails(policy, route.capability, 'lease_required'), 'A verified project lease is required')
      }
      const upgraded = await ctx.projectSession.authority.authorizeGenerationSubmit(
        leaseToken,
        ctx.projectSession.connection,
      )
      const receiptToken = typeof leased.params.receiptToken === 'string' && leased.params.receiptToken.trim()
        ? leased.params.receiptToken.trim()
        : ctx.approvalReceiptAuthority?.resolveReceiptToken(receipt.receiptId)
      const result = await ctx.generationPlanning({
        capability: route.capability,
        params: { ...leased.params, leaseHandle: upgraded.token, receiptId: receipt.receiptId, receiptToken },
        lease: upgraded.lease,
        origin: ctx.origin,
      })
      if (receiptToken) ctx.approvalReceiptAuthority?.consumeReceipt(receiptToken)
      return result && typeof result === 'object' && !Array.isArray(result)
        ? { ...(result as Record<string, unknown>), leaseHandle: upgraded.token }
        : { result, leaseHandle: upgraded.token }
    }
  }
  if (route.contextRead && typeof ctx.generationContext === 'function') return ctx.generationContext(leased.params)
  if (typeof ctx.generationPlanning === 'function'
    && route.capability !== 'gate_request'
    && route.capability !== 'gate_decide') {
    return ctx.generationPlanning({ capability: route.capability, params: leased.params, lease: leased.lease, origin: ctx.origin })
  }
  throw unavailableSemanticRoute(policy, route.capability)
}

export async function dispatchSemanticGeneration(
  method: string,
  params: Record<string, unknown>,
  ctx: DispatchContext,
): Promise<unknown> {
  const policy = ctx.generationPolicy ?? createMcpGenerationPolicy()
  const route = SEMANTIC_GENERATION_ROUTES[method]
  if (!route) return undefined
  return dispatchSemanticStub(route, params, ctx, policy)
}

export function isSemanticGenerationRoute(method: string): boolean {
  return Boolean(SEMANTIC_GENERATION_ROUTES[method])
}
