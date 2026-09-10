// 制作 Run · 「以后 ¥X 内别再逐镜问」这次授权绑在什么上（唯一定义）。
//
// 2026-09-10 21:00 用户拍板：外部 MCP 客户端不该被逼回 Nomi 界面点确认——所有确认都在客户端里弹
// （elicitation）。Nomi 只坚持一条不变量：**每笔付费放行必须对应一次真人答过的确认（收据）**。
// 降到 budget_only 就是一次付费放行（此后逐镜确认门不再生成，剩余镜头直接提交给供应商），所以它
// 需要一张收据，且这张收据必须绑死「哪个 run + 多少钱」。
//
// 绑定的料**全部来自已封存的授权信封**（generationPlan.authorizationEnvelope）：逐镜单价、合计、
// 币种、项目版本、planVersion 都在里面，且信封本身已被 authorizationDigest 冻结。于是：
//   · 改计划 / 改价 → digest 变 → 收据的 contractHash 失配 → 拒；
//   · 换 run 或改上限 → costScope 串变 → 拒。
// 不新增任何持久字段、不新造第二份价格真相源（价格只有 catalog → 封存信封这一条路）。
//
// 「价格算不出就别弹」：信封的 costCertainty 必须是 'known'。partial（有镜头没定价）时这里直接
// 抛错——宁可拒绝，也绝不把未知价当 ¥0 报给用户（shotPricing.ts 的同一条诚实规则）。
import { trustGrantCostScope, trustGrantGateId } from "./productionRunGateIdentity";
import type { ProductionRun } from "./productionRunTypes";

export class TrustGrantUnavailableError extends Error {
  readonly code = "trust_grant_unavailable" as const;

  constructor(message: string) {
    super(message);
    this.name = "TrustGrantUnavailableError";
  }
}

/** 一行逐镜价目（人话，客户端 elicitation 与 Nomi 卡都用它，不各写一份）。 */
export type TrustGrantShotLine = {
  index: number;
  shotId: string;
  providerModelText: string;
  price: number;
};

export type TrustGrantBinding = {
  /** 合成门 id（非 `gate-` 前缀：信任收据永远批不动真门，反之亦然）。 */
  gateId: string;
  /** 已封存授权的 digest：计划或价格一变就失配。 */
  digest: string;
  /** `trust.budget-only:<runId>:<currency>:<maximum>`——上限绑死在这里。 */
  costScope: string;
  currency: string;
  /** 这次降档替真人放行的总金额 = 逐镜单价之和（信封的 budget.maximum）。 */
  maximum: number;
  planVersion: number;
  projectRevision: number;
  immutableProjectUuid: string;
  projectGeneration: number;
  shots: TrustGrantShotLine[];
};

/**
 * 读出这个 Run 上「降到 budget_only」要绑定的全部事实。缺封存授权、价格不全或合计非正数 → 抛
 * {@link TrustGrantUnavailableError}，调用方据此**不弹确认、直接拒绝**（永不报 ¥0）。
 */
export function readTrustGrantBinding(run: ProductionRun): TrustGrantBinding {
  const plan = run.generationPlan;
  const envelope = plan?.authorizationEnvelope;
  const digest = plan?.authorizationDigest;
  if (!envelope || !digest) {
    throw new TrustGrantUnavailableError("This run has no sealed paid authorization to grant trust over");
  }
  if (plan?.costCertainty === "partial") {
    throw new TrustGrantUnavailableError("At least one shot has no known price; the ceiling cannot be stated honestly");
  }
  const shots = envelope.jobs.map((job, index) => {
    if (!Number.isFinite(job.price.maximum) || job.price.maximum < 0) {
      throw new TrustGrantUnavailableError(`Shot price is unknown: ${job.shotId}`);
    }
    return {
      index: index + 1,
      shotId: job.shotId,
      providerModelText: job.mode ? `${job.providerId} · ${job.modelId}（${job.mode}）` : `${job.providerId} · ${job.modelId}`,
      price: job.price.maximum,
    };
  });
  const maximum = envelope.budget.maximum;
  if (!shots.length || !Number.isFinite(maximum) || maximum <= 0) {
    throw new TrustGrantUnavailableError("The sealed authorization states no positive spend ceiling");
  }
  return {
    gateId: trustGrantGateId(envelope.planVersion),
    digest,
    costScope: trustGrantCostScope(envelope.runId, envelope.budget.currency, maximum),
    currency: envelope.budget.currency,
    maximum,
    planVersion: envelope.planVersion,
    projectRevision: envelope.projectRevision,
    immutableProjectUuid: envelope.immutableProjectUuid,
    projectGeneration: envelope.projectGeneration,
    shots,
  };
}
