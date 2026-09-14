import type { Approval, ProductionJob } from "./productionRunTypes";

export type EffectiveAutomationPolicy = {
  trustedHosts: string[];
  allowedProviders: string[];
  allowedModels: string[];
  maxSpend: number | null;
  maxAttemptsPerJob: number;
};

export type SubmissionAuthorizationFailure =
  | "approval-run-mismatch"
  | "plan-changed"
  | "approval-expired"
  | "approval-revoked"
  | "untrusted-host"
  | "job-not-approved"
  | "provider-not-approved"
  | "model-not-approved"
  | "currency-mismatch"
  | "attempt-limit"
  | "unknown-cost"
  | "approval-budget-exceeded"
  | "policy-budget-exceeded";

export type SubmissionAuthorizationResult =
  | { ok: true }
  | { ok: false; reason: SubmissionAuthorizationFailure };

export type SubmissionAuthorizationInput = {
  approval: Approval;
  job: Pick<ProductionJob, "jobId" | "provider" | "model" | "attempt">;
  policy: EffectiveAutomationPolicy;
  now: string;
  planHash: string;
  originHost: string;
  estimatedCost: number | null;
  currency: string;
  runId?: string;
};

function intersection(values: readonly string[][]): string[] {
  const [first = [], ...rest] = values;
  return [...new Set(first)].filter((value) => rest.every((items) => items.includes(value)));
}

function minimumCeiling(values: readonly (number | null)[]): number | null {
  const ceilings = values.filter((value): value is number => value !== null);
  return ceilings.length > 0 ? Math.min(...ceilings) : null;
}

export function intersectAutomationPolicies(
  policies: readonly EffectiveAutomationPolicy[],
): EffectiveAutomationPolicy {
  if (policies.length === 0) throw new Error("At least one automation policy is required");
  return {
    trustedHosts: intersection(policies.map((value) => value.trustedHosts)),
    allowedProviders: intersection(policies.map((value) => value.allowedProviders)),
    allowedModels: intersection(policies.map((value) => value.allowedModels)),
    maxSpend: minimumCeiling(policies.map((value) => value.maxSpend)),
    maxAttemptsPerJob: Math.min(...policies.map((value) => value.maxAttemptsPerJob)),
  };
}

export function authorizeSubmission(input: SubmissionAuthorizationInput): SubmissionAuthorizationResult {
  const { approval, job, policy } = input;
  if (input.runId !== undefined && approval.runId !== input.runId) return { ok: false, reason: "approval-run-mismatch" };
  if (approval.planHash !== input.planHash) return { ok: false, reason: "plan-changed" };
  if (approval.revokedAt) return { ok: false, reason: "approval-revoked" };
  if (Date.parse(input.now) >= Date.parse(approval.expiresAt)) return { ok: false, reason: "approval-expired" };
  if (!policy.trustedHosts.includes(input.originHost)) return { ok: false, reason: "untrusted-host" };
  if (!approval.jobIds.includes(job.jobId)) return { ok: false, reason: "job-not-approved" };
  if (!approval.allowedProviders.includes(job.provider) || !policy.allowedProviders.includes(job.provider)) {
    return { ok: false, reason: "provider-not-approved" };
  }
  if (!approval.allowedModels.includes(job.model) || !policy.allowedModels.includes(job.model)) {
    return { ok: false, reason: "model-not-approved" };
  }
  if (approval.currency !== input.currency) return { ok: false, reason: "currency-mismatch" };
  if (job.attempt > Math.min(approval.maxAttemptsPerJob, policy.maxAttemptsPerJob)) {
    return { ok: false, reason: "attempt-limit" };
  }
  // 估价未知：放行。这里过去按 `mode === "policy-auto"` 拒成 unknown-cost；2026-09-14 删掉了那个
  // 设置档位（唯一 owner 是 Agent 面板的 PermissionTier，而它三档的 spend 轴全是 confirm——收据
  // 一定是真人看过报价按下的），于是「没人看着就自动花钱」这一档在产品上不存在，该分支随之消失。
  // 提交侧 `submissionOutbox` 仍对 costCeiling 为 null 抛 unknown-cost，钱门不靠这里兜底。
  if (input.estimatedCost === null || !Number.isFinite(input.estimatedCost) || input.estimatedCost < 0) return { ok: true };
  if (input.estimatedCost > approval.maxSpend) return { ok: false, reason: "approval-budget-exceeded" };
  if (policy.maxSpend !== null && input.estimatedCost > policy.maxSpend) {
    return { ok: false, reason: "policy-budget-exceeded" };
  }
  return { ok: true };
}
