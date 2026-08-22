import type { CapabilityOriginHost } from './security'
import { hasGenerationBinding } from './generationBindingGuard'
import {
  createMcpGenerationPolicy,
  type McpGenerationCapability,
  type McpGenerationPolicy,
} from './mcpGenerationPolicy'
import type { HumanApprovalReceiptV1 } from './approvalReceipt'
import type { ProjectLeaseV1 } from './projectLease'
import type { DispatchContext } from './dispatcher'
import { RpcError, type RpcPolicyErrorCode, type RpcPolicyErrorDetails } from './rpcError'

type RegisteredMcpClient = Extract<CapabilityOriginHost, 'claude' | 'codex' | 'cursor'>

function isRegisteredMcpClient(value: CapabilityOriginHost | undefined): value is RegisteredMcpClient {
  return value === 'claude' || value === 'codex' || value === 'cursor'
}

const SEMANTIC_GENERATION_ROUTES: Readonly<Record<string, Readonly<{
  capability: McpGenerationCapability
  contextRead?: boolean
  requiresLease?: boolean
  requiresReceipt?: boolean
  sessionOpen?: boolean
}>>> = Object.freeze({
  nomi_session_open: { capability: 'context', requiresLease: false, sessionOpen: true },
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
  'production.generate-node': 'start',
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

function leaseFailureCode(error: unknown): Extract<RpcPolicyErrorCode, 'lease_invalid' | 'project_scope_changed' | 'lease_expired' | 'lease_revoked'> {
  const code = error && typeof error === 'object' && 'code' in error
    ? (error as { code?: unknown }).code
    : undefined
  const message = error instanceof Error ? error.message : ''
  if (code === 'project_scope_changed'
    && (/does not match current scope|scope is insufficient/i.test(message))) return code
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

function assertOnlyFields(params: Record<string, unknown>, allowed: Set<string>): void {
  const unexpected = Object.keys(params).find((key) => !allowed.has(key))
  if (unexpected) throw new RpcError(`Production field is not allowed: ${unexpected}`, 400)
}

function policyDetails(policy: McpGenerationPolicy, capability: McpGenerationCapability, code: RpcPolicyErrorCode, nextAction = policy.snapshot().nextAction): RpcPolicyErrorDetails {
  const snapshot = policy.snapshot()
  return { code, nextAction, phase: snapshot.phase, capability }
}

function requireProjectLease(
  params: Record<string, unknown>,
  capability: McpGenerationCapability,
  ctx: DispatchContext,
  policy: McpGenerationPolicy,
): { params: Record<string, unknown>; lease: ProjectLeaseV1 } {
  const token = typeof params.leaseHandle === 'string' ? params.leaseHandle.trim() : ''
  if (!token) throw policyError(policyDetails(policy, capability, 'lease_required'), 'A verified project lease is required')
  if (!ctx.projectLeaseAuthority) throw policyError(policyDetails(policy, capability, 'lease_required'), 'Project lease authority is unavailable')
  const expectedProjectId = typeof params.projectId === 'string' && params.projectId.trim()
    ? params.projectId.trim()
    : undefined
  try {
    const lease = ctx.projectLeaseAuthority.verifyLease(token, {
      projectId: expectedProjectId,
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
  lease: ProjectLeaseV1,
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

function openProjectLease(
  params: Record<string, unknown>,
  ctx: DispatchContext,
  policy: McpGenerationPolicy,
): Record<string, unknown> {
  const snapshot = policy.snapshot()
  const missing = (message: string): never => {
    throw policyError({
      code: 'lease_required',
      nextAction: snapshot.nextAction,
      phase: snapshot.phase,
      capability: 'context',
    }, message)
  }
  assertOnlyFields(params, new Set(['projectSelectionHandle', 'bootstrap']))
  const selectionToken = typeof params.projectSelectionHandle === 'string' ? params.projectSelectionHandle.trim() : ''
  const bootstrap = params.bootstrap
  if (selectionToken && bootstrap !== undefined) missing('Choose a signed project selection handle or current-project bootstrap, not both')
  const authority = ctx.projectLeaseAuthority
  const resolveProjectSelection = ctx.resolveProjectSelection
  const resolveCurrentProject = ctx.resolveCurrentProject
  if (!authority || (!resolveProjectSelection && !resolveCurrentProject)) {
    throw policyError({
      code: 'lease_required',
      nextAction: snapshot.nextAction,
      phase: snapshot.phase,
      capability: 'context',
    }, 'Project lease authority is unavailable')
  }
  try {
    let handleToken = selectionToken
    let session: ReturnType<NonNullable<DispatchContext['resolveProjectSelection']>>
    if (bootstrap !== undefined) {
      if (!bootstrap || typeof bootstrap !== 'object' || Array.isArray(bootstrap)) throw new RpcError('Invalid current-project bootstrap', 400)
      assertOnlyFields(bootstrap as Record<string, unknown>, new Set(['mode', 'clientSessionNonce']))
      const mode = (bootstrap as Record<string, unknown>).mode
      const clientSessionNonce = (bootstrap as Record<string, unknown>).clientSessionNonce
      const client = ctx.origin?.host
      if (mode !== 'current_project' || typeof clientSessionNonce !== 'string' || !clientSessionNonce.trim() || clientSessionNonce.length > 200) {
        throw new RpcError('Invalid current-project bootstrap', 400)
      }
      if (!isRegisteredMcpClient(client)) {
        throw policyError({
          code: 'lease_required',
          nextAction: snapshot.nextAction,
          phase: snapshot.phase,
          capability: 'context',
        }, 'A registered MCP client is required for current-project bootstrap')
      }
      const currentProjectResolver = resolveCurrentProject
      if (typeof currentProjectResolver !== 'function') {
        throw policyError({
          code: 'lease_required',
          nextAction: snapshot.nextAction,
          phase: snapshot.phase,
          capability: 'context',
        }, 'Current-project bootstrap is unavailable')
      }
      const current = currentProjectResolver({ client, clientSessionNonce: clientSessionNonce.trim() })
      if (!current.projectId || !current.immutableProjectUuid || !Number.isInteger(current.projectGeneration)
        || !current.canonicalRootDigest || !current.manifestDigest || !current.leasePrincipal
        || !current.sessionId || !current.connectionNonce || !current.serverNonce) {
        missing('Current-project identity is incomplete')
      }
      const issuedHandle = authority.issueSelectionHandle({
        immutableProjectUuid: current.immutableProjectUuid,
        projectGeneration: current.projectGeneration,
        canonicalRootDigest: current.canonicalRootDigest,
        manifestDigest: current.manifestDigest,
        revocationEpoch: current.revocationEpoch,
        scopeSet: ['context:read'],
      })
      handleToken = issuedHandle.token
      session = current
    } else {
      if (!selectionToken) missing('A signed project selection handle or current-project bootstrap is required')
      const projectSelectionResolver = resolveProjectSelection
      if (typeof projectSelectionResolver !== 'function') {
        throw policyError({
          code: 'lease_required',
          nextAction: snapshot.nextAction,
          phase: snapshot.phase,
          capability: 'context',
        }, 'Project selection resolver is unavailable')
      }
      const handle = authority.verifySelectionHandle(selectionToken)
      session = projectSelectionResolver(handle)
    }
    if (!session.projectId || !session.leasePrincipal || !session.sessionId || !session.connectionNonce || !session.serverNonce) {
      missing('Project lease session binding is incomplete')
    }
    const issued = authority.issueLease(handleToken, {
      projectId: session.projectId,
      leasePrincipal: session.leasePrincipal,
      sessionId: session.sessionId,
      connectionNonce: session.connectionNonce,
    })
    return {
      protocolVersion: 1,
      sessionId: issued.lease.sessionId,
      leaseHandle: issued.token,
      immutableProjectUuid: issued.lease.immutableProjectUuid,
      projectGeneration: issued.lease.projectGeneration,
      projectId: issued.lease.projectId,
      expiresAt: issued.lease.expiresAt,
      audience: issued.lease.audience,
      phase: snapshot.phase,
      effectiveScope: [...snapshot.effectiveScope],
      serverNonce: session.serverNonce,
    }
  } catch (error) {
    if (error instanceof RpcError) throw error
    const code = leaseFailureCode(error)
    throw policyError({
      code,
      nextAction: snapshot.nextAction,
      phase: snapshot.phase,
      capability: 'context',
    }, error instanceof Error ? error.message : 'Project selection handle is invalid')
  }
}

async function dispatchSemanticStub(
  route: Readonly<{ capability: McpGenerationCapability; contextRead?: boolean; requiresLease?: boolean; requiresReceipt?: boolean; sessionOpen?: boolean }>,
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
  if (route.sessionOpen) return openProjectLease(params, ctx, policy)
  if (route.contextRead && typeof ctx.generationContext !== 'function') {
    throw unavailableSemanticRoute(policy, route.capability)
  }
  const leased = route.requiresLease === false
    ? { params, lease: undefined }
    : requireProjectLease(params, route.capability, ctx, policy)
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
      if (!leaseToken || !ctx.projectLeaseAuthority) throw policyError({
        code: 'lease_required',
        nextAction: policy.snapshot().nextAction,
        phase: policy.snapshot().phase,
        capability: route.capability,
      })
      const upgraded = ctx.projectLeaseAuthority.upgradeLeaseScope(leaseToken, [
        ...leased.lease.scopeSet,
        'generation:submit',
      ])
      return ctx.authorizeGeneration({
        params: { ...leased.params, leaseHandle: upgraded.token },
        lease: upgraded.lease,
        receipt,
      })
    }
  }
  if (route.contextRead && typeof ctx.generationContext === 'function') return ctx.generationContext(leased.params)
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
