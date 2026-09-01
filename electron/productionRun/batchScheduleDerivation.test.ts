import { describe, expect, it } from "vitest";

import { deriveBatchPlan, type BatchDerivationInput } from "./batchScheduleDerivation";
import type {
  ProductionGate,
  ProductionGenerationPlan,
  ProductionGenerationShot,
  ProductionJob,
} from "./productionRunTypes";
import type { ExecutionContractV1, PlanCandidate } from "../capabilityCore/executionContract";

// P4 S4 — pure batch derivation. TDD: these lock the "no second source of truth" contract. Every
// tick recomputes the next dispatch set from (plan.shots + jobs[] + ledger + anchor gate) alone;
// a crash-restart re-runs the SAME function over the durable Run and gets the SAME answer.

const NOW = "2026-08-25T00:00:00.000Z";

function candidate(id: string): PlanCandidate {
  return {
    candidateId: id,
    revision: 1,
    moduleId: "generation.single-shot",
    providerId: "apimart",
    modelId: "video-model",
    mode: "image-to-video",
    prompt: `shot ${id}`,
    parameters: {},
    references: [],
  };
}

function contractFor(id: string, hash: string): ExecutionContractV1 {
  return {
    schemaVersion: 1,
    candidateId: id,
    candidateRevision: 1,
    moduleId: "generation.single-shot",
    moduleVersion: "1.0.0",
    providerId: "apimart",
    modelId: "video-model",
    mode: "image-to-video",
    prompt: `shot ${id}`,
    parameters: {},
    references: [],
    contractHash: hash,
    warnings: [],
    droppedFields: [],
  };
}

function shot(shotId: string, hash: string, extra: Partial<ProductionGenerationShot> = {}): ProductionGenerationShot {
  return {
    shotId,
    candidate: { ...candidate(shotId), sealedContractHash: hash },
    contract: contractFor(shotId, hash),
    approvedReceiptId: "receipt-plan",
    updatedAt: NOW,
    ...extra,
  };
}

/** A sealed+approved multi-shot plan with the given shots. */
function sealedPlan(shots: ProductionGenerationShot[]): ProductionGenerationPlan {
  return {
    operationId: "op-batch",
    state: "submitted",
    candidate: shots[0].candidate,
    contract: shots[0].contract,
    planHash: "plan-hash-batch",
    approvedReceiptId: "receipt-plan",
    approvedAt: NOW,
    shots,
    updatedAt: NOW,
  };
}

/** A durable job for a given shot/attempt at a given status — mirrors what the submission facade writes. */
function jobFor(shotId: string, hash: string, status: ProductionJob["status"], attempt = 1): ProductionJob {
  const shotSegment = shotId ? `-${shotId}` : "";
  const jobId = `generation-op-batch${shotSegment}-${hash.slice(0, 16)}${attempt > 1 ? `-attempt-${attempt}` : ""}`;
  return {
    jobId,
    stageId: "generate",
    status,
    attempt,
    provider: "apimart",
    model: "video-model",
    idempotencyKey: `generation:op-batch:${shotId}:${hash}:attempt-${attempt}`,
    ...(shotId ? { metadata: { shotId } } : {}),
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function authorizedJobsFor(shots: ProductionGenerationShot[]): ProductionJob[] {
  return shots
    .filter((entry) => entry.included !== false && entry.contract)
    .map((entry) => jobFor(entry.shotId, entry.contract!.contractHash, "authorized", entry.attemptCount ?? 1));
}

const ANCHOR_HASH = "n".repeat(64);

/** An anchor entry in the plan: a role:"anchor" shot with an image sub-contract. */
function anchorShot(shotId: string, extra: Partial<ProductionGenerationShot> = {}): ProductionGenerationShot {
  return { ...shot(shotId, ANCHOR_HASH, extra), role: "anchor" };
}

/** A ready durable job for an anchor shot (jobId follows jobIdFor, same machinery as video shots). */
function anchorJobReady(shotId: string, attempt = 1): ProductionJob {
  return { ...jobFor(shotId, ANCHOR_HASH, "ready", attempt), model: "image-model" };
}

/** The anchor checkpoint gate; its jobIds reference the anchor's derived jobId. */
function anchorCheckpointGate(status: ProductionGate["status"], createdAt = NOW): ProductionGate {
  return {
    gateId: "gate-anchor-checkpoint-op-batch",
    scope: "anchor_checkpoint",
    status,
    planHash: "plan-hash-batch",
    jobIds: [jobFor("anchor-1", ANCHOR_HASH, "ready").jobId],
    title: "锚亮相检查点",
    summary: "过目主角形象再开拍",
    createdAt,
    expiresAt: "2026-08-26T00:00:00.000Z",
  };
}

/** Base input: two included shots, no anchor requirement, generous budget, running. */
function baseInput(overrides: Partial<BatchDerivationInput> = {}): BatchDerivationInput {
  const shots = [shot("shot-a", "a".repeat(64)), shot("shot-b", "b".repeat(64))];
  return {
    runId: "op-batch",
    runStatus: "running",
    plan: sealedPlan(shots),
    jobs: authorizedJobsFor(shots),
    budget: { currency: "CNY", authorized: 100, reserved: 0, actual: 0, unsettled: 0 },
    perShotPrice: () => ({ known: true, amount: 6 }),
    anchorGate: undefined,
    now: NOW,
    ...overrides,
  };
}

describe("P4 S4 deriveBatchPlan — shot dispatch", () => {
  it("dispatches every included shot with a gate-authorized job (no anchor requirement)", () => {
    const result = deriveBatchPlan(baseInput());
    expect(result.shotDispatch.map((s) => s.shotId)).toEqual(["shot-a", "shot-b"]);
    expect(result.anchorDispatch).toEqual([]);
    expect(result.halt).toBeUndefined();
  });

  it("excludes shots marked included:false", () => {
    const shots = [shot("shot-a", "a".repeat(64)), shot("shot-b", "b".repeat(64), { included: false })];
    const result = deriveBatchPlan(baseInput({ plan: sealedPlan(shots) }));
    expect(result.shotDispatch.map((s) => s.shotId)).toEqual(["shot-a"]);
  });

  it("does not re-dispatch a shot that already has a durable job (crash-recovery re-run)", () => {
    // A restart re-runs derivation over the durable Run: shot-a already submitted, shot-b not.
    const jobs = [
      jobFor("shot-a", "a".repeat(64), "provider_accepted"),
      jobFor("shot-b", "b".repeat(64), "authorized"),
    ];
    const result = deriveBatchPlan(baseInput({ jobs }));
    expect(result.shotDispatch.map((s) => s.shotId)).toEqual(["shot-b"]);
  });

  it("treats a terminal (ready) shot job as done — never re-dispatches it", () => {
    const jobs = [
      jobFor("shot-a", "a".repeat(64), "ready"),
      jobFor("shot-b", "b".repeat(64), "adopted"),
    ];
    const result = deriveBatchPlan(baseInput({ jobs }));
    expect(result.shotDispatch).toEqual([]);
  });

  it("re-dispatches only the current attempt when a shot has a fresh (higher) attemptCount but no job for it yet", () => {
    // A fresh reauthorization bumped shot-a to attempt 2 and atomically created its authorized job.
    const shots = [
      shot("shot-a", "a".repeat(64), { attemptCount: 2 }),
      shot("shot-b", "b".repeat(64)),
    ];
    const jobs = [
      jobFor("shot-a", "a".repeat(64), "needs_attention", 1),
      jobFor("shot-a", "a".repeat(64), "authorized", 2),
      jobFor("shot-b", "b".repeat(64), "authorized"),
    ];
    const result = deriveBatchPlan(baseInput({ plan: sealedPlan(shots), jobs }));
    const shotA = result.shotDispatch.find((s) => s.shotId === "shot-a");
    expect(shotA?.attempt).toBe(2);
  });
});

/** A plan with one anchor-role shot + two video shots (the雨夜便利店 shape). */
function planWithAnchor(anchorExtra: Partial<ProductionGenerationShot> = {}): ProductionGenerationPlan {
  return sealedPlan([
    anchorShot("anchor-1", anchorExtra),
    shot("shot-a", "a".repeat(64)),
    shot("shot-b", "b".repeat(64)),
  ]);
}

describe("P4 S4 deriveBatchPlan — anchor + checkpoint", () => {
  it("dispatches anchors first and blocks shots until anchors have jobs", () => {
    const plan = planWithAnchor();
    const result = deriveBatchPlan(baseInput({ plan, jobs: authorizedJobsFor(plan.shots ?? []) }));
    expect(result.anchorDispatch.map((a) => a.shotId)).toEqual(["anchor-1"]);
    // No checkpoint approval yet and anchors not even generated → shots blocked.
    expect(result.shotDispatch).toEqual([]);
    expect(result.checkpoint.status).toBe("pending_anchors");
  });

  it("does not release shots while the anchor checkpoint gate is waiting", () => {
    // Anchor job is ready but the checkpoint gate is still waiting for the user to approve the look.
    const result = deriveBatchPlan(baseInput({
      plan: planWithAnchor(),
      jobs: [anchorJobReady("anchor-1"), ...authorizedJobsFor(planWithAnchor().shots!.slice(1))],
      anchorGate: anchorCheckpointGate("waiting"),
    }));
    expect(result.anchorDispatch).toEqual([]); // anchor already has a job
    expect(result.shotDispatch).toEqual([]); // gate waiting → shots blocked
    expect(result.checkpoint.status).toBe("waiting");
  });

  it("releases shots once the anchor checkpoint gate is approved", () => {
    const result = deriveBatchPlan(baseInput({
      plan: planWithAnchor(),
      jobs: [anchorJobReady("anchor-1"), ...authorizedJobsFor(planWithAnchor().shots!.slice(1))],
      anchorGate: anchorCheckpointGate("approved"),
    }));
    expect(result.shotDispatch.map((s) => s.shotId)).toEqual(["shot-a", "shot-b"]);
    expect(result.checkpoint.status).toBe("approved");
  });

  it("signals that the checkpoint gate should be OPENED once all anchors are ready and no gate exists yet", () => {
    const result = deriveBatchPlan(baseInput({
      plan: planWithAnchor(),
      jobs: [anchorJobReady("anchor-1"), ...authorizedJobsFor(planWithAnchor().shots!.slice(1))],
      anchorGate: undefined,
    }));
    expect(result.checkpoint.status).toBe("should_open");
    expect(result.checkpoint.readyAnchorJobIds).toEqual([anchorJobReady("anchor-1").jobId]);
    expect(result.shotDispatch).toEqual([]); // not released until the gate is opened + approved
  });

  it("auto-releases the checkpoint when the configured timeout has elapsed", () => {
    const openedAt = "2026-08-25T00:00:00.000Z";
    const later = "2026-08-25T00:10:00.000Z"; // 10 minutes later
    const result = deriveBatchPlan(baseInput({
      plan: planWithAnchor(),
      jobs: [anchorJobReady("anchor-1"), ...authorizedJobsFor(planWithAnchor().shots!.slice(1))],
      anchorGate: anchorCheckpointGate("waiting", openedAt),
      now: later,
      anchorAutoReleaseMs: 5 * 60 * 1000, // 5 minutes
    }));
    expect(result.checkpoint.status).toBe("auto_release");
    expect(result.shotDispatch.map((s) => s.shotId)).toEqual(["shot-a", "shot-b"]);
  });

  it("does NOT auto-release by default (anchorAutoReleaseMs undefined)", () => {
    const later = "2026-08-25T02:00:00.000Z";
    const result = deriveBatchPlan(baseInput({
      plan: planWithAnchor(),
      jobs: [anchorJobReady("anchor-1")],
      anchorGate: anchorCheckpointGate("waiting", NOW),
      now: later,
    }));
    expect(result.checkpoint.status).toBe("waiting");
    expect(result.shotDispatch).toEqual([]);
  });

  it("re-dispatches ONLY the anchor (not shots) when the checkpoint was rejected", () => {
    // Rejected checkpoint → a fresh authority created the anchor's attempt-2 job. The stale attempt-1
    // anchor job stays; derivation offers only the authorized replacement and keeps shots blocked.
    const result = deriveBatchPlan(baseInput({
      plan: planWithAnchor({ attemptCount: 2 }),
      jobs: [
        anchorJobReady("anchor-1", 1),
        jobFor("anchor-1", ANCHOR_HASH, "authorized", 2),
        ...authorizedJobsFor(planWithAnchor().shots!.slice(1)),
      ],
      anchorGate: anchorCheckpointGate("rejected"),
    }));
    expect(result.anchorDispatch.map((a) => a.shotId)).toEqual(["anchor-1"]);
    expect(result.anchorDispatch[0]?.attempt).toBe(2);
    expect(result.shotDispatch).toEqual([]);
  });
});

describe("P4 S4 deriveBatchPlan — budget halt", () => {
  it("halts at the correct Kth shot (checkbox order) when the plan cap covers only the first K", () => {
    // authorized=13, each shot costs 6 → shots a(6) + b(6) = 12 fit, c would be 18 > 13 → halt at c.
    const shots = [shot("shot-a", "a".repeat(64)), shot("shot-b", "b".repeat(64)), shot("shot-c", "c".repeat(64))];
    const result = deriveBatchPlan(baseInput({
      plan: sealedPlan(shots),
      jobs: authorizedJobsFor(shots),
      budget: { currency: "CNY", authorized: 13, reserved: 0, actual: 0, unsettled: 0 },
    }));
    expect(result.shotDispatch.map((s) => s.shotId)).toEqual(["shot-a", "shot-b"]);
    expect(result.halt).toBeDefined();
    expect(result.halt?.haltedAtShotId).toBe("shot-c");
    expect(result.halt?.completedCount).toBe(0); // none finished yet
    expect(result.halt?.dispatchableCount).toBe(2);
    expect(result.halt?.remainingCount).toBe(1);
  });

  it("accounts already-reserved+actual spend so a partial batch resumes without double-counting", () => {
    // shot-a already reserved (6 in-flight). authorized=13 → only 7 headroom → shot-b(6) fits, shot-c(6) does not.
    const shots = [shot("shot-a", "a".repeat(64)), shot("shot-b", "b".repeat(64)), shot("shot-c", "c".repeat(64))];
    const jobs = [
      jobFor("shot-a", "a".repeat(64), "provider_accepted"),
      jobFor("shot-b", "b".repeat(64), "authorized"),
      jobFor("shot-c", "c".repeat(64), "authorized"),
    ];
    const result = deriveBatchPlan(baseInput({
      plan: sealedPlan(shots),
      jobs,
      budget: { currency: "CNY", authorized: 13, reserved: 6, actual: 0, unsettled: 0 },
    }));
    // shot-a already has a job; among remaining b,c only b fits the 7 headroom.
    expect(result.shotDispatch.map((s) => s.shotId)).toEqual(["shot-b"]);
    expect(result.halt?.haltedAtShotId).toBe("shot-c");
  });

  it("never halts when the budget is unbounded-enough and prices are known", () => {
    const result = deriveBatchPlan(baseInput());
    expect(result.halt).toBeUndefined();
  });

  it("treats an unknown-price shot as zero liability toward the cap (still dispatchable)", () => {
    // An unpriced shot must remain submittable (matching S2's ledger '0 = unpriced' semantics).
    const shots = [shot("shot-a", "a".repeat(64)), shot("shot-b", "b".repeat(64))];
    const result = deriveBatchPlan(baseInput({
      plan: sealedPlan(shots),
      budget: { currency: "CNY", authorized: 6, reserved: 0, actual: 0, unsettled: 0 },
      perShotPrice: (shotId) => (shotId === "shot-b" ? { known: false } : { known: true, amount: 6 }),
    }));
    // a costs 6 (fits exactly), b is unknown (0 toward cap) → both dispatchable.
    expect(result.shotDispatch.map((s) => s.shotId)).toEqual(["shot-a", "shot-b"]);
    expect(result.halt).toBeUndefined();
  });
});

describe("P4 S4 deriveBatchPlan — stop semantics", () => {
  for (const status of ["pausing", "paused", "cancelled"] as const) {
    it(`dispatches nothing new when the run is ${status}`, () => {
      const result = deriveBatchPlan(baseInput({ runStatus: status }));
      expect(result.anchorDispatch).toEqual([]);
      expect(result.shotDispatch).toEqual([]);
    });
  }

  it("reports structured stop counts (stopped/completed/pending) from durable jobs", () => {
    const shots = [shot("shot-a", "a".repeat(64)), shot("shot-b", "b".repeat(64)), shot("shot-c", "c".repeat(64))];
    const jobs = [
      jobFor("shot-a", "a".repeat(64), "ready"), // completed
      jobFor("shot-b", "b".repeat(64), "provider_accepted"), // in-flight
    ];
    const result = deriveBatchPlan(baseInput({ plan: sealedPlan(shots), jobs, runStatus: "paused" }));
    expect(result.progress.completed).toBe(1);
    expect(result.progress.inFlight).toBe(1);
    expect(result.progress.pending).toBe(1); // shot-c never started
    expect(result.progress.total).toBe(3);
  });
});

// P4 慢供应商修复（2026-08-25）— the `observe` output: in-flight units the orchestrator must keep
// polling. Without this list, a re-kick after the scheduler rested (or an app restart) re-derived
// "nothing to do" and slow-provider jobs sat at `processing` forever (the S6.5 paid-acceptance freeze).
describe("P4 slow-provider observe — in-flight units the orchestrator keeps polling", () => {
  it("lists provider_accepted/polling jobs (with a providerTaskId); settled/pre-submission/attention excluded", () => {
    const shots = [shot("shot-a", "a".repeat(64)), shot("shot-b", "b".repeat(64)), shot("shot-c", "c".repeat(64)), shot("shot-d", "d".repeat(64))];
    const result = deriveBatchPlan(baseInput({
      plan: sealedPlan(shots),
      jobs: [
        { ...jobFor("shot-a", "a".repeat(64), "polling"), providerTaskId: "task-a" },
        { ...jobFor("shot-b", "b".repeat(64), "ready"), providerTaskId: "task-b" }, // done → not observed
        jobFor("shot-c", "c".repeat(64), "authorized"), // pre-submission → needsDispatch, not observe
        { ...jobFor("shot-d", "d".repeat(64), "needs_attention"), providerTaskId: "task-d" }, // own recovery flow
      ],
    }));
    expect(result.observe.map((t) => t.shotId)).toEqual(["shot-a"]);
    expect(result.shotDispatch.map((t) => t.shotId)).toEqual(["shot-c"]);
  });

  it("excludes an in-flight job that has no providerTaskId yet (nothing to poll)", () => {
    const result = deriveBatchPlan(baseInput({
      jobs: [jobFor("shot-a", "a".repeat(64), "polling")],
    }));
    expect(result.observe).toEqual([]);
  });

  it("keeps observing on a stopped run: paid in-flight work still settles, nothing NEW dispatches", () => {
    const result = deriveBatchPlan(baseInput({
      runStatus: "paused",
      jobs: [{ ...jobFor("shot-a", "a".repeat(64), "polling"), providerTaskId: "task-a" }],
    }));
    expect(result.observe.map((t) => t.shotId)).toEqual(["shot-a"]);
    expect(result.shotDispatch).toEqual([]);
    expect(result.anchorDispatch).toEqual([]);
  });

  it("orders anchors before video shots and survives the anchors-not-released early return", () => {
    const plan = sealedPlan([shot("shot-a", "a".repeat(64)), anchorShot("anchor-1")]);
    const result = deriveBatchPlan(baseInput({
      plan,
      jobs: [
        { ...jobFor("shot-a", "a".repeat(64), "polling"), providerTaskId: "task-s" },
        { ...jobFor("anchor-1", ANCHOR_HASH, "polling"), model: "image-model", providerTaskId: "task-anchor" },
      ],
    }));
    // Anchors in flight → checkpoint pending, shots blocked — but BOTH stay observable (anchor first).
    expect(result.checkpoint.status).toBe("pending_anchors");
    expect(result.observe.map((t) => t.shotId)).toEqual(["anchor-1", "shot-a"]);
  });
});
