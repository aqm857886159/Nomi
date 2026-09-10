// 能力核 · 「以后 ¥X 内别再逐镜问」的挑战签发（`production.trust-challenge`）。
//
// 2026-09-10 21:00 用户拍板：外部 MCP 客户端不该被逼回 Nomi 界面点确认。于是降到 budget_only 的
// 确认也弹在**调用方客户端**里（elicitation），答「是」当场拿收据。这条路和单发付费门**同一条链**：
//   requestChallenge（主进程签 challenge）→ 客户端 elicitation 问真人 → 主进程铸 client_elicitation
//   收据（nomi_verify_client_generation_gate）→ 收据随 run.control 回来，在 Run 命令边界验+消费。
// 没有第二套收据、没有第二把密钥、没有第二个确认面（P1）。
//
// 这里只做一件事：把**已封存授权**（generationPlan.authorizationEnvelope）翻译成一张挑战——
// 逐镜价目、合计、上限、绑定 digest 全部来自信封，本模块不算价、不查目录、不写任何持久状态。
// 算不出正数上限（没封存 / 有镜头没定价）→ 抛错，调用方据此**不弹、直接拒绝**（永不 ¥0）。
import { assertOnlyFields, requiredIdentifier } from './dispatcherParams'
import { RpcError } from './rpcError'
import { assertCurrentProjectRevision } from '../productionRun/productionRunApprovalReceipt'
import { readTrustGrantBinding, TrustGrantUnavailableError } from '../productionRun/productionRunTrustGrant'
import type { ApprovalReceiptAuthority } from './approvalReceipt'
import type { ProductionRun } from '../productionRun/productionRunTypes'

/** 只吃派发上下文的这三样（结构子集，不 import 回 dispatcher——那会造静态环）。 */
export type TrustGrantChallengeContext = {
  productionRuns: { readFull(projectId: string, runId: string): ProductionRun | null | undefined }
  approvalReceiptAuthority?: ApprovalReceiptAuthority
  projectRevisionResolver?: (projectId: string) => number | undefined
}

export function issueTrustGrantChallenge(
  ctx: TrustGrantChallengeContext,
  params: Record<string, unknown>,
): unknown {
  assertOnlyFields(params, new Set(['projectId', 'runId']))
  const projectId = requiredIdentifier(params.projectId, 'project')
  const runId = requiredIdentifier(params.runId, 'run')
  const receipts = ctx.approvalReceiptAuthority
  if (!receipts) throw new RpcError('The main-process approval receipt authority is unavailable', 501)
  const run = ctx.productionRuns.readFull(projectId, runId)
  if (!run) throw new RpcError(`Production run not found: ${runId}`, 404)
  let binding
  try {
    binding = readTrustGrantBinding(run)
  } catch (error) {
    // 价格算不出就别问。「最多花费 ¥0」比拒绝更坏——用户会以为免费。
    if (error instanceof TrustGrantUnavailableError) throw new RpcError(error.message, 409, { code: 'human_approval_required' })
    throw error
  }
  // 收据只在它描述的那份项目文档还是当前版本时可用；这里先证一次，免得弹完框才发现签不出有效收据。
  assertCurrentProjectRevision(projectId, binding.projectRevision, ctx.projectRevisionResolver)
  const challenge = receipts.requestChallenge({
    challengeKey: `${binding.costScope}:${binding.digest}`,
    immutableProjectUuid: binding.immutableProjectUuid,
    projectGeneration: binding.projectGeneration,
    projectId,
    runId,
    gateId: binding.gateId,
    contractHash: binding.digest,
    targetHash: binding.digest,
    projectRevision: binding.projectRevision,
    costScope: binding.costScope,
    pricingSnapshotHash: binding.digest,
    reservationPreview: { currency: binding.currency, maximum: binding.maximum },
    display: {
      model: binding.shots[0]!.providerModelText,
      shots: {
        planVersion: binding.planVersion,
        planHash: binding.digest,
        currency: binding.currency,
        specs: { shotCount: binding.shots.length },
        shots: binding.shots.map((shot) => ({
          shotId: shot.shotId,
          index: shot.index,
          sceneOneLiner: shot.shotId,
          providerModelText: shot.providerModelText,
          durationSeconds: null,
          price: { known: true as const, amount: shot.price },
          degradations: [],
        })),
      },
    },
  })
  return {
    challengeId: challenge.challenge.challengeId,
    nonce: challenge.challenge.nonce,
    model: binding.shots[0]!.providerModelText,
    costScope: binding.costScope,
    maximumCost: binding.maximum,
    currency: binding.currency,
    expiresAt: challenge.challenge.expiresAt,
    shots: challenge.challenge.display!.shots,
    trustGrant: { currency: binding.currency, maximum: binding.maximum },
    handoff: { challengeToken: challenge.token, clientAttestation: true },
  }
}
