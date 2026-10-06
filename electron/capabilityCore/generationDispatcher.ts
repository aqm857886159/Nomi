import { hasGenerationBinding } from './generationBindingGuard'
import { type McpGenerationCapability } from './mcpGenerationPolicy'

/**
 * 这一族错误的下一步动作。
 *
 * 2026-09-21 之前它是 `nomi://settings/automation?section=mcp-generation`——指向一个用来打开
 * 生成面的设置开关，而**那个开关在界面上从来不存在**（面是由 env flag 关着的）。模型照着它去点，
 * 点不到任何东西。flag 删掉之后剩下的每一个码说的都是同一类事：这次调用缺一张有效的项目租约
 * 或人证。所以下一步动作换成真正能照做的那一句。
 */
const OPEN_PROJECT_SESSION_NEXT_ACTION = 'Open a new project session and retry'
import type { HumanApprovalReceiptV1 } from './approvalReceipt'
import type { ProjectLeaseV2 } from './projectLease'
import { spendDecidedByPolicy } from '../shared/agentCapabilities/capabilityApprovalPolicy'
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

function unavailableSemanticRoute(capability: McpGenerationCapability): RpcError {
  return policyError({
    code: 'not_ready',
    nextAction: OPEN_PROJECT_SESSION_NEXT_ACTION,
    capability,
  }, `generation.single-shot ${capability} is not ready`)
}

export function guardLegacyGenerationRoute(route: string, params: Record<string, unknown>): void {
  if (!hasGenerationBinding(params)) return
  const capability = LEGACY_ROUTE_CAPABILITY[route] ?? 'create'
  throw policyError({
    code: 'legacy_path_forbidden',
    nextAction: OPEN_PROJECT_SESSION_NEXT_ACTION,
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

function policyDetails(capability: McpGenerationCapability, code: RpcPolicyErrorCode, nextAction = OPEN_PROJECT_SESSION_NEXT_ACTION): RpcPolicyErrorDetails {
  return { code, nextAction, capability }
}

async function requireProjectLease(
  params: Record<string, unknown>,
  capability: McpGenerationCapability,
  ctx: DispatchContext,
): Promise<{ params: Record<string, unknown>; lease: ProjectLeaseV2 }> {
  const token = typeof params.leaseHandle === 'string' ? params.leaseHandle.trim() : ''
  if (!token) throw policyError(policyDetails(capability, 'lease_required'), 'A verified project lease is required')
  if (!ctx.projectSession) throw policyError(policyDetails(capability, 'lease_required'), 'Project session authority is unavailable')
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
    throw policyError(policyDetails(capability, code), error instanceof Error ? error.message : 'Project lease is invalid')
  }
}

function requireApprovalReceipt(
  params: Record<string, unknown>,
  lease: ProjectLeaseV2,
  capability: McpGenerationCapability,
  ctx: DispatchContext,
): HumanApprovalReceiptV1 {
  const reject = (code: Extract<RpcPolicyErrorCode, 'human_approval_required' | 'receipt_invalid' | 'receipt_expired'>, message: string): never => {
    throw policyError(policyDetails(capability, code), message)
  }
  const authority = ctx.approvalReceiptAuthority
  if (!authority) {
    throw policyError(
      policyDetails(capability, 'human_approval_required'),
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
    // 这一扇门**不读项目此刻的版本**。收据该比哪一个版本只有一个答案，住在门的主人那里
    // （production.spend-approval-binding：封了信封的付费门比信封封好时的版本——付费卡① 第 14 条；
    // 创意门 / 信任降档 / 没信封的旧门比此刻的版本），决门那一步（authorizeGeneration 的
    // assertReceiptMatchesAuthorization、Run 服务 gate.decide 的 revisionRuleFor）都会再核一遍。
    // 以前这里另拿活版本比：确认卡开着时任何一次项目保存（Nomi 自己落画布、别的镜出片、用户挪一下节点）
    // 都让外部 MCP 的「确认」被拒成「此确认已失效」，而卡上批的东西一个字没变（CI C9 时红时绿就是它）。
    // 调用方自己报了版本，就得是收据上那一个——和 sealedProjectRevision 同一条规矩。
    const bodyBinding: Array<[keyof HumanApprovalReceiptV1, unknown]> = [
      ['projectId', lease.projectId],
      ['immutableProjectUuid', lease.immutableProjectUuid],
      ['projectGeneration', lease.projectGeneration],
      ['runId', params.runId],
      ['gateId', params.gateId],
      ['contractHash', params.contractHash],
      ['targetHash', params.targetHash],
      ['projectRevision', params.projectRevision],
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
): Promise<unknown> {
  // 这里曾经先问一句「这个面开了吗」（env flag + 三段式 rollout）。2026-09-21 整条删除：
  // 工具挂在 tools/list 上广告着、调用却被一个没有界面能开的环境变量打回去，那不是闸，是墙。
  if (route.contextRead && typeof ctx.generationContext !== 'function' && typeof ctx.generationPlanning !== 'function') {
    throw unavailableSemanticRoute(route.capability)
  }
  const leased = route.requiresLease === false
    ? { params, lease: undefined }
    : await requireProjectLease(params, route.capability, ctx)
  if (route.capability === 'gate_request') {
    if (!leased.lease) throw policyError({
      code: 'lease_required',
      nextAction: OPEN_PROJECT_SESSION_NEXT_ACTION,
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
      // 「算不出价」不是 0 元：已知那部分记下来，未知的镜数单独带走（2026-09-21 开闸）。
      const maximumCost = typeof value?.maximumCost === 'number' && Number.isFinite(value.maximumCost) ? value.maximumCost : 0
      const unknownShotCount = typeof value?.unknownShotCount === 'number' && Number.isSafeInteger(value.unknownShotCount) && value.unknownShotCount > 0
        ? value.unknownShotCount
        : 0
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
          ...(unknownShotCount > 0 ? { unknownJobCount: unknownShotCount } : {}),
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
      // ── 「全自动」档：宿主当场替用户决门（2026-09-12 拍板的那一档，外部 MCP 这一侧 2026-09-21 补上）──
      //
      // 闸一步都没少，也没有第二条链：同一张挑战、同一个收据铸造口，只是那张 attestation 来自
      // **用户此前选的档位**而不是他这一刻的手势（`generationSpendDecision.ts` 文档里的两种来源）。
      // 判据仍只有一个 owner：`spendDecidedByPolicy`。宿主没递档位 → 读到 undefined → 按默认走，
      // 绝不替用户花钱（下面那条 `policyDecided` 为 false 的路与改动前逐字相同）。
      const policyDecided = spendDecidedByPolicy(ctx.approvalPolicy?.())
      const policyReceipt = policyDecided
        ? authority.mintReceipt(
            challenge.token,
            authority.createPolicyDecisionAttestation(challenge.token, {
              policyMode: 'project',
              policySurface: ctx.origin?.host ? `mcp:${ctx.origin.host}` : 'mcp',
            }),
          )
        : undefined
      return {
        ...value,
        challengeId: challenge.challenge.challengeId,
        nonce: challenge.challenge.nonce,
        expiresAt: challenge.challenge.expiresAt,
        model,
        costScope: challenge.challenge.costScope,
        maximumCost: unknownShotCount > 0 && maximumCost === 0 ? null : challenge.challenge.reservationPreview.maximum,
        ...(unknownShotCount > 0 ? { unknownShotCount } : {}),
        currency: challenge.challenge.reservationPreview.currency,
        handoff: {
          challengeToken: challenge.token,
          clientAttestation: true,
          contractHash,
          operationId: value?.operationId,
          ...(policyReceipt
            ? {
              receiptId: policyReceipt.receipt.receiptId,
              receiptToken: policyReceipt.token,
              decidedBy: policyReceipt.receipt.decidedBy,
            }
            : {}),
        },
      }
    }
  }
  if (route.requiresReceipt) {
    if (!leased.lease) throw policyError({
      code: 'lease_required',
      nextAction: OPEN_PROJECT_SESSION_NEXT_ACTION,
      capability: route.capability,
    })
    const receipt = requireApprovalReceipt(leased.params, leased.lease, route.capability, ctx)
    if (ctx.authorizeGeneration) {
      const leaseToken = typeof leased.params.leaseHandle === 'string' ? leased.params.leaseHandle : ''
      if (!leaseToken || !ctx.projectSession) throw policyError({
        code: 'lease_required',
        nextAction: OPEN_PROJECT_SESSION_NEXT_ACTION,
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
        throw policyError(policyDetails(route.capability, 'lease_required'), 'A verified project lease is required')
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
  throw unavailableSemanticRoute(route.capability)
}

export async function dispatchSemanticGeneration(
  method: string,
  params: Record<string, unknown>,
  ctx: DispatchContext,
): Promise<unknown> {
  const route = SEMANTIC_GENERATION_ROUTES[method]
  if (!route) return undefined
  return dispatchSemanticStub(route, params, ctx)
}

export function isSemanticGenerationRoute(method: string): boolean {
  return Boolean(SEMANTIC_GENERATION_ROUTES[method])
}
