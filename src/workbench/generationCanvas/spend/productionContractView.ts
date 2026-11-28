import type { ProductionGate, ProductionRun, TrustLevel } from '../../../../electron/shared/contracts/productionRunTypes'
import { trustLevelOf } from '../../../../electron/shared/contracts/productionRunTypes'
import {
  evaluateProductionPolicyReadiness,
  type ProductionPolicyReadiness,
} from '../../../../electron/productionRun/productionPolicyReadiness'
import type {
  MultiShotGateProjection,
  MultiShotGateShot,
  ShotPrice,
} from '../../../../electron/productionRun/shotPricing'

/**
 * P4 S3a — 多镜确认卡的逐镜行（只读决策面）。真相源是 electron 的 {@link MultiShotGateShot}（跨层单一形状，
 * 防渲染层与协议层漂移）。价格/时长/降级沿用 S2 诚实语义：估不出显「未知」不伪造 0；降级走结构化 code。
 */
export type MultiShotContractShot = MultiShotGateShot

/** P4 S3a — 计划级多镜合同投影。挂在 {@link ProductionContractView.shotList} 上，有它即渲染多镜卡。 */
export type MultiShotContractProjection = {
  shots: MultiShotContractShot[]
  /** 有提醒（降级）的镜数 → 汇总行「M 镜有提醒」。 */
  reminderShotCount: number
  /** 已知单价合计（S2 knownSubtotal）。 */
  knownSubtotal: number
  /** 未知价镜数（诚实「有 N 镜估不出价」）。 */
  unknownShotCount: number
  currency: string
  /** 硬上限（≤¥X）；null = 未设。 */
  hardLimit: number | null
  /** 主角形象 / 场景参考 chips（含定妆照先行的锚参考费用）。 */
  anchorChips: Array<{ label: string; price: ShotPrice }>
  /** 预计等待（秒）；null = 未知。 */
  waitSeconds: number | null
  /** 冻结项清单（i18n key 数组，如 ['shots','models','references','price']）——过闸后不可再改什么。 */
  frozenItems: string[]
  /** 有效期（ISO）；null = 不显。 */
  expiresAt: string | null
}

/**
 * P4 S3a 渲染层收到的多镜 gate payload（三层管线的末端投影：mcpProtocol → appIntegration → 这里）。
 * = electron 侧 {@link MultiShotGateProjection}（跨 RPC 边界的序列化形状）+ 一个可选 `projectName`（正文用）。
 * 渲染层只翻降级 code + 排版，不重拼任何串。
 */
export type MultiShotGatePayload = MultiShotGateProjection & { projectName?: string }

export type ProductionContractView = {
  planVersion: number
  planHash: string
  /** B3：run 级信任档位（合同行显示打扰程度；老 run 无字段 → key_confirm）。 */
  trustLevel: TrustLevel
  specs: {
    durationSeconds: number | null
    aspectRatio: string | null
    language: string | null
    shotCount: number | null
  }
  claims: Array<{ text: string; evidenceCount: number; verified: boolean }>
  skills: Array<{ name: string; version: string }>
  providerModels: Array<{ provider: string; model: string }>
  policy: ProductionPolicyReadiness
  maxAttemptsPerJob: number
  cost: {
    known: boolean
    currency: string
    minimum: number | null
    maximum: number | null
    hardLimit: number | null
  }
  requiresSeparateIrreversibleApproval: true
  /**
   * P4 S3a：多镜合同投影。**有它 → 渲染多镜确认卡**（逐镜清单 + 固定 footer）；无它 → 渲染既有
   * legacy `ProductionContractSummary`（driver 门形态不动）。`buildProductionContractView`（legacy 门）
   * 永不产出它；只有 `buildMultiShotContractView`（S3a 语义链）会填。
   */
  shotList?: MultiShotContractProjection
}

function finiteNonNegative(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

export function buildProductionContractView(run: ProductionRun, gate: ProductionGate): ProductionContractView {
  const contract = gate.contract
  const evidenceIds = new Set((contract?.evidence ?? []).map((item) => item.evidenceId))
  const jobs = gate.jobIds
    .map((jobId) => run.jobs.find((job) => job.jobId === jobId))
    .filter((job): job is NonNullable<typeof job> => Boolean(job))
  const policy = evaluateProductionPolicyReadiness(run.policy, jobs)
  const minimum = finiteNonNegative(contract?.estimatedCost?.minimum)
  const maximum = finiteNonNegative(contract?.estimatedCost?.maximum)
  const known = minimum !== null && maximum !== null && minimum <= maximum

  return {
    planVersion: run.planVersion,
    planHash: gate.planHash,
    trustLevel: trustLevelOf(run.policy),
    specs: {
      durationSeconds: finiteNonNegative(contract?.specs.durationSeconds),
      aspectRatio: contract?.specs.aspectRatio?.trim() || null,
      language: contract?.specs.language?.trim() || null,
      shotCount: finiteNonNegative(contract?.specs.shotCount),
    },
    claims: (contract?.claims ?? []).map((claim) => {
      const matched = claim.evidenceIds.filter((evidenceId) => evidenceIds.has(evidenceId))
      return {
        text: claim.text,
        evidenceCount: matched.length,
        verified: claim.evidenceIds.length > 0 && matched.length === claim.evidenceIds.length,
      }
    }),
    skills: contract?.skills ?? [],
    providerModels: policy.requiredProviderModels,
    policy,
    maxAttemptsPerJob: run.policy.maxAttemptsPerJob,
    cost: {
      known,
      currency: contract?.estimatedCost?.currency?.trim() || run.budget.currency,
      minimum: known ? minimum : null,
      maximum: known ? maximum : null,
      hardLimit: finiteNonNegative(run.policy.maxSpend),
    },
    requiresSeparateIrreversibleApproval: true,
  }
}

const EMPTY_POLICY: ProductionPolicyReadiness = {
  ready: true,
  issueCount: 0,
  requiredProviderModels: [],
  missingProviders: [],
  missingModels: [],
}

/**
 * P4 S3a — 把渲染层收到的多镜 gate payload 投影成一份带 `shotList` 的 {@link ProductionContractView}，
 * 供 `SpendConfirmDialog` 的 contract 分支渲染多镜卡。**纯函数**：不读画布、不发请求、不伪造数字——
 * 未知价/未知时长原样透传（`ShotPrice.known===false` / `durationSeconds===null`），降级 code 原样透传。
 *
 * legacy 字段（claims/skills/providerModels/trustLevel…）在多镜卡里不显示，故填成中性空值即可；
 * 多镜卡只读 `shotList` + 顶部规格。这样多镜与 legacy 共用同一 store 槽与同一 `kind:'contract'`（P1，不造并行卡）。
 */
export function buildMultiShotContractView(payload: MultiShotGatePayload): ProductionContractView {
  const shots = Array.isArray(payload.shots) ? payload.shots : []
  const currency = payload.currency?.trim() || 'CNY'
  const knownSubtotal = shots.reduce((sum, shot) => (shot.price.known ? sum + shot.price.amount : sum), 0)
  const unknownShotCount = shots.reduce((count, shot) => (shot.price.known ? count : count + 1), 0)
  const reminderShotCount = shots.reduce((count, shot) => (shot.degradations.length ? count + 1 : count), 0)
  const hardLimit = finiteNonNegative(payload.hardLimit)

  const shotList: MultiShotContractProjection = {
    shots,
    reminderShotCount,
    knownSubtotal,
    unknownShotCount,
    currency,
    hardLimit,
    anchorChips: Array.isArray(payload.anchorChips) ? payload.anchorChips : [],
    waitSeconds: finiteNonNegative(payload.waitSeconds),
    frozenItems: Array.isArray(payload.frozenItems) ? payload.frozenItems : [],
    expiresAt: typeof payload.expiresAt === 'string' && payload.expiresAt.trim() ? payload.expiresAt : null,
  }

  return {
    planVersion: typeof payload.planVersion === 'number' ? payload.planVersion : 0,
    planHash: typeof payload.planHash === 'string' ? payload.planHash : '',
    trustLevel: 'key_confirm',
    specs: {
      durationSeconds: finiteNonNegative(payload.specs?.durationSeconds),
      aspectRatio: payload.specs?.aspectRatio?.trim() || null,
      language: null,
      shotCount: finiteNonNegative(payload.specs?.shotCount) ?? shots.length,
    },
    claims: [],
    skills: [],
    providerModels: [],
    policy: EMPTY_POLICY,
    maxAttemptsPerJob: 0,
    cost: {
      // 多镜卡的费用块从 shotList 读（knownSubtotal / hardLimit），这里维持诚实：有已知镜价即视为已知。
      known: shots.length > 0 && unknownShotCount === 0,
      currency,
      minimum: knownSubtotal,
      maximum: knownSubtotal,
      hardLimit,
    },
    requiresSeparateIrreversibleApproval: true,
    shotList,
  }
}
