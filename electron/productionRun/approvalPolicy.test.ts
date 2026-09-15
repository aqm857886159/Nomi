import { describe, expect, it } from "vitest";

import type { Approval, ProductionJob } from "./productionRunTypes";
import {
  authorizeSubmission,
  intersectAutomationPolicies,
  type EffectiveAutomationPolicy,
} from "./approvalPolicy";

const now = "2026-08-08T08:00:00.000Z";

function approval(patch: Partial<Approval> = {}): Approval {
  return {
    approvalId: "approval-1",
    runId: "run-1",
    scope: "job_set",
    planHash: "plan-current",
    jobIds: ["job-1"],
    allowedProviders: ["tapcanvas"],
    allowedModels: ["seedance-1.0"],
    currency: "CNY",
    maxSpend: 12,
    maxAttemptsPerJob: 2,
    decidedAt: "2026-08-08T07:00:00.000Z",
    expiresAt: "2026-08-08T09:00:00.000Z",
    ...patch,
  };
}

function job(patch: Partial<ProductionJob> = {}): ProductionJob {
  return {
    jobId: "job-1",
    stageId: "production",
    status: "authorized",
    attempt: 1,
    provider: "tapcanvas",
    model: "seedance-1.0",
    idempotencyKey: "run-1:job-1:1",
    createdAt: now,
    updatedAt: now,
    ...patch,
  };
}

function policy(patch: Partial<EffectiveAutomationPolicy> = {}): EffectiveAutomationPolicy {
  return {
    trustedHosts: ["codex"],
    allowedProviders: ["tapcanvas"],
    allowedModels: ["seedance-1.0"],
    maxSpend: 20,
    maxAttemptsPerJob: 3,
    ...patch,
  };
}

function request(overrides: Record<string, unknown> = {}) {
  return {
    approval: approval(),
    job: job(),
    policy: policy(),
    now,
    planHash: "plan-current",
    originHost: "codex",
    estimatedCost: 5,
    currency: "CNY",
    ...overrides,
  };
}

describe("authorizeSubmission", () => {
  it("authorizes only the exact approved plan and job boundary", () => {
    expect(authorizeSubmission(request())).toEqual({ ok: true });
    expect(authorizeSubmission(request({ planHash: "plan-changed" }))).toEqual({ ok: false, reason: "plan-changed" });
    expect(authorizeSubmission(request({ job: job({ jobId: "job-2" }) }))).toEqual({ ok: false, reason: "job-not-approved" });
  });

  it("rejects expired or revoked approval", () => {
    expect(authorizeSubmission(request({ approval: approval({ expiresAt: now }) }))).toEqual({ ok: false, reason: "approval-expired" });
    expect(authorizeSubmission(request({ approval: approval({ revokedAt: "2026-08-08T07:30:00.000Z" }) }))).toEqual({ ok: false, reason: "approval-revoked" });
  });

  it("enforces host, provider, model, currency, and attempt boundaries", () => {
    expect(authorizeSubmission(request({ originHost: "cursor" }))).toEqual({ ok: false, reason: "untrusted-host" });
    expect(authorizeSubmission(request({ job: job({ provider: "other" }) }))).toEqual({ ok: false, reason: "provider-not-approved" });
    expect(authorizeSubmission(request({ job: job({ model: "other" }) }))).toEqual({ ok: false, reason: "model-not-approved" });
    expect(authorizeSubmission(request({ currency: "USD" }))).toEqual({ ok: false, reason: "currency-mismatch" });
    expect(authorizeSubmission(request({ job: job({ attempt: 3 }) }))).toEqual({ ok: false, reason: "attempt-limit" });
  });

  it("lets an unknown estimate through on a human-confirmed receipt and still enforces both ceilings", () => {
    // 2026-09-14：设置档位（policy-auto 拒 unknown-cost）已删——Agent 面板三档的 spend 轴全是 confirm，
    // 收据一定是真人看过报价按的；未知估价的 fail-closed 由 submissionOutbox 的 costCeiling 兜。
    expect(authorizeSubmission(request({ estimatedCost: null }))).toEqual({ ok: true });
    expect(authorizeSubmission(request({ estimatedCost: 13 }))).toEqual({ ok: false, reason: "approval-budget-exceeded" });
    expect(authorizeSubmission(request({ policy: policy({ maxSpend: 4 }) }))).toEqual({ ok: false, reason: "policy-budget-exceeded" });
  });
});

describe("intersectAutomationPolicies", () => {
  it("keeps the most restrictive allowlists, ceiling, and retry limit", () => {
    expect(intersectAutomationPolicies([
      policy({
        trustedHosts: ["codex", "claude"],
        allowedProviders: ["tapcanvas", "other"],
        allowedModels: ["seedance-1.0", "other-model"],
        maxSpend: 50,
        maxAttemptsPerJob: 4,
      }),
      policy({ maxSpend: 20, maxAttemptsPerJob: 2 }),
      policy({ maxSpend: 30, maxAttemptsPerJob: 3 }),
    ])).toEqual({
      trustedHosts: ["codex"],
      allowedProviders: ["tapcanvas"],
      allowedModels: ["seedance-1.0"],
      maxSpend: 20,
      maxAttemptsPerJob: 2,
    });
  });
});
